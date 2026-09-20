import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { runIdentityIndex } from "../../src/identity/indexer";
import { enqueueDueCatalogCapabilities } from "../../src/phases/catalog-capability";
import { revisitOldInputFailures } from "../../src/catalog/rediscover-inputs";
import { createDatabase } from "../../src/db/orm";
import type { D1DatabaseLike } from "../../src/db/client";
import { clearCatalogFixtures } from "./catalog-fixtures";
import { metered, type ReadRecord } from "./d1-meter";
import type { D1Database } from "../../src/types";

const indexNames = ["idx_catalog_agents_identity_discovery", "idx_catalog_capabilities_legacy_inputs", "idx_catalog_capabilities_pending_due", "idx_catalog_capabilities_maintenance_due"];
async function removeIndexes() {
  for (const name of indexNames) await db.prepare(`DROP INDEX IF EXISTS ${name}`).run();
}
async function restoreIndexes(records?: ReadRecord[]) {
  const migration = env.TEST_MIGRATIONS.find(m => m.name === "0030_background_read_indexes.sql");
  if (!migration) throw new Error("Missing background read migration");
  for (const query of migration.queries) await (records ? measured(records) : db).prepare(query).run();
}
function measured(log: ReadRecord[], originalSelection = false) {
  const source = env.DB as unknown as D1Database;
  const meter = metered(source, log);
  return (originalSelection ? {...meter, prepare(query: string) {
    const replaced = query.includes('/* indexed-due */');
    const statement = meter.prepare(query.replace(/\/\* indexed-due \*\/[\s\S]*?\/\* end-indexed-due \*\//, 'catalog_seller_capabilities'));
    return replaced ? {...statement, bind: (...values: unknown[]) => statement.bind(...values.slice(1))} : statement;
  }} : meter) as unknown as D1DatabaseLike;
}

const db = env.DB as unknown as D1DatabaseLike;
afterEach(async () => { await removeIndexes(); await restoreIndexes(); });
const NOW = 1_800_000_000_000;
const wallet = "0x1111111111111111111111111111111111111111";
const reader = { getChainId: async () => 56, getBlockNumber: async () => 100n,
  multicall: vi.fn(async ({ contracts }: { contracts: unknown[] }) => contracts.map(() => ({ status: "success", result: wallet }))) };

async function seed(size: number) {
  await clearCatalogFixtures();
  await db.prepare("DELETE FROM agent_identities").run();
  await db.prepare("DELETE FROM runtime_state WHERE key LIKE 'agent_identity_cursor:%' OR key LIKE 'catalog_sweep_origin:%'").run();
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < ?)
    INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt)
    SELECT 'eip155:' || CASE WHEN x%10=0 THEN 97 ELSE 56 END || ':' || x,CAST(x AS TEXT),
      CASE WHEN x%10=0 THEN 97 ELSE 56 END,'ok','current',0,0 FROM n`).bind(size).run();
  await db.prepare(`INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,eligibility,validationProtocol,nextProbeAt)
    SELECT agentKey,'a2a','https://seller.example/a2a','origin-' || (CAST(agentId AS INTEGER)%100),'safe','operational','eligible','a2a',0 FROM catalog_agents`).run();
  await db.prepare(`INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt)
    SELECT agentKey,agentKey,'current',0,0 FROM catalog_agents`).run();
  await db.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,detectorVersion,compatibilityErrorCode,nextProbeAt,createdAt,updatedAt)
    SELECT agentKey,agentKey,'a2a','discovered',CASE WHEN CAST(agentId AS INTEGER)%2=0 THEN 'pending' ELSE 'unsupported' END,
      2,'NEGOTIATION_SCHEMA_UNSUPPORTED',CASE WHEN CAST(agentId AS INTEGER)%100 IN (1,2) THEN 0 ELSE ? + CAST(agentId AS INTEGER)*60000 END,0,0 FROM catalog_agents`).bind(NOW+86400000).run();
}

it.each([2000,20000])("bounds identity discovery and empty rediscovery at %i agents", async size => {
  await seed(size);
  await removeIndexes();
  const old = await db.prepare(`SELECT agentId,agentKey FROM catalog_agents WHERE agentKey>'' AND indexState='current' ORDER BY agentKey LIMIT 20`).all();
  const before: ReadRecord[] = [];
  const capture: ReadRecord[] = [];
  // Capture the production statement with the migration present, then measure
  // its pre-migration equivalent without the new access-path hint.
  await restoreIndexes();
  await revisitOldInputFailures(createDatabase(measured(capture)), NOW, 40);
  await removeIndexes();
  const baselineSql = capture[0]!.sql.replace(" INDEXED BY idx_catalog_capabilities_legacy_inputs", "");
  await measured(before).prepare(baselineSql).bind(...capture[0]!.values).run();
  await restoreIndexes();
  const after: ReadRecord[] = [];
  await revisitOldInputFailures(createDatabase(measured(after)), NOW, 40);
  const current = await db.prepare(`SELECT agentId,agentKey FROM catalog_agents WHERE chainId=56 AND agentKey>'' AND indexState='current' ORDER BY agentKey LIMIT 20`).all();
  const plan = await db.prepare(`EXPLAIN QUERY PLAN SELECT agentId,agentKey FROM catalog_agents WHERE chainId=56 AND agentKey>'' AND indexState='current' ORDER BY agentKey LIMIT 20`).all();
  console.log(JSON.stringify({ size, identityBefore: (old.meta as {rows_read:number}), identityAfter: (current.meta as {rows_read:number}), legacyBefore: before, legacyAfter: after, plan: plan.results }));
  expect(after[0]!.rowsRead).toBeLessThan(before[0]!.rowsRead * 0.1);
  expect(after[0]!.rowsWritten).toBe(0);
  expect((current.meta as {rows_read:number}).rows_read).toBeLessThanOrEqual(25);
  expect((current.meta as {rows_read:number}).rows_read).toBeLessThan((old.meta as {rows_read:number}).rows_read * 0.1);
  expect(JSON.stringify(plan.results)).not.toContain("TEMP B-TREE");
}, 60000);

it("never discovers Testnet-only identities through the Mainnet reader", async () => {
  await seed(20);
  await db.prepare("UPDATE catalog_agents SET indexState='removed' WHERE chainId=56").run();
  reader.multicall.mockClear();
  const result = await runIdentityIndex(env.DB as unknown as D1DatabaseLike, 56, reader as never, NOW);
  expect(result.checked).toBe(0);
  expect(reader.multicall).not.toHaveBeenCalled();
});

it.each([
  {size:2000, chainId:56 as const, dense:false, analyzed:true, offset:0},
  {size:20000, chainId:56 as const, dense:false, analyzed:true, offset:0},
  {size:2000, chainId:97 as const, dense:true, analyzed:true, offset:60000},
  {size:20000, chainId:97 as const, dense:true, analyzed:false, offset:60000},
  {size:2000, chainId:56 as const, dense:false, analyzed:true, offset:0, bootstrap:0},
])("preserves candidate order and read budgets: $size / $chainId / dense=$dense / analyzed=$analyzed", async ({size,chainId,dense,analyzed,offset,bootstrap=5}) => {
  const results: { messages: unknown[]; reads: number[] }[] = [];
  for (const indexed of ["baseline","identity-only","candidates-only","all"]) {
    await seed(size);
    if (dense) {
      await db.prepare("UPDATE catalog_seller_capabilities SET nextProbeAt=CASE WHEN CAST(substr(agentKey,11) AS INTEGER)%3=0 THEN NULL ELSE 0 END, compatibilityState=CASE WHEN CAST(substr(agentKey,11) AS INTEGER)%4=0 THEN 'pending' ELSE 'unsupported' END").run();
      await db.prepare("UPDATE catalog_seller_capabilities SET state='suspended' WHERE CAST(substr(agentKey,11) AS INTEGER)%17=0").run();
      await db.prepare("UPDATE catalog_seller_capabilities SET state='ready', compatibilityState='compatible', capabilityExpiresAt=?,compatibilityExpiresAt=?,lastSuccessAt=? WHERE CAST(substr(agentKey,11) AS INTEGER)%19=0").bind(NOW+86400000,NOW+86400000,NOW).run();
    }
    // Both cohorts contain due and future rows and shared origins. The existing
    // capability suite separately exercises expiry, leases and retry fairness.
    if (indexed === "baseline") {
      await removeIndexes();
      // Keep rediscovery's required access path; this comparison isolates the
      // candidate selector indexes, not the already-tested legacy scan.
      const migration = env.TEST_MIGRATIONS.find(m=>m.name === '0030_background_read_indexes.sql')!;
      await db.prepare(migration.queries.find(q=>q.includes('idx_catalog_capabilities_legacy_inputs'))!).run();
    } else {
      await removeIndexes();
      await restoreIndexes();
      if (indexed === "identity-only") {
        await db.prepare("DROP INDEX idx_catalog_capabilities_pending_due").run();
        await db.prepare("DROP INDEX idx_catalog_capabilities_maintenance_due").run();
      }
      if (indexed === "candidates-only") await db.prepare("DROP INDEX idx_catalog_agents_identity_discovery").run();
    }
    if (analyzed) await db.prepare("ANALYZE").run();
    else {
      await db.prepare("DELETE FROM sqlite_stat1").run();
      await db.prepare("ANALYZE sqlite_schema").run();
    }
    const records: ReadRecord[] = [];
    const messages: unknown[] = [];
    await enqueueDueCatalogCapabilities(measured(records, indexed === 'baseline' || indexed === 'identity-only'), {send: async (m: unknown) => { messages.push(m); }} as never,
      {nowMs:NOW+offset,limit:5,bootstrapLimit:bootstrap,chainId});
    const selects = records.filter(r => r.sql.includes("WITH ranked AS"));
    expect(selects).toHaveLength(bootstrap ? 2 : 1);
    const plans = await Promise.all(selects.map(r => db.prepare(`EXPLAIN QUERY PLAN ${r.sql}`).bind(...r.values).all()));
    console.log(JSON.stringify({size,chainId,dense,analyzed,bootstrap,indexed,reads:selects.map(r=>r.rowsRead),durationMs:selects.map(r=>r.durationMs),plans:plans.map(p=>p.results)}));
    results.push({messages,reads:selects.map(r=>r.rowsRead)});
  }
  for (const result of results.slice(1)) expect(result.messages).toEqual(results[0]!.messages);
  results[3]!.reads.forEach((reads,i)=>expect(reads).toBeLessThanOrEqual(results[0]!.reads[i]!));
},60000);

it("does not run Mainnet rediscovery from the Testnet scheduler", async () => {
  await seed(20);
  const records: ReadRecord[] = [];
  await enqueueDueCatalogCapabilities(measured(records), {send:async()=>{}} as never,
    {nowMs:NOW,limit:1,bootstrapLimit:1,chainId:97});
  expect(records.some(r=>r.sql.includes("detectorVersion <"))).toBe(false);
});

it("discovers a later legacy candidate, preserving suspension and current detectors", async () => {
  await seed(20);
  await revisitOldInputFailures(createDatabase(db),NOW,40);
  await db.prepare("UPDATE catalog_seller_capabilities SET detectorVersion=1 WHERE agentKey IN ('eip155:56:1','eip155:56:3','eip155:56:5')").run();
  await db.prepare("UPDATE catalog_seller_capabilities SET state='suspended' WHERE agentKey='eip155:56:3'").run();
  await db.prepare("UPDATE catalog_endpoints SET eligibility='unsupported' WHERE endpointKey='eip155:56:5'").run();
  await revisitOldInputFailures(createDatabase(db),NOW,40);
  const pending = await db.prepare("SELECT agentKey FROM catalog_seller_capabilities WHERE detectorVersion=1 AND compatibilityState='pending'").all();
  expect(pending.results).toEqual([{agentKey:'eip155:56:1'}]);
});

it("walks initial, middle, final and wrapped identity pages without cross-network contamination", async () => {
  await seed(47);
  await db.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES ('eip155:97:1','1',97,'ok','current',0,0)").run();
  const seen: string[] = [];
  const pageReader = {...reader, multicall: vi.fn(async ({contracts}: {contracts:{args:readonly bigint[]}[]}) => {
    seen.push(...contracts.map(c=>String(c.args[0])));
    return contracts.map(()=>({status:'success',result:wallet}));
  })};
  for(let page=0;page<3;page++) await runIdentityIndex(db,56,pageReader as never,NOW);
  const expected = await db.prepare("SELECT agentId FROM catalog_agents WHERE chainId=56 ORDER BY agentKey").all<{agentId:string}>();
  // The registry reader issues ownerOf and getAgentWallet for each identity.
  const owners = seen.filter((_,i)=>i%2===0);
  expect([...new Set(owners)]).toEqual(expected.results!.map(r=>r.agentId));
  expect(owners).toHaveLength(expected.results!.length);
  expect((await db.prepare("SELECT COUNT(*) AS n FROM agent_identities WHERE chainId=97").first<{n:number}>())?.n).toBe(0);
  const cursor = await db.prepare("SELECT textValue FROM runtime_state WHERE key LIKE 'agent_identity_cursor:56:%'").first<{textValue:string}>();
  expect(cursor?.textValue).toBe('');
  seen.length=0;
  await runIdentityIndex(db,56,pageReader as never,NOW);
  expect(seen.filter((_,i)=>i%2===0)).toEqual(expected.results!.slice(0,20).map(r=>r.agentId));
});

it("measures additive index storage and write cost on an existing database", async () => {
  await seed(2000);
  await removeIndexes();
  const before: ReadRecord[] = [];
  const after: ReadRecord[] = [];
  const query = "UPDATE catalog_seller_capabilities SET nextProbeAt=? WHERE agentKey='eip155:56:2'";
  await measured(before).prepare(query).bind(NOW).run();
  const countBefore = await db.prepare("SELECT COUNT(*) n FROM catalog_seller_capabilities").first();
  const indexBuild: ReadRecord[] = [];
  await restoreIndexes(indexBuild);
  await measured(after).prepare(query).bind(NOW+1).run();
  expect(await db.prepare("SELECT COUNT(*) n FROM catalog_seller_capabilities").first()).toEqual(countBefore);
  const definitions = await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name IN (?,?,?,?)").bind(...indexNames).all();
  expect(definitions.results).toHaveLength(4);
  console.log(JSON.stringify({writeCost:{before,after},indexBuild,definitions:definitions.results}));
});
