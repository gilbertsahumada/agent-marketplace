import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { effectiveCapability, effectiveCapabilityStateSql, effectiveCapabilityReadySql } from '../../src/catalog/effective-capability';
import { selectBestCapability, type CapabilityFact } from '../../src/catalog/evidence-policy';
import { createDatabase } from '../../src/db/orm';
import { catalogSellerCapabilities as c } from '../../src/db/schema';
import type { D1DatabaseLike } from '../../src/db/client';
import { clearCatalogFixtures } from './catalog-fixtures';
import { CAPABILITY_STATS_KEY, refreshCapabilityStats, readCapabilityStats } from '../../src/catalog/capability-stats';

const NOW=1_800_000_000_000;
const db=env.DB as unknown as D1DatabaseLike;

it('agrees between SQL and TypeScript for all states, expiry boundaries and restoration blockers', async()=>{
  await clearCatalogFixtures();
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<767)
    INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,capabilityExpiresAt,
      compatibilityExpiresAt,compatibilityState,lastSuccessAt,consecutiveFailures,lastErrorCode,createdAt,updatedAt)
    SELECT 'eip155:'||CASE WHEN x%2=0 THEN 56 ELSE 97 END||':'||(x/2), 'endpoint-'||x, 'a2a',
      CASE x%6 WHEN 0 THEN 'ready' WHEN 1 THEN 'stale' WHEN 2 THEN 'failed' WHEN 3 THEN 'suspended' WHEN 4 THEN 'unsupported' ELSE 'discovered' END,
      CASE (x/6)%4 WHEN 0 THEN NULL WHEN 1 THEN ?-1 WHEN 2 THEN ? ELSE ?+1 END,
      CASE (x/24)%4 WHEN 0 THEN NULL WHEN 1 THEN ?-1 WHEN 2 THEN ? ELSE ?+1 END,
      CASE (x/96)%2 WHEN 0 THEN 'compatible' ELSE 'pending' END,
      CASE (x/192)%2 WHEN 0 THEN 1 ELSE NULL END,
      CASE (x/384)%2 WHEN 0 THEN 0 ELSE 1 END,
      CASE x%17 WHEN 0 THEN 'FAIL' ELSE NULL END,0,0 FROM n`)
    .bind(NOW,NOW,NOW,NOW,NOW,NOW).run();
  const orm=createDatabase(db);
  const before=await orm.select().from(c);
  const result=await orm.select({agentKey:c.agentKey,endpointKey:c.endpointKey,state:effectiveCapabilityStateSql(c,NOW),ready:effectiveCapabilityReadySql(c,NOW)}).from(c);
  for(const row of before) {
    const match=result.find(r=>r.endpointKey===row.endpointKey);
    expect(match?.state).toBe(effectiveCapability(row,NOW).state);
    expect(Boolean(match?.ready)).toBe(match?.state==='ready');
  }
  expect(await orm.select().from(c)).toEqual(before);
  const states=before.map(row=>effectiveCapability(row,NOW));
  expect(states.some(row=>row.state==='ready')).toBe(true);
  expect(states.some(row=>row.state==='stale')).toBe(true);
});

it('normalizes before choosing an endpoint and does not refresh evidence timestamps',()=>{
  const stale:CapabilityFact={state:'stale',endpointKey:'restored',capabilityExpiresAt:NOW+1,
    compatibilityExpiresAt:NOW+1,compatibilityState:'compatible',lastSuccessAt:1,consecutiveFailures:0,lastErrorCode:null,schemaHash:'hash'};
  const expired:CapabilityFact={...stale,state:'ready',endpointKey:'expired',capabilityExpiresAt:NOW};
  expect(selectBestCapability([expired,stale],NOW)).toMatchObject({state:'ready',endpointKey:'restored'});
  expect(stale.state).toBe('stale');
  for(const state of ['failed','suspended','unsupported'] as const) expect(effectiveCapability({...stale,state},NOW).state).toBe(state);
});

it('rejects previous snapshots and computes effective counts without rewriting capabilities',async()=>{
  await clearCatalogFixtures();
  await db.prepare("DELETE FROM runtime_state WHERE key LIKE 'catalog_capability_stats%'").run();
  const old={schemaVersion:1,updatedAt:NOW,pending:0,ready:1,stale:0,failed:0,lastQuoteAttemptAt:null,lastProcessedAt:null,nextProbeAt:null,compatibility:[]};
  expect(readCapabilityStats({textValue:JSON.stringify(old)},NOW)).toBeNull();
  await db.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,capabilityExpiresAt,nextProbeAt,createdAt,updatedAt)
    VALUES('eip155:56:1','endpoint','a2a','ready',?,?,0,0)`).bind(NOW,NOW+60000).run();
  await refreshCapabilityStats(db,NOW);
  const snapshot=await db.prepare('SELECT textValue FROM runtime_state WHERE key=?').bind(CAPABILITY_STATS_KEY).first<{textValue:string}>();
  expect(readCapabilityStats(snapshot!,NOW)).toMatchObject({schemaVersion:2,ready:0,stale:1,pending:1,nextProbeAt:NOW+60000});
  expect(await db.prepare('SELECT state,updatedAt,nextProbeAt FROM catalog_seller_capabilities').first()).toEqual({state:'ready',updatedAt:0,nextProbeAt:NOW+60000});
});
