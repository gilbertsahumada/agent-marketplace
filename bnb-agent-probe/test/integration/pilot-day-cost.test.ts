import { env } from 'cloudflare:workers';
import { expect,it } from 'vitest';
import { clearCatalogFixtures } from './catalog-fixtures';
import { PILOT_AGENT_IDS, ORIGINAL_PILOT_AGENT_IDS } from '../../src/catalog/pilot-policy';
import { upsertDiscoveryWork,type DiscoveryMessage } from '../../src/catalog/pilot-discovery-agenda';
import { produceRenewalPilot,consumeRenewalPilot } from '../../src/phases/renewal-pilot';
import { discoveryContextVersion } from '../../src/phases/catalog-pilot-discovery';
import { measureD1Invocation } from '../../src/db/invocation-metrics';
import type { Env } from '../../src/types';
import type { D1DatabaseLike } from '../../src/db/client';
import {admitPilotBatch} from '../../src/catalog/pilot-admission';
const START=1_800_000_000_000;
const contract={encoding:'prefixed-json',taskDescriptionPrefix:'SERVICE_V1:',inputSchema:{type:'object',required:['topic'],properties:{topic:{type:'string'}}},
  capabilityProbeParameters:{topic:'sample'},terms:{deliverables:'Report',quality_standards:'Cited',evaluation_required:true,evaluator_type:'uma_oov3'}};
it.each([2000,20000].flatMap(noise=>[13,19,29].map(size=>({noise,size}))))('48h pilot, $noise unrelated agents, size=$size',async({noise,size})=>{
  const additions=Array.from({length:10},(_,i)=>String(100000+i));
  const ids=size===13?ORIGINAL_PILOT_AGENT_IDS:size===19?PILOT_AGENT_IDS:[...PILOT_AGENT_IDS,...additions];
  await clearCatalogFixtures();
  await env.DB.prepare('DELETE FROM catalog_pilot_discovery_work').run();
  await env.DB.prepare('DELETE FROM catalog_pilot_origin_schedule').run();
  await env.DB.prepare('DELETE FROM catalog_pilot_admissions WHERE slot>19').run();
  await env.DB.prepare("DELETE FROM runtime_state WHERE key LIKE 'background_%' OR key LIKE 'catalog_pilot_%'").run();
  await env.DB.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
    INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt)
    SELECT 'eip155:'||CASE WHEN x%2=0 THEN 56 ELSE 97 END||':'||(900000+x),CAST(900000+x AS TEXT),CASE WHEN x%2=0 THEN 56 ELSE 97 END,'ok','current',0,0 FROM n`).bind(noise).run();
  const db=env.DB as unknown as D1DatabaseLike;
  for(const id of ids){
    const key=`eip155:56:${id}`,endpoint=`https://seller.example.com/${id}`,endpointKey=`endpoint-${id}`;
    await env.DB.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES(?,?,56,'ok','current',0,0)").bind(key,id).run();
    const origin=additions.includes(id)?`origin-${id}`:'shared';
    await env.DB.prepare("INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt) VALUES(?,'a2a',?,?,'safe','operational','a2a','eligible',0)").bind(endpointKey,endpoint,origin).run();
    await env.DB.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt) VALUES(?,?,'current','v1',0,0)").bind(key,endpointKey).run();
    if(!additions.includes(id))await upsertDiscoveryWork(db,{agentKey:key,endpointKey,originKey:origin,chainId:56,transport:'a2a',contextVersion:discoveryContextVersion({endpoint,transport:'a2a',metadataVersion:'v1'})},START);
  }
  if(size===29)expect(await admitPilotBatch({...env,CATALOG_PILOT_PAUSED:'1',CATALOG_PILOT_SEED_ENABLED:'1',BACKGROUND_COST_CONTROLS_ENABLED:'1'} as unknown as Env,{batchId:'batch-48h',agentIds:additions},START)).toMatchObject({status:'completed',value:{admitted:additions}});
  const messages:DiscoveryMessage[]=[];
  const meter=measureD1Invocation(env.DB);
  const config={...env,DB:meter.db,KILL_SWITCH:'0',PRODUCER_KILL_SWITCH:'0',CATALOG_PILOT_PAUSED:'0',BACKGROUND_COST_CONTROLS_ENABLED:'1',STAGING_MANUAL_RUN:'0',
    CATALOG_PILOT_QUEUE:{send:async(body:unknown)=>{messages.push(body as DiscoveryMessage);}}} as unknown as Env;
  let completed=0,requests=0;
  for(let minute=0;minute<48*60;minute++){
    const now=START+minute*60_000;
    await produceRenewalPilot(config,now);
    expect(messages.length).toBeLessThanOrEqual(1);
    for(const work of messages.splice(0)){
      let acknowledged=false;
      const result=await consumeRenewalPilot({messages:[{id:work.runId,timestamp:new Date(now),body:work,attempts:1,
        ack:()=>{acknowledged=true;},retry:()=>{throw Error('unexpected retry');}}]},config,()=>now+1,{fetchImpl:async(_input,init)=>{
          expect(init?.method??'GET').toBe('GET');requests++;
          return Response.json({name:'Seller',url:String(_input),skills:[{id:'negotiate'}],capabilities:{extensions:[{uri:'https://marketplace.trust8004.xyz/extensions/negotiation-input/v1',params:contract}]}});
        }});
      expect(acknowledged).toBe(true);
      expect(result.status).toBe('completed');
      if(result.status==='completed')expect(result.value).toMatchObject({errorCode:null,compatibilitySucceeded:true});
      if(result.status==='completed'&&result.value.compatibilitySucceeded)completed++;
    }
  }
  expect(completed).toBe(ids.length*3);expect(requests).toBe(ids.length*3);
  expect(meter.snapshot().complete).toBe(true);
  // One additional keyed read per consumer selects protected initial budget.
  // Report this overhead instead of calling extra progress a cost reduction.
  if(size<29)expect(meter.snapshot()).toMatchObject(size===19
    ? {rowsRead:25_639,rowsWritten:2_247,queries:12_887}
    : {rowsRead:23_703,rowsWritten:1_539,queries:12_463});
  else {
    expect(meter.snapshot().rowsRead!+1000*meter.snapshot().rowsWritten!).toBeLessThan(5_000_000);
    expect(meter.snapshot()).toMatchSnapshot();
  }
  const budgets=await env.DB.prepare("SELECT integerValue FROM runtime_state WHERE key LIKE 'background_budget:%:maintenance'").all<{integerValue:number}>();
  expect(budgets.results!.every(row=>row.integerValue<15_000_000)).toBe(true);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_quote_requests').first()).toEqual({n:0});
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_seller_capabilities WHERE compatibilityExpiresAt>?').bind(START+48*3_600_000).first()).toEqual({n:ids.length});
  console.log(JSON.stringify({fixture:noise,size,hours:48,completed,requests,...meter.snapshot()}));
},240_000);
