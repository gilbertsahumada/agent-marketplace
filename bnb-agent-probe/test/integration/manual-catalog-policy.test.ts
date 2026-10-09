import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import { manualCatalogue } from '../../src/catalog/manual-catalog';
import { deriveCatalogEvidenceState, type CapabilityFact } from '../../src/catalog/evidence-policy';
import { publicCataloguePolicy } from '../../src/routes/catalog-public-facts';
import { catalogCombinedResponse } from '../../src/routes/catalog-combined';
import { catalogAgentResponse } from '../../src/routes/catalog-agent';
import { beginPublicCurrentBackfill, stepPublicCurrentBackfill } from '../../src/catalog/public-current-backfill';
import { seedPublicEnriched, completeProjectionFixture } from './public-enriched-fixture';
import { metered, type ReadRecord } from './d1-meter';

it('keeps exactly the 18 offers eligible across clocks with SQL/TS parity and no writes', async () => {
  expect(manualCatalogue).toHaveLength(18);
  expect(new Set(manualCatalogue.map(([id])=>id)).size).toBe(18);
  for (const [id,endpointKey,checked] of manualCatalogue) for (const delta of [86400000,365*86400000]) {
    for (const variant of ['valid','testnet','replacement','suspended','unsupported','invalid','missingHash','old','unsafe','failed'] as const) {
      const chain = variant==='testnet' ? 97 : 56;
      const c: CapabilityFact = { agentKey:`eip155:${chain}:${id}`,endpointKey: variant==='replacement' ? 'replacement' : endpointKey,
        state:variant==='suspended' ? 'suspended' : variant==='unsupported' ? 'unsupported' : 'stale',
        compatibilityState:variant==='invalid' ? 'unavailable' : 'compatible', schemaHash:variant==='missingHash' ? null : 'hash',
        compatibilityCheckedAt: variant==='old' ? checked-1 : checked, compatibilityExpiresAt:checked+86400000 };
      const eligibility=variant==='unsafe' ? 'unsafe' : 'eligible';
      const failure=variant==='failed'; const now=checked+delta;
      const ts=deriveCatalogEvidenceState({capability:c,admission:null,nowMs:now,
        endpoints:[{endpointKey:c.endpointKey!,role:'operational',eligibility,validationProtocol:'a2a'}],
        observations:failure ? [{id:1,endpointKey:c.endpointKey!,source:'worker_probe',outcome:'network_error',
          observedAt:checked+1,expiresAt:null,validationKind:'protocol',verificationLevel:'platform_observed'}] : []});
      const {requestable}=publicCataloguePolicy(now,chain,true);
      const query=sql`SELECT CASE WHEN ${requestable} THEN 1 ELSE 0 END AS requestable FROM
        (SELECT ${c.agentKey} AS agentKey,${c.endpointKey} AS endpointKey,${c.state} AS state,
          ${c.compatibilityState} AS compatibilityState,${c.schemaHash} AS schemaHash,
          ${c.compatibilityCheckedAt} AS compatibilityCheckedAt,${c.compatibilityExpiresAt} AS compatibilityExpiresAt) c
        CROSS JOIN (SELECT 'operational' AS role,${eligibility} AS eligibility,'a2a' AS validationProtocol) e
        CROSS JOIN (SELECT ${failure ? 'network_error' : 'protocol_valid'} AS latestPlatformOutcome,
          ${failure ? checked+1 : checked} AS latestPlatformObservedAt) p`;
      const q=new SQLiteAsyncDialect().sqlToQuery(query);
      const result=await env.DB.prepare(q.sql).bind(...q.params).all<{requestable:number}>();
      expect(result.results?.[0]?.requestable,`${id}/${variant}/${delta}`).toBe(ts.canRequestQuote ? 1 : 0);
      expect(ts.canRequestQuote).toBe(variant==='valid');
      expect(result.meta.rows_written).toBe(0);
      expect(ts.canPrepareHire).toBe(false);
    }
  }
});

it('keeps cards, counters and detail consistent for all 18 after a year without renewal or public writes', async () => {
  await seedPublicEnriched(0);
  for (const [id,endpoint,checked] of manualCatalogue) {
    const agentKey=`eip155:56:${id}`;
    await env.DB.batch!([
      env.DB.prepare(`INSERT INTO catalog_agents(agentKey,agentId,chainId,categoriesJson,metadataState,indexState,firstSeenAt,lastSeenAt)
        VALUES (?,?,56,'[]','ok','current',?,?)`).bind(agentKey,id,checked,checked),
      env.DB.prepare(`INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,declaredProtocol,role,validationProtocol,eligibility,nextProbeAt)
        VALUES (?,'a2a','https://seller.example/a2a','origin','safe','a2a','operational','a2a','eligible',0)`).bind(endpoint),
      env.DB.prepare(`INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt)
        VALUES (?,?,'current',?,?)`).bind(agentKey,endpoint,checked,checked),
      env.DB.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,createdAt,updatedAt,compatibilityState,schemaHash,compatibilityCheckedAt,compatibilityExpiresAt,capabilityExpiresAt)
        VALUES (?,?,'a2a','ready',?,?,'compatible','hash',?,?,?)`).bind(agentKey,endpoint,checked,checked,checked,checked+86400000,checked+86400000),
    ]);
  }
  await completeProjectionFixture();
  await beginPublicCurrentBackfill(env.DB);
  let complete=false;
  for(let page=0;page<10;page++) if(await stepPublicCurrentBackfill(env.DB,10000000)==='complete'){complete=true;break;}
  expect(complete).toBe(true);
  const before=await env.DB.prepare('SELECT * FROM catalog_seller_capabilities ORDER BY agentKey').raw!();
  const log:ReadRecord[]=[];const now=1791503881638+365*86400000;
  const response=await catalogCombinedResponse(new Request('https://worker.test/catalog-combined?scope=hiring&limit=24'),metered(env.DB,log),now);
  expect(response.status).toBe(200);
  const data=await response.json() as {list:{total:number;items:Array<{agentId:string;state:{canRequestQuote:boolean;canPrepareHire:boolean}}>};summary:{counts:{hiring:number}}};
  expect(data.list.total).toBe(18);expect(data.summary.counts.hiring).toBe(18);
  expect(data.list.items.every(x=>x.state.canRequestQuote&&!x.state.canPrepareHire)).toBe(true);
  for (const item of data.list.items) {
    const detail=await catalogAgentResponse(new Request(`https://worker.test/catalog-agent/${item.agentId}`),metered(env.DB,log),now);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({state:{canRequestQuote:true,canPrepareHire:false}});
  }
  expect(log.every(x=>x.rowsWritten===0)).toBe(true);
  expect(await env.DB.prepare('SELECT * FROM catalog_seller_capabilities ORDER BY agentKey').raw!()).toEqual(before);
});
