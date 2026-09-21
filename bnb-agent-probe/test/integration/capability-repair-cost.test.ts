import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { repairCatalogCapabilities } from '../../src/phases/catalog-capability';
import type { D1DatabaseLike } from '../../src/db/client';
import type { D1Database } from '../../src/types';
import { clearCatalogFixtures } from './catalog-fixtures';
import { metered, type ReadRecord } from './d1-meter';

const NOW = 1_800_000_000_000;
const db = env.DB as unknown as D1DatabaseLike;
const total = (rows: ReadRecord[]) => ({ reads: rows.reduce((n, r) => n + r.rowsRead, 0), writes: rows.reduce((n, r) => n + r.rowsWritten, 0) });
const names = ['idx_catalog_capabilities_ready_expiry', 'idx_catalog_capabilities_restorable'];
const measured = (records: ReadRecord[]) => metered(env.DB as unknown as D1Database, records) as unknown as D1DatabaseLike;
async function dropIndexes() { for (const name of names) await db.prepare(`DROP INDEX IF EXISTS ${name}`).run(); }
async function addIndexes(records: ReadRecord[] = []) {
  const migration = env.TEST_MIGRATIONS.find(m => m.name === '0031_capability_repair_indexes.sql')!;
  for (const query of migration.queries) await measured(records).prepare(query).run();
  return total(records);
}
async function legacy(source: D1DatabaseLike, now = NOW) {
  await source.prepare(`UPDATE catalog_seller_capabilities SET state='ready',updatedAt=?
    WHERE state='stale' AND compatibilityState='compatible' AND compatibilityExpiresAt>? AND capabilityExpiresAt>?
    AND lastSuccessAt IS NOT NULL AND consecutiveFailures=0 AND lastErrorCode IS NULL`).bind(now, now, now).run();
  await source.prepare(`UPDATE catalog_seller_capabilities SET state='stale',nextProbeAt=?,updatedAt=?
    WHERE state='ready' AND capabilityExpiresAt<=?`).bind(now, now, now).run();
}
async function seed(size: number) {
  await clearCatalogFixtures();
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
    INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,capabilityExpiresAt,compatibilityExpiresAt,compatibilityState,lastSuccessAt,createdAt,updatedAt)
    SELECT 'eip155:'||CASE WHEN x%2=0 THEN 97 ELSE 56 END||':'||x,'endpoint-'||x,'a2a','ready',?,?, 'compatible',1,0,0 FROM n`)
    .bind(size, NOW + 172_800_000, NOW + 172_800_000).run();
  await db.prepare('ANALYZE').run();
}
async function measuredRepair() {
  const records: ReadRecord[] = [];
  await repairCatalogCapabilities(metered(env.DB as unknown as D1Database, records) as unknown as D1DatabaseLike, NOW);
  return { records, ...total(records) };
}
it.each([2000, 20000].flatMap(size => [false, true].map(stale => ({size,stale}))))(
  'bounds empty repairs at $size capabilities (stale=$stale)', async ({size,stale}) => {
  await seed(size);
  if (stale) {
    await db.prepare(`UPDATE catalog_seller_capabilities SET state='stale',
      capabilityExpiresAt=CASE CAST(substr(endpointKey,10) AS INTEGER)%3 WHEN 0 THEN NULL WHEN 1 THEN ? ELSE ? END,
      compatibilityExpiresAt=CASE CAST(substr(endpointKey,10) AS INTEGER)%3 WHEN 2 THEN ? ELSE ? END`)
      .bind(NOW, NOW+1000, NOW, NOW+1000).run();
    await db.prepare('ANALYZE').run();
  }
  const result = await measuredRepair();
  console.info('REPAIR_EMPTY', JSON.stringify({size, ...result}));
  expect(result.reads).toBeLessThanOrEqual(20);
  expect(result.writes).toBe(0);
}, 60000);

it.each([2000, 20000].flatMap(size => ['expire', 'restore'].map(direction => ({size,direction}))))(
  'compares migration, sparse/mass repairs and 24h at $size rows ($direction)', async ({size,direction}) => {
  for (const candidates of [0, 4, size]) {
    const results: { reads: number; writes: number; daily: {reads: number; writes: number}; rows: unknown }[] = [];
    for (const indexed of [false, true]) {
      await dropIndexes();
      await seed(size);
      if (direction === 'expire') {
        await db.prepare("UPDATE catalog_seller_capabilities SET capabilityExpiresAt=? WHERE CAST(substr(endpointKey,10) AS INTEGER)<=?")
          .bind(NOW, candidates).run();
      } else {
        await db.prepare("UPDATE catalog_seller_capabilities SET state='stale' WHERE CAST(substr(endpointKey,10) AS INTEGER)<=?")
          .bind(candidates).run();
      }
      const migration = indexed ? await addIndexes() : null;
      const records: ReadRecord[] = [];
      if (indexed) await repairCatalogCapabilities(measured(records), NOW);
      else await legacy(measured(records));
      const rows = (await db.prepare('SELECT * FROM catalog_seller_capabilities ORDER BY agentKey,endpointKey').all()).results;
      const daily: ReadRecord[] = [];
      // 96 cycles total over a UTC day; no unmeasured external arrivals.
      for (let tick = 1; tick < 96; tick++) {
        const now = NOW + tick * 900_000;
        if (indexed) await repairCatalogCapabilities(measured(daily), now);
        else await legacy(measured(daily), now);
      }
      results.push({ ...total(records), daily: total(daily), rows });
      console.info('REPAIR_COST', JSON.stringify({size,direction,candidates,indexed,migration,first:total(records),daily:total(daily)}));
      if (indexed) {
        for (const record of records) {
          const plan = await db.prepare('EXPLAIN QUERY PLAN '+record.sql).bind(...record.values).all<{detail:string}>();
          expect(plan.results?.some(row => names.some(name => row.detail.includes(name)))).toBe(true);
          console.info('REPAIR_PLAN', JSON.stringify(plan.results));
        }
      }
    }
    const before = results[0]!;
    const after = results[1]!;
    expect(after.rows).toEqual(before.rows);
    if (candidates === 0) {
      expect(after.reads).toBeLessThanOrEqual(20);
      expect(after.reads).toBeLessThan(before.reads * .1);
    }
    if (candidates === 4) expect(after.reads).toBeLessThanOrEqual(100);
    // Economic gate: mass expiry currently FAILS net savings. Keep this explicit
    // diagnostic so a green behavioral suite cannot be mistaken for rollout approval.
    const cost = (r: typeof results[number]) => r.reads + r.daily.reads + 1000*(r.writes+r.daily.writes);
    const approved = cost(after) < cost(before);
    console.info('REPAIR_ECONOMIC_GATE', JSON.stringify({size,direction,candidates,approved,before:cost(before),after:cost(after)}));
    expect(approved).toBe(candidates !== size);
  }
}, 60000);

it('preserves every legacy field across nulls, boundaries, failures, networks and concurrent repairs', async () => {
  await seed(2000);
  await db.prepare(`UPDATE catalog_seller_capabilities SET
    state=CASE CAST(substr(endpointKey,10) AS INTEGER)%4 WHEN 0 THEN 'ready' WHEN 1 THEN 'stale' WHEN 2 THEN 'suspended' ELSE 'failed' END,
    capabilityExpiresAt=CASE CAST(substr(endpointKey,10) AS INTEGER)%5 WHEN 0 THEN NULL WHEN 1 THEN ? WHEN 2 THEN ? ELSE ? END,
    compatibilityExpiresAt=CASE CAST(substr(endpointKey,10) AS INTEGER)%7 WHEN 0 THEN NULL WHEN 1 THEN ? WHEN 2 THEN ? ELSE ? END,
    lastSuccessAt=CASE WHEN CAST(substr(endpointKey,10) AS INTEGER)%11=0 THEN NULL ELSE 1 END,
    consecutiveFailures=CASE WHEN CAST(substr(endpointKey,10) AS INTEGER)%13=0 THEN 1 ELSE 0 END,
    lastErrorCode=CASE WHEN CAST(substr(endpointKey,10) AS INTEGER)%17=0 THEN 'FAIL' ELSE NULL END,
    compatibilityState=CASE WHEN CAST(substr(endpointKey,10) AS INTEGER)%19=0 THEN 'pending' ELSE 'compatible' END`)
    .bind(NOW-1,NOW,NOW+1,NOW-1,NOW,NOW+1).run();
  await db.prepare('CREATE TABLE repair_original AS SELECT * FROM catalog_seller_capabilities').run();
  await legacy(db);
  const expected = (await db.prepare('SELECT * FROM catalog_seller_capabilities ORDER BY agentKey,endpointKey').all()).results;
  await db.prepare('DELETE FROM catalog_seller_capabilities').run();
  await db.prepare('INSERT INTO catalog_seller_capabilities SELECT * FROM repair_original').run();
  await Promise.all([repairCatalogCapabilities(db,NOW),repairCatalogCapabilities(db,NOW)]);
  expect((await db.prepare('SELECT * FROM catalog_seller_capabilities ORDER BY agentKey,endpointKey').all()).results).toEqual(expected);
  expect((await measuredRepair()).writes).toBe(0);
  await db.prepare('DROP TABLE repair_original').run();
});

it('measures index write overhead for inserts, state transitions and expiry updates', async () => {
  const costs: ReadRecord[][] = [];
  for (const indexed of [false, true]) {
    await dropIndexes();
    await seed(2);
    if (indexed) await addIndexes();
    const records: ReadRecord[] = [];
    const source = measured(records);
    await source.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,
      capabilityExpiresAt,compatibilityExpiresAt,compatibilityState,lastSuccessAt,createdAt,updatedAt)
      VALUES('eip155:97:1','new-endpoint','a2a','ready',?,?,'compatible',1,0,0)`)
      .bind(NOW+172800000,NOW+172800000).run();
    await source.prepare("UPDATE catalog_seller_capabilities SET capabilityExpiresAt=? WHERE endpointKey='new-endpoint'").bind(NOW+172800001).run();
    await source.prepare("UPDATE catalog_seller_capabilities SET state='stale' WHERE endpointKey='new-endpoint'").run();
    await source.prepare("UPDATE catalog_seller_capabilities SET compatibilityExpiresAt=? WHERE endpointKey='new-endpoint'").bind(NOW+172800002).run();
    expect(records).toHaveLength(4);
    costs.push(records);
    console.info('REPAIR_WRITE_OVERHEAD', JSON.stringify({indexed,records}));
  }
  for (let operation=0; operation<4; operation++) {
    expect(costs[1]![operation]!.rowsWritten).toBeGreaterThan(costs[0]![operation]!.rowsWritten);
  }
  const indexes = await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_catalog_capabilities_%'").all<{name:string;sql:string}>();
  expect(indexes.results?.find(row=>row.name===names[1])?.sql).toContain('MIN(capabilityExpiresAt, compatibilityExpiresAt)');
});
