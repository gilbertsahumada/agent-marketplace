import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import * as phase from '../../src/phases/catalog-capability';
import { refreshCapabilityStats } from '../../src/catalog/capability-stats';
import { runWithBackgroundBudget } from '../../src/db/background-budget';
import { runMaintenanceWindow } from '../../src/phases/background-cadence';
import { catalogAgentsResponse } from '../../src/routes/catalog-agents';
import { catalogAgentResponse } from '../../src/routes/catalog-agent';
import { healthResponse } from '../../src/routes/health';
import { loadConfig } from '../../src/config';
import type { D1DatabaseLike } from '../../src/db/client';
import type { D1Database } from '../../src/types';
import { clearCatalogFixtures } from './catalog-fixtures';
import { metered, type ReadRecord } from './d1-meter';

const NOW=Date.UTC(2026,8,21);
const db=env.DB as unknown as D1DatabaseLike;
const legacy=Reflect.get(phase,'repairCatalogCapabilities') as ((db:D1DatabaseLike,now:number)=>Promise<void>)|undefined;
const totals=(records:ReadRecord[])=>({reads:records.reduce((n,r)=>n+r.rowsRead,0),writes:records.reduce((n,r)=>n+r.rowsWritten,0)});
async function seed(size:number,affected:number,restore=false){
  await clearCatalogFixtures();
  await db.prepare('DELETE FROM runtime_state').run();
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
    INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt)
    SELECT 'eip155:'||CASE WHEN x%2=0 THEN 97 ELSE 56 END||':'||x,CAST(x AS TEXT),CASE WHEN x%2=0 THEN 97 ELSE 56 END,'ok','current',0,0 FROM n`).bind(size).run();
  await db.prepare(`INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,eligibility,validationProtocol,nextProbeAt)
    SELECT agentKey,'a2a','https://seller.example/a2a','origin-'||(CAST(agentId AS INTEGER)%100),'safe','operational','eligible','a2a',0 FROM catalog_agents`).run();
  await db.prepare(`INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt)
    SELECT agentKey,agentKey,'current',0,0 FROM catalog_agents`).run();
  await db.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,schemaHash,capabilityExpiresAt,compatibilityExpiresAt,lastSuccessAt,nextProbeAt,createdAt,updatedAt)
    SELECT agentKey,agentKey,'a2a',CASE WHEN CAST(agentId AS INTEGER)<=? AND ?=1 THEN 'stale' ELSE 'ready' END,'compatible','hash',
    CASE WHEN CAST(agentId AS INTEGER)<=? AND ?=0 THEN ? ELSE ? END,?,1,
    CASE WHEN CAST(agentId AS INTEGER)<=? THEN ? ELSE ? END,0,0 FROM catalog_agents`)
    .bind(affected,restore?1:0,affected,restore?1:0,NOW,NOW+172800000,NOW+172800000,affected,NOW,NOW+172800000).run();
  await db.prepare('ANALYZE').run();
}
it.each([2000,20000])('captures public read parity at %i agents',async size=>{
  await seed(size,0);
  const costs=[];
  for(const path of ['/catalog-agents','/catalog-agents?status=hireable','/catalog-agents?facets=true','/catalog-agent/1']){
    const records:ReadRecord[]=[];
    const source=metered(env.DB as unknown as D1Database,records);
    const response=path.startsWith('/catalog-agent/')?await catalogAgentResponse(new Request('https://worker.test'+path),source,NOW):await catalogAgentsResponse(new Request('https://worker.test'+path),source,NOW);
    expect(response.status).toBe(200);
    costs.push({path,...totals(records)});
  }
  console.info('PUBLIC_BASELINE',JSON.stringify({size,costs}));
  const baseline=size===2000?[3451,5501,61463,15]:[30452,50502,610464,15];
  costs.forEach((cost,index)=>{expect(cost.reads,cost.path).toBeLessThanOrEqual(baseline[index]!);expect(cost.writes).toBe(0);});
},60000);
it.each([2000,20000].flatMap(size=>['none','few','mass','restore'].map(scenario=>({size,scenario}))))('simulates 96 budgeted cycles: $size $scenario',async({size,scenario})=>{
  await seed(size,scenario==='none'?0:scenario==='few'?4:size,scenario==='restore');
  const records:ReadRecord[]=[];
  const publicRecords:ReadRecord[]=[];
  const source=metered(env.DB as unknown as D1Database,records) as unknown as D1DatabaseLike;
  const pending: {agentKey:string;endpointKey:string}[]=[];
  let completed=0,denied=0,overruns=0,consumed=0,published=0;
  for(let tick=0;tick<96;tick++){
    const now=NOW+tick*900000;
    try{
      const result=await runWithBackgroundBudget(source,'maintenance','daily',now,async scoped=>{
        await runMaintenanceWindow(scoped,now,async()=>{
          if(legacy) await legacy(scoped,now);
          await refreshCapabilityStats(scoped,now);
          for(const chainId of [56,97] as const){
            const input={nowMs:now,chainId,limit:1,bootstrapLimit:1,concurrency:1,skipRepairs:true};
            await phase.enqueueDueCatalogCapabilities(scoped,{send:async body=>{published++;pending.push(body as {agentKey:string;endpointKey:string});}},input);
          }
        });
      },{estimateNanoUsd:500000});
      if(result.status==='completed') completed++; else denied++;
    }catch(error){ expect(error).toHaveProperty('code','overrun'); overruns++;}
    // Simulated successful consumer: evidence renewal, no real seller request.
    if(pending.length){
      const work=pending[0]!;
      const result=await runWithBackgroundBudget(source,'maintenance','consumer',now,async scoped=>{
        await scoped.prepare("UPDATE catalog_seller_capabilities SET state='ready',capabilityExpiresAt=?,nextProbeAt=?,lastSuccessAt=?,updatedAt=? WHERE agentKey=? AND endpointKey=?")
          .bind(now+86400000,now+86400000,now,now,work.agentKey,work.endpointKey).run();
      });
      if(result.status==='completed'){pending.shift();consumed++;}
    }
    // Independent jobs lane remains accounted even when maintenance is denied.
    await runWithBackgroundBudget(source,'jobs','fake-job',now,async scoped=>{
      await scoped.prepare("SELECT key FROM runtime_state WHERE key='missing-job'").all();
    });
    await healthResponse(metered(env.DB as unknown as D1Database,publicRecords),loadConfig({}),now);
  }
  const cost=totals(records),pub=totals(publicRecords);
  const report={size,scenario,...cost,nanoUsd:cost.reads+cost.writes*1000,completed,denied,overruns,consumed,pending:pending.length,public:pub};
  console.info('DAILY_BASELINE',JSON.stringify(report));
  expect(pub.reads).toBeLessThanOrEqual(96*100);
  expect(published).toBe(consumed+pending.length);
  const baseline:Record<string,number>=size===2000?{none:2216259,few:2313398,mass:13269853,restore:10392138}:{none:14563998,few:14497108,mass:80353480,restore:80333480};
  expect(report.nanoUsd).toBeLessThan(baseline[scenario]!);
  expect(records.some(row=>/UPDATE catalog_seller_capabilities SET state='(ready|stale)'/.test(row.sql)
    && !row.sql.includes('WHERE agentKey=? AND endpointKey=?'))).toBe(false);
},180000);

it.each([56,97])('keeps list, facets and detail consistent across expiry without cron on chain %i',async chain=>{
  await seed(2,2,true);
  const original=(await db.prepare('SELECT * FROM catalog_seller_capabilities ORDER BY agentKey').all()).results;
  const agentId=chain===56?1:2;
  for(const now of [NOW,NOW+172800000]){
    const list=await catalogAgentsResponse(new Request('https://worker.test/catalog-agents?chain='+chain+'&facets=true'),env.DB as unknown as D1Database,now,2,true);
    const body=await list.json() as {items:{state:{capabilityState:string;canPrepareHire:boolean}}[];facets:{statuses:{hireable:number}}};
    expect(body.items[0]?.state.capabilityState).toBe(now===NOW?'ready':'stale');
    expect(body.items[0]?.state.canPrepareHire).toBe(false);
    expect(body.facets.statuses.hireable).toBe(now===NOW?1:0);
    const detail=await catalogAgentResponse(new Request('https://worker.test/catalog-agent/'+agentId+'?chain='+chain),env.DB as unknown as D1Database,now,2,true);
    expect(await detail.json()).toMatchObject({state:{capabilityState:now===NOW?'ready':'stale',canPrepareHire:false}});
  }
  expect((await db.prepare('SELECT * FROM catalog_seller_capabilities ORDER BY agentKey').all()).results).toEqual(original);
});
