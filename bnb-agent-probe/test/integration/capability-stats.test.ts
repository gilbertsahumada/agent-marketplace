import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { CAPABILITY_STATS_KEY, CAPABILITY_STATS_LEASE_KEY, CAPABILITY_STATS_INTERVAL_MS, readCapabilityStats, refreshCapabilityStats } from "../../src/catalog/capability-stats";
import { healthResponse } from "../../src/routes/health";
import { loadConfig } from "../../src/config";
import type { D1DatabaseLike } from "../../src/db/client";
import type { D1Database } from "../../src/types";
import { clearCatalogFixtures } from "./catalog-fixtures";
import { metered, type ReadRecord } from "./d1-meter";

const NOW = 1_800_000_000_000;
const db = env.DB as unknown as D1DatabaseLike;
async function clear() {
  await clearCatalogFixtures();
  await db.prepare("DELETE FROM runtime_state WHERE key IN (?,?)").bind(CAPABILITY_STATS_KEY, CAPABILITY_STATS_LEASE_KEY).run();
}
async function seed(size: number) {
  await clear();
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
    INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt)
    SELECT 'eip155:56:'||x,CAST(x AS TEXT),56,'ok','current',0,0 FROM n`).bind(size).run();
  await db.prepare(`INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,eligibility,validationProtocol,nextProbeAt)
    SELECT agentKey,'a2a','https://seller.example/a2a','origin','safe','operational','eligible','a2a',0 FROM catalog_agents`).run();
  await db.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,nextProbeAt,createdAt,updatedAt)
    SELECT agentKey,agentKey,'a2a','discovered',0,0,0 FROM catalog_agents`).run();
}
async function health(now: number) {
  const records: ReadRecord[] = [];
  const source = metered(env.DB as unknown as D1Database, records);
  const response = await healthResponse(source, loadConfig({ CATALOG_V2_WRITES_ENABLED: "1" }), now);
  const body = await response.json() as { quoteQueue: Record<string, unknown> };
  expect(records).toHaveLength(1);
  expect(records.reduce((sum, row) => sum + row.rowsRead, 0)).toBeLessThanOrEqual(100);
  expect(records.some(row => row.sql.includes("catalog_seller_capabilities"))).toBe(false);
  console.log(JSON.stringify({ scenario: "health-snapshot", state: body.quoteQueue.statsStatus, rowsRead: records.reduce((sum, row) => sum + row.rowsRead, 0) }));
  return body.quoteQueue;
}

it.each([2000, 20000])("keeps missing/fresh/stale health snapshots within 100 reads at %i capabilities", async size => {
  await seed(size);
  const legacy = await db.prepare("SELECT state,COUNT(*) FROM catalog_seller_capabilities GROUP BY state").all();
  expect((legacy.meta as { rows_read: number }).rows_read).toBeGreaterThan(100);
  console.log(JSON.stringify({ scenario: "legacy-health-single-aggregate", size, rowsRead: (legacy.meta as { rows_read: number }).rows_read }));
  expect(await health(NOW)).toMatchObject({ statsStatus: "missing", pending: null });
  expect(await refreshCapabilityStats(db, NOW)).toBe(true);
  expect(await health(NOW)).toMatchObject({ statsStatus: "fresh", pending: size, ready: 0, statsUpdatedAt: NOW });
  expect(await health(NOW + CAPABILITY_STATS_INTERVAL_MS)).toMatchObject({ statsStatus: "stale", pending: size });
  const records: ReadRecord[] = [];
  expect(await refreshCapabilityStats(metered(env.DB as unknown as D1Database, records) as unknown as D1DatabaseLike, NOW + 1)).toBe(false);
  expect(records.reduce((sum, row) => sum + row.rowsRead, 0)).toBeLessThanOrEqual(100);
  expect(records.some(row => row.sql.includes("catalog_seller_capabilities"))).toBe(false);
}, 60000);

it("only permits one concurrent refresh per fifteen-minute interval", async () => {
  await seed(3);
  const records: ReadRecord[] = [];
  const source = metered(env.DB as unknown as D1Database, records) as unknown as D1DatabaseLike;
  const results = await Promise.all(Array.from({ length: 8 }, () => refreshCapabilityStats(source, NOW)));
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(records.filter(row => row.sql.includes("FROM catalog_seller_capabilities"))).toHaveLength(1);
  expect(await refreshCapabilityStats(db, NOW + CAPABILITY_STATS_INTERVAL_MS)).toBe(true);
});

it("retains the last snapshot and cooldown when aggregation fails", async () => {
  await seed(3);
  await refreshCapabilityStats(db, NOW);
  const failing = { ...db, prepare(query: string) {
    if (query.includes("FROM catalog_seller_capabilities")) throw new Error("injected failure");
    return db.prepare(query);
  } } as D1DatabaseLike;
  await expect(refreshCapabilityStats(failing, NOW + CAPABILITY_STATS_INTERVAL_MS)).rejects.toThrow("injected failure");
  expect(await health(NOW + CAPABILITY_STATS_INTERVAL_MS)).toMatchObject({ statsStatus: "stale", pending: 3 });
  expect(await refreshCapabilityStats(db, NOW + CAPABILITY_STATS_INTERVAL_MS + 1)).toBe(false);
});

it("does not turn corrupt or future snapshots into zero counts", async () => {
  await clear();
  for (const value of ["{", "null", JSON.stringify({ schemaVersion: 1, updatedAt: NOW + 1 })]) {
    await db.prepare("INSERT INTO runtime_state(key,textValue,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET textValue=excluded.textValue")
      .bind(CAPABILITY_STATS_KEY, value, NOW).run();
    expect(await health(NOW)).toMatchObject({ statsStatus: "missing", pending: null, statsUpdatedAt: null });
    expect(readCapabilityStats({ textValue: value }, NOW)).toBe(null);
  }
});

it.each([0, 6])('preserves all legacy aggregates with empty or overlapping agent groups (%i)', async size => {
  await seed(size || 1);
  if (!size) await db.prepare('DELETE FROM catalog_seller_capabilities').run();
  else {
    await db.prepare(`UPDATE catalog_seller_capabilities SET agentKey='eip155:56:1',
      capabilityExpiresAt=CASE WHEN endpointKey='eip155:56:1' THEN 9999999999999 ELSE 1 END,
      compatibilityState=CASE WHEN endpointKey IN ('eip155:56:1','eip155:56:2') THEN 'compatible' ELSE 'pending' END,
      state=CASE endpointKey WHEN 'eip155:56:1' THEN 'ready' WHEN 'eip155:56:2' THEN 'failed'
        WHEN 'eip155:56:3' THEN 'stale' WHEN 'eip155:56:4' THEN 'suspended' ELSE 'discovered' END,
      lastAttemptAt=CASE WHEN endpointKey='eip155:56:2' THEN 500 ELSE NULL END,
      compatibilityCheckedAt=CASE WHEN endpointKey='eip155:56:3' THEN 600 ELSE NULL END,
      nextProbeAt=CASE WHEN endpointKey='eip155:56:1' THEN 1 WHEN endpointKey='eip155:56:2' THEN NULL ELSE 700 END`).run();
  }
  const compatibility = await db.prepare(`SELECT compatibilityState AS state, COUNT(*) AS endpoints,
    COUNT(DISTINCT agentKey) AS agents, MAX(compatibilityCheckedAt) AS lastCheckedAt
    FROM catalog_seller_capabilities GROUP BY compatibilityState`).all();
  const counts = await db.prepare('SELECT state,COUNT(*) AS total FROM catalog_seller_capabilities GROUP BY state').all<{state:string;total:number}>();
  const latest = await db.prepare(`SELECT MAX(lastAttemptAt) AS attempt,
    MIN(CASE WHEN state IN ('discovered','stale','failed') THEN nextProbeAt END) AS due
    FROM catalog_seller_capabilities`).first<{attempt:number|null;due:number|null}>();
  const count = (state:string) => counts.results?.find(row=>row.state===state)?.total ?? 0;
  await refreshCapabilityStats(db,NOW);
  const snapshot = readCapabilityStats((await db.prepare('SELECT textValue FROM runtime_state WHERE key=?').bind(CAPABILITY_STATS_KEY).first<{textValue:string}>())!,NOW);
  expect(snapshot).toMatchObject({pending:count('discovered')+count('stale')+count('failed'),ready:count('ready'),stale:count('stale'),failed:count('failed'),
    lastQuoteAttemptAt:latest?.attempt,nextProbeAt:latest?.due,lastProcessedAt:size?600:null,compatibility:compatibility.results});
});
