import {env} from 'cloudflare:workers';
import {beforeEach,expect,it,vi} from 'vitest';
import {clearCatalogFixtures} from './catalog-fixtures';
import {admitPilotBatch,parsePilotAdmission} from '../../src/catalog/pilot-admission';
import {measureD1Invocation} from '../../src/db/invocation-metrics';
import type {Env} from '../../src/types';
import {produceRenewalPilot,consumeRenewalPilot} from '../../src/phases/renewal-pilot';
import {runWithBackgroundBudget} from '../../src/db/background-budget';
import {PILOT_RENEWAL_HEADROOM} from '../../src/catalog/pilot-policy';
import type {DiscoveryMessage} from '../../src/catalog/pilot-discovery-agenda';
import {createWorker} from '../../src/index';
import type {D1DatabaseLike} from '../../src/db/client';
const NOW=1_800_000_000_000;
const settings=()=>({...env,CATALOG_PILOT_PAUSED:'1',CATALOG_PILOT_SEED_ENABLED:'1',BACKGROUND_COST_CONTROLS_ENABLED:'1'} as unknown as Env);
beforeEach(async()=>{
 await clearCatalogFixtures();
 await env.DB.prepare('DELETE FROM catalog_pilot_discovery_work').run();
 await env.DB.prepare('DELETE FROM catalog_pilot_origin_schedule').run();
 await env.DB.prepare('DELETE FROM catalog_pilot_admissions WHERE slot>19').run();
 await env.DB.prepare("DELETE FROM runtime_state WHERE key LIKE 'background_%'").run();
 for(let i=0;i<11;i++){
  const id=String(100000+i),key=`eip155:56:${id}`;
  await env.DB.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES(?,?,56,'ok','current',0,0)").bind(key,id).run();
  await env.DB.prepare("INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt) VALUES(?,'a2a',?,?,'safe','operational','a2a','eligible',0)").bind(id,`https://seller${id}.example.com/`,id).run();
  await env.DB.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt) VALUES(?,?,'current','v1',0,0)").bind(key,id).run();
 }
});
it('rejects malformed, cross-network, duplicate and oversized requests',()=>{
 for(const agentIds of [[],['0'],['01'],['56:1'],['1','1'],Array.from({length:11},(_,i)=>String(i+1))])expect(()=>parsePilotAdmission({batchId:'batch-test',agentIds})).toThrow();
 expect(()=>parsePilotAdmission({batchId:'batch-test',agentIds:['1'],chainId:97})).toThrow();
});
it('admits ten atomically, is idempotent and refuses an eleventh without losing work',async()=>{
 const request={batchId:'batch-test',agentIds:Array.from({length:10},(_,i)=>String(100000+i))};
 const meter=measureD1Invocation(env.DB);
 expect(await admitPilotBatch({...settings(),DB:meter.db as Env['DB']},request,NOW)).toMatchObject({status:'completed',value:{admitted:request.agentIds,skipped:[]}});
 expect(meter.snapshot().complete).toBe(true);
 expect(meter.snapshot().rowsRead!+1000*meter.snapshot().rowsWritten!).toBeLessThan(500000);
 expect(meter.snapshot()).toMatchSnapshot('ten-agent admission');
 const before=(await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work ORDER BY workKey').all()).results;
 await admitPilotBatch(settings(),request,NOW+1);
 expect((await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work ORDER BY workKey').all()).results).toEqual(before);
 expect(await admitPilotBatch(settings(),{batchId:'batch-extra',agentIds:['100010']},NOW+2)).toMatchObject({status:'completed',value:{admitted:[],skipped:['100010']}});
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_pilot_admissions').first()).toEqual({n:29});
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_quote_requests').first()).toEqual({n:0});
});
it('preserves renewal headroom and never borrows jobs budget',async()=>{
 const day=new Date(NOW).toISOString().slice(0,10);
 await env.DB.prepare('INSERT INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES(?,?,?,?)').bind(`background_budget:${day}:maintenance`,'granted',6_000_000,NOW).run();
 expect(await admitPilotBatch(settings(),{batchId:'batch-headroom',agentIds:['100000']},NOW)).toMatchObject({status:'completed',value:{admitted:[],skipped:['100000']}});
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_pilot_discovery_work').first()).toEqual({n:0});
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM runtime_state WHERE key LIKE 'background_budget:%:jobs'").first()).toEqual({n:0});
});
it('spreads admissions across origins and rejects withdrawn declarations',async()=>{
 await env.DB.prepare("UPDATE catalog_endpoints SET originKey='shared'").run();
 await env.DB.prepare("UPDATE catalog_agent_endpoints SET declarationState='removed' WHERE endpointKey='100000'").run();
 expect(await admitPilotBatch(settings(),{batchId:'batch-fair',agentIds:['100000','100001','100002']},NOW)).toMatchObject({status:'completed',value:{admitted:['100001'],skipped:['100000','100002']}});
});
it('does not admit suspended capabilities or Testnet identities and retains future backoff',async()=>{
 await env.DB.prepare("INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,nextProbeAt,createdAt,updatedAt) VALUES('eip155:56:100000','100000','a2a','suspended',0,0,0)").run();
 await env.DB.prepare("INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,nextProbeAt,consecutiveFailures,createdAt,updatedAt) VALUES('eip155:56:100001','100001','a2a','failed',?,2,0,0)").bind(NOW+86400000).run();
 await env.DB.prepare("UPDATE catalog_agents SET agentKey='eip155:97:100002',chainId=97 WHERE agentKey='eip155:56:100002'").run();
 expect(await admitPilotBatch(settings(),{batchId:'batch-safety',agentIds:['100000','100001','100002']},NOW)).toMatchObject({status:'completed',value:{admitted:['100001'],skipped:['100000','100002']}});
 expect(await env.DB.prepare('SELECT chainId,nextAttemptAt,failures FROM catalog_pilot_discovery_work').first()).toEqual({chainId:56,nextAttemptAt:NOW+86400000,failures:2});
});
it('does not close the renewal lane when discovery reaches its protected floor',async()=>{
 const day=new Date(NOW).toISOString().slice(0,10);
 await env.DB.prepare('INSERT INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES(?,?,?,?)').bind(`background_budget:${day}:maintenance`,'granted',7_000_000,NOW).run();
 const callback=vi.fn(async()=>true);
 expect((await runWithBackgroundBudget(env.DB as unknown as D1DatabaseLike,'maintenance','initial',NOW,callback,{estimateNanoUsd:150000,protectedNanoUsd:PILOT_RENEWAL_HEADROOM})).status).toBe('denied');
 expect(callback).not.toHaveBeenCalled();
 expect((await runWithBackgroundBudget(env.DB as unknown as D1DatabaseLike,'maintenance','refresh',NOW,callback,{estimateNanoUsd:150000})).status).toBe('completed');
 expect(callback).toHaveBeenCalledOnce();
});
it('gates the HTTP admission route and rejects invalid input before writes',async()=>{
 const app=createWorker({now:()=>NOW}),url='https://worker.test/__admin/renewal-pilot/admit';
 const config={...settings(),SHARED_SECRET:'local-only',KILL_SWITCH:'0',PRODUCER_KILL_SWITCH:'0'};
 expect((await app.fetch(new Request(url,{method:'POST'}),config)).status).toBe(401);
 expect((await app.fetch(new Request(url,{method:'POST',headers:{authorization:'Bearer local-only'},body:'{}'}),config)).status).toBe(400);
 expect((await app.fetch(new Request(url,{method:'POST'}),{...config,CATALOG_PILOT_SEED_ENABLED:'0'})).status).toBe(404);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_pilot_admissions').first()).toEqual({n:19});
});
it('defers an initial delivery durably when renewal headroom is reached, with no seller request',async()=>{
 const base={...settings(),KILL_SWITCH:'0',PRODUCER_KILL_SWITCH:'0',STAGING_MANUAL_RUN:'0'};
 await admitPilotBatch(base,{batchId:'batch-defer',agentIds:['100000']},NOW);
 const messages:DiscoveryMessage[]=[];
 const active={...base,CATALOG_PILOT_PAUSED:'0',CATALOG_PILOT_QUEUE:{send:async(body:unknown)=>{messages.push(body as DiscoveryMessage);}}} as Env;
 await produceRenewalPilot(active,NOW+60001);
 expect(messages).toHaveLength(1);
 const work=messages[0]!,day=new Date(NOW).toISOString().slice(0,10);
 await env.DB.prepare('UPDATE runtime_state SET integerValue=7000000 WHERE key=?').bind(`background_budget:${day}:maintenance`).run();
 const fetchImpl=vi.fn(),ack=vi.fn();
 const batch={messages:[{id:work.runId,timestamp:new Date(NOW),body:work,attempts:1,ack,retry:vi.fn()}]};
 expect((await consumeRenewalPilot(batch,active,()=>NOW+60002,{fetchImpl})).status).toBe('denied');
 expect(fetchImpl).not.toHaveBeenCalled();expect(ack).toHaveBeenCalledOnce();
 const row=await env.DB.prepare('SELECT state,cohort,runId,nextAttemptAt FROM catalog_pilot_discovery_work').first();
 expect(row).toEqual({state:'scheduled',cohort:'initial',runId:null,nextAttemptAt:Date.parse(day+'T00:00:00Z')+86400000});
 expect((await consumeRenewalPilot(batch,active,()=>NOW+60003,{fetchImpl})).status).toBe('obsolete');
 expect(await env.DB.prepare('SELECT state,cohort,runId,nextAttemptAt FROM catalog_pilot_discovery_work').first()).toEqual(row);
});
it('concurrent admission cannot oversubscribe or reset tasks',async()=>{
 const request={batchId:'batch-race',agentIds:Array.from({length:10},(_,i)=>String(100000+i))};
 const results=await Promise.all([admitPilotBatch(settings(),request,NOW),admitPilotBatch(settings(),request,NOW)]);
 expect(results.every(r=>r.status==='completed')).toBe(true);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_pilot_admissions').first()).toEqual({n:29});
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_pilot_discovery_work').first()).toEqual({n:10});
});
it.each([2000,20000])('completes new-agent discovery and renewal locally with %i unrelated agents',async(size)=>{
 await env.DB.prepare(`WITH RECURSIVE n(i) AS(SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
 INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt)
 SELECT 'eip155:97:'||i,CAST(i AS TEXT),97,'ok','current',0,0 FROM n`).bind(size).run();
 const meter=measureD1Invocation(env.DB),config={...settings(),DB:meter.db as Env['DB'],KILL_SWITCH:'0',PRODUCER_KILL_SWITCH:'0',STAGING_MANUAL_RUN:'0'};
 expect(await admitPilotBatch(config,{batchId:'batch-cycle',agentIds:['100000']},NOW)).toMatchObject({value:{admitted:['100000']}});
 const messages:DiscoveryMessage[]=[];
 const active={...config,CATALOG_PILOT_PAUSED:'0',CATALOG_PILOT_QUEUE:{send:async(body:unknown)=>{messages.push(body as DiscoveryMessage);}}} as Env;
 const contract={encoding:'prefixed-json',taskDescriptionPrefix:'SERVICE_V1:',inputSchema:{type:'object',required:['topic'],properties:{topic:{type:'string'}}},terms:{deliverables:'Report',quality_standards:'Cited',evaluation_required:true,evaluator_type:'uma_oov3'}};
 const fetchImpl=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  expect(init?.method??'GET').toBe('GET');
  return Response.json({name:'Seller',url:String(input),skills:[{id:'negotiate'}],capabilities:{extensions:[{uri:'https://marketplace.trust8004.xyz/extensions/negotiation-input/v1',params:contract}]}});
 });
 for(let cycle=0;cycle<3;cycle++){
  const task=await env.DB.prepare("SELECT nextAttemptAt FROM catalog_pilot_discovery_work WHERE agentKey='eip155:56:100000'").first<{nextAttemptAt:number}>();
  const now=task!.nextAttemptAt+60001;
  await produceRenewalPilot(active,now);expect(messages).toHaveLength(1);
  const body=messages.shift()!;
  expect(await consumeRenewalPilot({messages:[{id:body.runId,timestamp:new Date(now),body,attempts:1,ack:()=>{},retry:()=>{throw Error('unexpected retry');}}]},active,()=>now+1,{fetchImpl})).toMatchObject({status:'completed',value:{compatibilitySucceeded:true}});
 }
 expect(fetchImpl).toHaveBeenCalledTimes(3);
 expect(meter.snapshot().complete).toBe(true);
 expect(meter.snapshot().rowsRead!+1000*meter.snapshot().rowsWritten!).toBeLessThan(500000);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_quote_requests').first()).toEqual({n:0});
});
