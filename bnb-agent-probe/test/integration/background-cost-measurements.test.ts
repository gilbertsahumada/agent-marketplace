import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { clearCatalogFixtures } from "./catalog-fixtures";
import { metered, type ReadRecord } from "./d1-meter";
import type { D1Database } from "../../src/types";
import type { D1DatabaseLike } from "../../src/db/client";
import { enqueueDueCatalogCapabilities, repairCatalogCapabilities } from "../../src/phases/catalog-capability";
import { CAPABILITY_STATS_KEY, refreshCapabilityStats } from "../../src/catalog/capability-stats";
import { recordSweepMetrics } from "../../src/catalog/sweep-metrics";
import { runWithBackgroundBudget, runBackgroundControl, BackgroundBudgetError } from "../../src/db/background-budget";
import { persistDeferred, replayDeferred } from "../../src/db/deferred-background";
import { createWorker } from "../../src/index";
import type { Env } from "../../src/types";

vi.mock("../../src/identity/indexer", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/identity/indexer")>();
  return { ...actual, identityIndexReader: (_url: string, chainId: number) => ({
    getChainId: async () => chainId,
    getBlockNumber: async () => 100n,
    multicall: async ({ contracts }: { contracts: unknown[] }) => contracts.map(() => ({ status: "success", result: "0x1111111111111111111111111111111111111111" })),
  }) };
});
import { runMaintenanceWindow } from "../../src/phases/background-cadence";
import { healthResponse } from "../../src/routes/health";
import { loadConfig } from "../../src/config";

const NOW = Date.UTC(2026, 8, 21, 0, 0);
const db = env.DB as unknown as D1DatabaseLike;

it.each([2000, 20000])('bounds healthy-ready repair cost at %i agents', async size => {
  await seed(size, false);
  await db.prepare(`UPDATE catalog_seller_capabilities SET state='ready',capabilityExpiresAt=?,
    compatibilityState='compatible',compatibilityExpiresAt=?,lastSuccessAt=?`)
    .bind(NOW + 86_400_000, NOW + 86_400_000, NOW - 1000).run();
  await db.prepare("ANALYZE").run();
  const records: ReadRecord[] = [];
  await repairCatalogCapabilities(measured(records), NOW);
  console.info("INDEXED_REPAIR_COST", JSON.stringify({ size, ...totals(records) }));
  expect(totals(records).reads).toBeLessThanOrEqual(20);
  expect(totals(records).writes).toBe(0);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM catalog_seller_capabilities WHERE state='ready'")
    .first()).toEqual({ n: size });
}, 60000);
// Verified against git base cbb1b0876b34f5ff2c7cfeb43d0be0e51b4b61da.
const legacyCounts = "SELECT state, COUNT(*) AS total FROM catalog_seller_capabilities GROUP BY state";
const legacyHealth = [legacyCounts,
  "SELECT MAX(lastAttemptAt) AS lastAttemptAt, MIN(CASE WHEN state IN ('discovered','stale','failed') THEN nextProbeAt END) AS nextProbeAt FROM catalog_seller_capabilities",
  "SELECT compatibilityState AS state, COUNT(*) AS endpoints, COUNT(DISTINCT agentKey) AS agents, MAX(compatibilityCheckedAt) AS lastCheckedAt FROM catalog_seller_capabilities GROUP BY compatibilityState"];
const totals = (records: ReadRecord[]) => {
  const reads = records.reduce((sum, row) => sum + row.rowsRead, 0);
  const writes = records.reduce((sum, row) => sum + row.rowsWritten, 0);
  return { queries: records.length, reads, writes, nanoUsd: reads + writes * 1000,
    durationMs: records.reduce((sum, row) => sum + row.durationMs, 0) };
};
function measured(records: ReadRecord[]) { return metered(env.DB as unknown as D1Database, records) as unknown as D1DatabaseLike; }
async function seed(size: number, allDue: boolean) {
  await clearCatalogFixtures();
  await db.prepare("DELETE FROM agent_identities").run();
  await db.prepare("DELETE FROM runtime_state").run();
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
    INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt)
    SELECT 'eip155:'||CASE WHEN x%10=0 THEN 97 ELSE 56 END||':'||x,CAST(x AS TEXT),
      CASE WHEN x%10=0 THEN 97 ELSE 56 END,'ok','current',0,0 FROM n`).bind(size).run();
  await db.prepare(`INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,eligibility,validationProtocol,nextProbeAt)
    SELECT agentKey,'a2a','https://seller.example/a2a','origin-'||(CAST(agentId AS INTEGER)%100),'safe','operational','eligible','a2a',0 FROM catalog_agents`).run();
  await db.prepare(`INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt)
    SELECT agentKey,agentKey,'current',0,0 FROM catalog_agents`).run();
  await db.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,nextProbeAt,createdAt,updatedAt)
    SELECT agentKey,agentKey,'a2a','discovered',CASE WHEN CAST(agentId AS INTEGER)%3=0 THEN 'compatible' ELSE 'pending' END,
      CASE WHEN ?=1 OR CAST(agentId AS INTEGER)%100 IN (1,2) THEN 0 ELSE ? END,0,0 FROM catalog_agents`).bind(allDue ? 1 : 0, NOW + 86400000).run();
  await db.prepare("ANALYZE").run();
}
async function selectors(source: D1DatabaseLike, controlled: boolean) {
  for (const chainId of [56, 97] as const) {
    const result = await enqueueDueCatalogCapabilities(source, { send: async () => {} }, {
      nowMs: NOW, limit: chainId === 56 ? 4 : 1, concurrency: chainId === 56 ? 2 : 1,
      bootstrapLimit: chainId === 56 ? 40 : 1, chainId, skipRepairs: controlled,
    });
    if (!controlled) await source.prepare(legacyCounts).all();
    await recordSweepMetrics(source, NOW, { ticks: chainId === 56 ? 1 : 0, selected: result.selected ?? 0, enqueued: result.enqueued });
  }
}

it.each([2000, 20000].flatMap(size => [false, true].map(allDue => ({ size, allDue }))))(
  "measures full local maintenance cost at $size capabilities (allDue=$allDue)", async ({ size, allDue }) => {
    await seed(size, allDue);
    const oldHealth: ReadRecord[] = [];
    for (const query of legacyHealth) await measured(oldHealth).prepare(query).all();
    const oldCycle: ReadRecord[] = [];
    // Reproduce the pre-migration access paths instead of letting the new
    // indexes silently improve the supposed baseline.
    await db.prepare('DROP INDEX idx_catalog_capabilities_ready_expiry').run();
    await db.prepare('DROP INDEX idx_catalog_capabilities_restorable').run();
    await selectors(measured(oldCycle), false);
    // Remove the new point lookup: baseline used the legacy COUNT measured above.
    const baselineCycle = oldCycle.filter(row => !row.values.includes(CAPABILITY_STATS_KEY));
    for (const query of env.TEST_MIGRATIONS.find(m => m.name === '0031_capability_repair_indexes.sql')!.queries) await db.prepare(query).run();
    await seed(size, allDue);
    const cycle: ReadRecord[] = [];
    // A diagnostic reservation permits the complete cycle to be measured even
    // if it exceeds the production estimate. This changes no production setting.
    const result = await runWithBackgroundBudget(measured(cycle), "maintenance", "profile", NOW, async source => {
      await runMaintenanceWindow(source, NOW, async () => {
        await repairCatalogCapabilities(source, NOW);
        await refreshCapabilityStats(source, NOW);
        await selectors(source, true);
      });
    }, { estimateNanoUsd: 14_000_000 });
    expect(result.status).toBe("completed");
    const health: ReadRecord[] = [];
    await healthResponse(measured(health) as unknown as D1Database, loadConfig({ CATALOG_V2_WRITES_ENABLED: "1" }), NOW);
    expect(totals(health).reads).toBeLessThanOrEqual(100);
    const idle: ReadRecord[] = [];
    const idleResult = await runWithBackgroundBudget(measured(idle), "maintenance", "profile", NOW + 60000,
      async source => expect(await runMaintenanceWindow(source, NOW + 60000, async () => { throw new Error("unexpected work"); })).toBe(false),
      { estimateNanoUsd: 500000 });
    const report = { size, allDue, oldHealth: totals(oldHealth), baselineCycle: totals(baselineCycle), cycle: totals(cycle), health: totals(health), idle: totals(idle),
      chargedNanoUsd: result.status === "completed" ? result.chargedNanoUsd : null };
    console.info("BACKGROUND_D1_MEASUREMENT", JSON.stringify(report));
    const expected = size === 2000
      ? allDue ? { old: 31341, current: 23354, writes: 276, charge: 301352 } : { old: 13989, current: 6002, writes: 24, charge: 32000 }
      : allDue ? { old: 308541, current: 228554, writes: 276, charge: 506552 } : { old: 139629, current: 59642, writes: 24, charge: 85640 };
    expect(report).toMatchObject({ oldHealth: { reads: size * 4, writes: 0 },
      baselineCycle: { reads: expected.old, writes: expected.writes - 9 },
      cycle: { reads: expected.current, writes: expected.writes }, chargedNanoUsd: expected.charge,
      health: { reads: 18, writes: 0 }, idle: { reads: 5, writes: 2 } });
    // PR #158's exact producer baseline was old + 9 reads in these fixtures.
    expect(report.cycle.reads).toBe(expected.old + 9 - size * 4 + 4);
    expect(idleResult).toMatchObject({ status: "completed", chargedNanoUsd: 5002 });
    await seed(size, allDue);
    const configured = runWithBackgroundBudget(db, "maintenance", "configured", NOW, async source => {
      await runMaintenanceWindow(source, NOW, async () => {
        await repairCatalogCapabilities(source, NOW);
        await refreshCapabilityStats(source, NOW);
        await selectors(source, true);
      });
    }, { estimateNanoUsd: 500000 });
    if (size === 20000 && allDue) await expect(configured).rejects.toBeInstanceOf(BackgroundBudgetError);
    else expect((await configured).status).toBe("completed");
  }, 60000);

it.each([2000, 20000])("measures producer, durable replay, real identity consumer and isolated jobs unit at %i", async size => {
  await seed(size, false);
  const deferred: ReadRecord[] = [];
  let acked = false;
  const body = { schemaVersion: 1, kind: "index_identities", chainId: 56, enqueuedAt: NOW - 900000 };
  await runBackgroundControl(measured(deferred), "maintenance", "persist-identity", NOW - 900000,
    source => persistDeferred(source, { id: "identity-source", body, ack: () => { acked = true; } }, "maintenance", NOW - 900000));
  expect(acked).toBe(true);
  const producer: ReadRecord[] = [];
  const queued: unknown[] = [];
  const produced = await runWithBackgroundBudget(measured(producer), "maintenance", "producer", NOW, async source => {
    await runMaintenanceWindow(source, NOW, async () => {
      expect(await replayDeferred(source, "maintenance", { send: async payload => { queued.push(payload); } }, NOW)).toEqual({ sent: 1, failed: 0 });
      await refreshCapabilityStats(source, NOW);
      await repairCatalogCapabilities(source, NOW);
      await selectors(source, true);
    });
  }, { estimateNanoUsd: 500000 });
  expect(produced.status).toBe("completed");
  expect(queued).toEqual([body]);
  const consumer: ReadRecord[] = [];
  let consumed = false;
  await createWorker({ now: () => NOW }).queue({ messages: [{ id: "identity-replayed", timestamp: new Date(NOW), attempts: 1,
    body: queued[0], ack: () => { consumed = true; }, retry: () => { throw new Error("unexpected retry"); } }] },
  { ...env, DB: measured(consumer), KILL_SWITCH: "0", BACKGROUND_COST_CONTROLS_ENABLED: "1", BACKGROUND_MAINTENANCE_PAUSED: "0", AGENT_IDENTITY_INDEX_ENABLED: "1", BSC_RPC_URL: "https://rpc.invalid" } as unknown as Env,
  { waitUntil: () => {}, passThroughOnException: () => {} });
  expect(consumed).toBe(true);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM agent_identities WHERE chainId=56").first()).toEqual({ n: 20 });
  expect(await db.prepare("SELECT COUNT(*) AS n FROM agent_identities WHERE chainId=97").first()).toEqual({ n: 0 });
  const jobs: ReadRecord[] = [];
  const job = await runWithBackgroundBudget(measured(jobs), "jobs", "synthetic-point-job", NOW, async source => {
    await source.prepare("INSERT INTO runtime_state(key,textValue,updatedAt) VALUES('fixture_job','pending',?)").bind(NOW).run();
    expect(await source.prepare("SELECT textValue FROM runtime_state WHERE key='fixture_job'").first()).toEqual({ textValue: "pending" });
    await source.prepare("UPDATE runtime_state SET textValue='done' WHERE key='fixture_job'").run();
  });
  expect(job.status).toBe("completed");
  const report = { size, deferred: totals(deferred), producer: totals(producer), consumer: totals(consumer), jobs: totals(jobs),
    total: totals([...deferred, ...producer, ...consumer, ...jobs]) };
  console.info("BACKGROUND_D1_LIFECYCLE", JSON.stringify(report));
  expect(report).toMatchObject({ deferred: { queries: 4, reads: 3, writes: 5 },
    producer: { queries: 24, reads: size === 2000 ? 6007 : 59647, writes: 26 },
    consumer: { queries: 48, reads: 44, writes: 84 }, jobs: { queries: 5, reads: 4, writes: 6 },
    total: { reads: size === 2000 ? 6058 : 59698, writes: 121, nanoUsd: size === 2000 ? 127058 : 180698 } });
}, 60000);
