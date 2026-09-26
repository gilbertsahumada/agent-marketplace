// Production readers/triggers measured against the unchanged frozen public-day workload.
// This is the B public/write day, not a C producer/consumer/scheduler admission claim.
import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import type {D1Database} from '../../src/types';
import {metered,type ReadRecord} from './d1-meter';
import {seedPublicEnriched,completeProjectionFixture,NOW} from './public-enriched-fixture';
import {catalogAgentsResponse as oldList,catalogFacetsResponse as oldFacets,catalogSummaryResponse as oldSummary} from '../fixtures/public-read-reference/catalog-agents';
import {catalogCombinedResponse} from '../../src/routes/catalog-combined';
import {beginPublicCurrentBackfill,stepPublicCurrentBackfill,publicCurrentProjectionReady,PUBLIC_CURRENT_BACKFILL_KEY} from '../../src/catalog/public-current-backfill';
import {PUBLIC_CURRENT_TABLE} from '../../src/catalog/public-current-projection-sql';
import workload from '../prototypes/dense-public-day-workload.json';

const db=env.DB as unknown as D1Database;
const sum=(log:ReadRecord[])=>({queries:log.length,reads:log.reduce((n,r)=>n+r.rowsRead,0),writes:log.reduce((n,r)=>n+r.rowsWritten,0),units:log.reduce((n,r)=>n+r.rowsRead+1000*r.rowsWritten,0)});
const req=(path:string)=>new Request(`https://worker.test${path}`);
type PublicResult={list:unknown;facets:unknown;summary:unknown};
async function publicRead(mode:'A'|'B',binding:D1Database,query:string,now:number):Promise<PublicResult>{
 if(mode==='B'){
  const response=await catalogCombinedResponse(req(`/catalog-combined?status=declared&${query}&limit=24`),binding,now);
  expect(response.status).toBe(200);
  const result=await response.json() as PublicResult;
  return{list:result.list,facets:result.facets,summary:result.summary};
 }
 return{list:await(await oldList(req(`/catalog-agents?status=declared&${query}&limit=24`),binding,now)).json(),facets:await(await oldFacets(req(`/catalog-facets?status=declared&${query}`),binding,now)).json(),summary:await(await oldSummary(req('/catalog-summary'),binding,now)).json()};
}
async function mutationGroup(binding:D1Database,count:number,cycle:number,group:number){
 const index=10*((cycle*16+group)%Math.floor(count/10)),id=100000+index,key=`eip155:56:${id}`;
 const endpoint=('e'+(index*2).toString(16).padStart(12,'0')).padEnd(64,'0');
 const at=NOW+cycle*workload.intervalMs,observationId=9_000_000+cycle*1000+group*2;
 const observation=(late:boolean)=>binding.prepare(`INSERT OR IGNORE INTO catalog_observations(id,agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel)
 VALUES(?,?,?,'a2a','worker_probe',?,?,?,1,'protocol','platform_observed')`).bind(observationId+Number(late),key,endpoint,late?'timeout':'protocol_valid',late?at-2*3600000:at,at+86400000);
 await binding.batch!([
  binding.prepare('UPDATE catalog_agents SET lastSeenAt=? WHERE agentKey=?').bind(at,key),
  binding.prepare('UPDATE catalog_seller_capabilities SET nextProbeAt=?,updatedAt=? WHERE agentKey=?').bind(at+86400000,at,key),
  binding.prepare("UPDATE catalog_seller_capabilities SET state='ready',compatibilityState='compatible',schemaHash='day-schema',compatibilityCheckedAt=?,compatibilityExpiresAt=?,capabilityExpiresAt=?,lastSuccessAt=?,consecutiveFailures=0,lastErrorCode=NULL WHERE agentKey=?").bind(at,at+86400000,at+86400000,at,key),
  observation(false),observation(true),observation(false),
  binding.prepare('UPDATE catalog_seller_capabilities SET state=state WHERE agentKey=?').bind(key),
  binding.prepare('UPDATE commerce_jobs SET status=?,updatedAt=? WHERE chainId=56 AND jobId=?').bind(cycle%3+1,at,id),
  binding.prepare("UPDATE catalog_quote_attempts SET status=? WHERE id=?").bind(cycle%2?'failed':'succeeded',`quote-${id}`),
 ]);
}
async function sourceProgress(){return{
 observations:await db.prepare('SELECT COUNT(*) n,SUM(observedAt) dates FROM catalog_observations WHERE id>=9000000').first(),
 agents:await db.prepare('SELECT SUM(lastSeenAt) dates FROM catalog_agents').first(),
 capabilities:await db.prepare('SELECT SUM(compatibilityCheckedAt) dates,SUM(nextProbeAt) nextDates FROM catalog_seller_capabilities').first(),
 jobs:await db.prepare('SELECT SUM(status) states,SUM(updatedAt) dates FROM commerce_jobs').first(),
 attempts:(await db.prepare("SELECT status,COUNT(*) n FROM catalog_quote_attempts GROUP BY status ORDER BY status").all()).results,
};}

it.each(workload.agentCounts.flatMap(count=>workload.scenarios.map(scenario=>({count,scenario}))))('production current projection frozen public 24h cost: $count agents / $scenario.name',async({count,scenario})=>{
 const projectionObjects=(await db.prepare("SELECT type,name,sql FROM sqlite_master WHERE (type='trigger' AND (name LIKE 'catalog_public_%' OR name LIKE 'public_current_%')) OR (type='index' AND name='idx_catalog_observations_public_tuple') ORDER BY type,name").all<{type:string;name:string;sql:string}>()).results!;
 const expected:PublicResult[]=[],measurements:Record<string,{reads:ReturnType<typeof sum>;writes:ReturnType<typeof sum>;total:ReturnType<typeof sum>;elapsedMs:number;mutationGroups:number;publicOperations:number}>={};
 let beforeProgress:unknown;
 const constructionLog:ReadRecord[]=[];
 const restore=async()=>{for(const object of projectionObjects)await db.prepare(object.sql.replace(/^CREATE (TRIGGER|INDEX) /,'CREATE $1 IF NOT EXISTS ')).run();};
 try{
  for(const mode of ['A','B'] as const){
   await restore();await seedPublicEnriched(count);await completeProjectionFixture();
   if(mode==='A')for(const object of projectionObjects)await db.prepare(`DROP ${object.type.toUpperCase()} ${object.name}`).run();
   else{
    await db.prepare(`DELETE FROM ${PUBLIC_CURRENT_TABLE}`).run();
    await db.prepare('DELETE FROM runtime_state WHERE key=?').bind(PUBLIC_CURRENT_BACKFILL_KEY).run();
    const construction=metered(db,constructionLog);await beginPublicCurrentBackfill(construction);
    let complete=false;
    for(let page=0;page<Math.ceil(count*3/40)+10;page++){
      const outcome=await stepPublicCurrentBackfill(construction,200_000_000,`day-${count}-${scenario.name}-${page}`);
      if(outcome==='complete'){complete=true;break;}expect(outcome).toBe('progress');
    }
    expect(complete).toBe(true);expect(await publicCurrentProjectionReady(db)).toBe(true);
   }
   const readLog:ReadRecord[]=[],writeLog:ReadRecord[]=[];const start=performance.now();let resultIndex=0;
   for(let cycle=0;cycle<workload.cycles;cycle++){
    for(let group=0;group<scenario.mutationGroupsPerCycle;group++)await mutationGroup(metered(db,writeLog),count,cycle,group);
    if((cycle+1)%scenario.readEveryCycles===0){
     const result=await publicRead(mode,metered(db,readLog),workload.queries[cycle%workload.queries.length]!,NOW+cycle*workload.intervalMs);
     if(mode==='A')expected.push(result);else expect(result,`cycle ${cycle}`).toEqual(expected[resultIndex]);
     resultIndex++;
    }
   }
   expect(sum(readLog).writes).toBe(0);
   measurements[mode]={reads:sum(readLog),writes:sum(writeLog),total:sum([...readLog,...writeLog]),elapsedMs:performance.now()-start,mutationGroups:workload.cycles*scenario.mutationGroupsPerCycle,publicOperations:resultIndex*(mode==='A'?3:1)};
   const progress=await sourceProgress();if(mode==='A')beforeProgress=progress;else expect(progress).toEqual(beforeProgress);
  }
 }finally{await restore();}
 const before=measurements.A!,after=measurements.B!;
 const extraWriteUnits=after.writes.units-before.writes.units,savedReadUnits=before.reads.units-after.reads.units;
 const comparison={count,scenario:scenario.name,construction:sum(constructionLog),before,after,weightedReduction:1-after.total.units/before.total.units,extraWriteUnits,savedReadUnits,readGroups:expected.length,breakEvenReadGroups:savedReadUnits>0?Math.ceil(Math.max(0,extraWriteUnits)/(savedReadUnits/expected.length)):null,progressEqual:true};
 console.log('PUBLIC_CURRENT_DAY_COST',JSON.stringify(comparison));
 if(scenario.requiredWeightedReduction!==null)expect(after.total.units).toBeLessThanOrEqual(before.total.units*(1-scenario.requiredWeightedReduction));
},600_000);
