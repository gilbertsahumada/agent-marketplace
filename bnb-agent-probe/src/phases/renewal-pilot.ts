import type { Env, QueueBatch } from '../types';
import type { D1DatabaseLike } from '../db/client';
import { BACKGROUND_LANE_NANO_USD, BACKGROUND_CONTROL_NANO_USD, runWithBackgroundBudget } from '../db/background-budget';
import { discoveryAgendaHasDue, produceDiscoveryAgenda, parseDiscoveryMessage, upsertDiscoveryWork } from '../catalog/pilot-discovery-agenda';
import { PILOT_AGENT_IDS, pilotRenewalDelay } from '../catalog/pilot-policy';
import { runBackgroundWindow } from './background-cadence';
import { runCatalogDiscovery, discoveryContextVersion, type DiscoveryDependencies } from './catalog-pilot-discovery';
import { loadConfig } from '../config';
import { discoveryStatement } from '../db/pilot-discovery-store';

const ESTIMATE=150_000;
type Control={key:string;integerValue:number|null;textValue:string|null};
/** Read-only admission hint; the authoritative reservation is still atomic. */
async function preflight(db:D1DatabaseLike,now:number,window:boolean):Promise<boolean>{
  const key=`background_budget:${new Date(now).toISOString().slice(0,10)}:maintenance`;
  const result=await discoveryStatement(db,'SELECT key,integerValue,textValue FROM runtime_state WHERE key IN (?,?)',
    [key,'background_renewal_pilot_window_v1']).run();
  const meta=result.meta as {rows_read?:number;rows_written?:number};
  if(!result.success||!Number.isSafeInteger(meta?.rows_read)||meta.rows_read!<0||meta.rows_written!==0||!result.results)throw Error('PILOT_CONTROL_UNKNOWN');
  for(const row of result.results as Control[]){
    if(row.key===key && (row.integerValue===null||!Number.isSafeInteger(row.integerValue)||row.integerValue<0))throw Error('PILOT_CONTROL_UNKNOWN');
    if(row.key===key && (row.textValue?.startsWith('denied:')||row.textValue?.startsWith('closed:')||row.integerValue!+ESTIMATE+BACKGROUND_CONTROL_NANO_USD>BACKGROUND_LANE_NANO_USD.maintenance))return false;
    if(window&&row.key==='background_renewal_pilot_window_v1'&&(row.integerValue??0)>now)return false;
  }
  return true;
}
export function pilotEnabled(env:Env):boolean{
  const config=loadConfig(env);
  return env.CATALOG_PILOT_PAUSED==='0'&&env.BACKGROUND_COST_CONTROLS_ENABLED==='1'
    &&env.STAGING_MANUAL_RUN!=='1'&&!config.killSwitch&&!config.producerKillSwitch;
}
export async function produceRenewalPilot(env:Env,now:number){
  if(!pilotEnabled(env))return {status:'paused'};
  if(!env.CATALOG_PILOT_QUEUE)throw Error('PILOT_QUEUE_REQUIRED');
  const db=env.DB as unknown as D1DatabaseLike;
  if(!await preflight(db,now,true))return {status:'deferred'};
  if(!await discoveryAgendaHasDue(db,now))return {status:'idle'};
  return runWithBackgroundBudget(db,'maintenance','pilot.producer',now,async admitted=>{
    let summary:unknown={status:'duplicate'};
    await runBackgroundWindow(admitted,'renewal_pilot',now,60_000,async()=>{
      summary=await produceDiscoveryAgenda(admitted,env.CATALOG_PILOT_QUEUE!,{
        nowMs:now,maxOrigins:1,originPerMinute:1,combinedLimits:{56:1,97:0},
        limits:{56:{initial:1,refresh:1},97:{initial:0,refresh:0}},
      });
    });
    return summary;
  },{estimateNanoUsd:ESTIMATE});
}
export async function consumeRenewalPilot(batch:QueueBatch,env:Env,now:()=>number,dependencies:Omit<DiscoveryDependencies,'now'>={}){
  if(batch.messages.length!==1)throw Error('PILOT_BATCH_MUST_EQUAL_ONE');
  const message=batch.messages[0]!;
  const work=parseDiscoveryMessage(message.body,now());
  // An ACK is safe here: the durable outbox, not Queue retention, owns work.
  if(!pilotEnabled(env)){message.ack();return {status:'paused' as const};}
  const db=env.DB as unknown as D1DatabaseLike;
  if(!await preflight(db,now(),false)){message.ack();return {status:'deferred' as const};}
  const result=await runWithBackgroundBudget(db,'maintenance','pilot.consumer',now(),async admitted=>
    runCatalogDiscovery(work,{...env,DB:admitted as unknown as Env['DB']},loadConfig(env),{...dependencies,now}),{estimateNanoUsd:ESTIMATE});
  message.ack();
  return result;
}
/** Release-only, fixed-ID initialization. Never scans or backfills the catalogue. */
export async function seedRenewalPilot(env:Env,now:number){
  if(env.CATALOG_PILOT_PAUSED!=='1'||env.BACKGROUND_COST_CONTROLS_ENABLED!=='1')throw Error('PILOT_SEED_REQUIRES_PAUSE');
  return runWithBackgroundBudget(env.DB as unknown as D1DatabaseLike,'maintenance','pilot.seed',now,async db=>{
    let admitted=0,unavailable=0;
    for(const id of PILOT_AGENT_IDS){
      const agentKey=`eip155:56:${id}`;
      const row=await discoveryStatement(db,`SELECT e.endpointKey,COALESCE(e.originKey,e.endpointKey) originKey,e.endpoint,e.validationProtocol transport,
        ae.metadataVersion,c.compatibilityState,c.compatibilityCheckedAt,c.nextProbeAt,c.consecutiveFailures
        FROM catalog_agents a JOIN catalog_agent_endpoints ae ON ae.agentKey=a.agentKey
        JOIN catalog_endpoints e ON e.endpointKey=ae.endpointKey
        JOIN catalog_seller_capabilities c ON c.agentKey=a.agentKey AND c.endpointKey=e.endpointKey
        WHERE a.agentKey=? AND a.chainId=56 AND a.indexState='current' AND ae.declarationState='current'
          AND e.role='operational' AND e.eligibility='eligible' AND e.safety='safe' AND c.state<>'suspended'
          AND e.validationProtocol IN ('a2a','mcp','erc8183_http')
        ORDER BY c.compatibilityCheckedAt DESC,e.endpointKey LIMIT 1`,[agentKey]).first<{
          endpointKey:string;originKey:string;endpoint:string;transport:string;metadataVersion:string|null;
          compatibilityState:string;compatibilityCheckedAt:number|null;nextProbeAt:number|null;consecutiveFailures:number;
        }>();
      if(!row){unavailable++;continue;}
      await upsertDiscoveryWork(db,{...row,agentKey,chainId:56,contextVersion:discoveryContextVersion(row),initialCohort:'refresh',
        previousFailures:row.consecutiveFailures,notBeforeMs:Math.max(row.nextProbeAt??0,
          row.compatibilityState==='compatible'&&row.compatibilityCheckedAt!==null?row.compatibilityCheckedAt+pilotRenewalDelay(agentKey):0)},now);
      admitted++;
    }
    return {admitted,unavailable};
  },{estimateNanoUsd:500_000});
}
