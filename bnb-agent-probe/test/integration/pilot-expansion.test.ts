import {env} from 'cloudflare:workers';
import {beforeEach,expect,it,vi} from 'vitest';
import {clearCatalogFixtures} from './catalog-fixtures';
import {PILOT_EXPANSION_AGENT_IDS} from '../../src/catalog/pilot-policy';
import {seedRenewalPilot,produceRenewalPilot,consumeRenewalPilot} from '../../src/phases/renewal-pilot';
import {measureD1Invocation} from '../../src/db/invocation-metrics';
import {createWorker} from '../../src/index';
import type {Env} from '../../src/types';
import type {DiscoveryMessage} from '../../src/catalog/pilot-discovery-agenda';
const NOW=1_800_000_000_000;
const contract={encoding:'prefixed-json',taskDescriptionPrefix:'SERVICE_V1:',inputSchema:{type:'object',required:['topic'],properties:{topic:{type:'string'}}},terms:{deliverables:'Report',quality_standards:'Cited',evaluation_required:true,evaluator_type:'uma_oov3'}};
const settings=()=>({...env,KILL_SWITCH:'0',PRODUCER_KILL_SWITCH:'0',CATALOG_PILOT_PAUSED:'1',CATALOG_PILOT_SEED_ENABLED:'1',BACKGROUND_COST_CONTROLS_ENABLED:'1',STAGING_MANUAL_RUN:'0',SHARED_SECRET:'local-only',CATALOG_V2_READS_ENABLED:'1'} as unknown as Env);
beforeEach(async()=>{
 await clearCatalogFixtures();
 await env.DB.prepare('DELETE FROM catalog_pilot_discovery_work').run();
 await env.DB.prepare('DELETE FROM catalog_pilot_origin_schedule').run();
 await env.DB.prepare("DELETE FROM runtime_state WHERE key LIKE 'background_%'").run();
 for(const id of PILOT_EXPANSION_AGENT_IDS){
  const key=`eip155:56:${id}`,endpoint=`ep-${id}`;
  await env.DB.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES(?,?,56,'ok','current',0,0)").bind(key,id).run();
  await env.DB.prepare("INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt) VALUES(?,'a2a',?,'shared','safe','operational','a2a','eligible',0)").bind(endpoint,`https://seller.example.com/${id}`).run();
  await env.DB.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt) VALUES(?,?,'current','v1',0,0)").bind(key,endpoint).run();
  await env.DB.prepare("INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,compatibilityCheckedAt,compatibilityExpiresAt,nextProbeAt,consecutiveFailures,lastErrorCode,createdAt,updatedAt) VALUES(?,?,'a2a','failed','compatible',?,?,?,3,'NEGOTIATION_PARAMETERS_UNAVAILABLE',0,0)").bind(key,endpoint,NOW-2*86_400_000,NOW-86_400_000,NOW-1).run();
 }
});
it('requires authentication and the paused temporary seed gate for expansion',async()=>{
 const app=createWorker({now:()=>NOW});
 const request=(secret?:string)=>new Request('https://worker.test/__admin/renewal-pilot/seed-expansion',{method:'POST',headers:secret?{authorization:`Bearer ${secret}`}:{}});
 expect((await app.fetch(request(),settings())).status).toBe(401);
 expect((await app.fetch(request('local-only'),{...settings(),CATALOG_PILOT_SEED_ENABLED:'0'})).status).toBe(404);
 expect((await app.fetch(request('local-only'),{...settings(),CATALOG_PILOT_PAUSED:'0'})).status).toBe(404);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_pilot_discovery_work').first()).toEqual({n:0});
});
it('excludes suspended or withdrawn endpoints and preserves a future backoff',async()=>{
 await env.DB.prepare("UPDATE catalog_seller_capabilities SET state='suspended' WHERE agentKey='eip155:56:204789'").run();
 await env.DB.prepare("UPDATE catalog_agent_endpoints SET declarationState='removed' WHERE agentKey='eip155:56:212769'").run();
 await env.DB.prepare("UPDATE catalog_endpoints SET eligibility='unsupported' WHERE endpointKey='ep-212943'").run();
 await env.DB.prepare("UPDATE catalog_seller_capabilities SET nextProbeAt=? WHERE agentKey='eip155:56:213036'").bind(NOW+48*3_600_000).run();
 expect(await seedRenewalPilot(settings(),NOW,'expansion')).toMatchObject({status:'completed',value:{admitted:3,unavailable:3}});
 expect(await env.DB.prepare("SELECT nextAttemptAt,failures FROM catalog_pilot_discovery_work WHERE agentKey='eip155:56:213036'").first()).toEqual({nextAttemptAt:NOW+48*3_600_000,failures:3});
});
it('does not seed when maintenance budget is exhausted or borrow the jobs lane',async()=>{
 const day=new Date(NOW).toISOString().slice(0,10);
 await env.DB.prepare('INSERT INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES(?,?,?,?)').bind(`background_budget:${day}:maintenance`,'granted',15_000_000,NOW).run();
 const result=await seedRenewalPilot(settings(),NOW,'expansion');
 expect(result.status).not.toBe('completed');
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_pilot_discovery_work').first()).toEqual({n:0});
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM runtime_state WHERE key LIKE 'background_budget:%:jobs'").first()).toEqual({n:0});
});
it('seeds six only, preserves original tasks, and recovers public requestability without test parameters or quotes',async()=>{
 await env.DB.prepare("INSERT INTO catalog_pilot_discovery_work(workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,state,nextAttemptAt,deliveryAt,runId,executionFence,updatedAt) VALUES('old','eip155:56:341563','old','old',56,'a2a','v1','running',?,?,'old-run',7,123)").bind(NOW+86_400_000,NOW+86_400_000).run();
 const old=await env.DB.prepare("SELECT * FROM catalog_pilot_discovery_work WHERE workKey='old'").first();
 const meter=measureD1Invocation(env.DB);
 expect(await seedRenewalPilot({...settings(),DB:meter.db as Env['DB']},NOW,'expansion')).toMatchObject({status:'completed',value:{admitted:6,unavailable:0}});
 expect(meter.snapshot()).toMatchObject({complete:true});
 expect(meter.snapshot().rowsRead!+1000*meter.snapshot().rowsWritten!).toBeLessThan(500_000);
 expect(meter.snapshot()).toMatchInlineSnapshot(`
   {
     "complete": true,
     "knownRowsRead": 103,
     "knownRowsWritten": 29,
     "queries": 20,
     "rowsRead": 103,
     "rowsWritten": 29,
     "unmeasuredQueries": 0,
   }
 `);
 expect(await env.DB.prepare("SELECT * FROM catalog_pilot_discovery_work WHERE workKey='old'").first()).toEqual(old);
 const before=await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work ORDER BY workKey').all();
 await seedRenewalPilot(settings(),NOW+1,'expansion');
 expect((await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work ORDER BY workKey').all()).results).toEqual(before.results);
 const messages:DiscoveryMessage[]=[],fetchImpl=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  expect(init?.method??'GET').toBe('GET');
  return Response.json({name:'Seller',url:String(input),skills:[{id:'negotiate'}],capabilities:{extensions:[{uri:'https://marketplace.trust8004.xyz/extensions/negotiation-input/v1',params:contract}]}});
 });
 const config={...settings(),CATALOG_PILOT_PAUSED:'0',CATALOG_PILOT_QUEUE:{send:async(body:unknown)=>{messages.push(body as DiscoveryMessage);}}} as Env;
 for(let minute=1;minute<=6;minute++){
  const now=NOW+minute*60_000;
  await produceRenewalPilot(config,now);expect(messages).toHaveLength(1);
  const work=messages.shift()!;
  const result=await consumeRenewalPilot({messages:[{id:work.runId,timestamp:new Date(now),body:work,attempts:1,ack:()=>{},retry:()=>{throw Error('unexpected retry');}}]},config,()=>now+1,{fetchImpl});
  expect(result).toMatchObject({status:'completed',value:{compatibilitySucceeded:true,errorCode:null}});
 }
 expect(fetchImpl).toHaveBeenCalledTimes(6);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_quote_requests').first()).toEqual({n:0});
 const app=createWorker({now:()=>NOW+7*60_000});
 const response=await app.fetch(new Request('https://worker.test/catalog-agents?chain=56&scope=hiring&facets=true'),config);
 const body=await response.json() as {total:number;items:Array<{state:{canRequestQuote:boolean;canPrepareHire:boolean}}>};
 expect(body.total).toBe(6);
 expect(body.items.every(item=>item.state.canRequestQuote&&!item.state.canPrepareHire)).toBe(true);
 expect(await env.DB.prepare("SELECT * FROM catalog_pilot_discovery_work WHERE workKey='old'").first()).toEqual(old);
});
