import type {D1DatabaseLike} from '../db/client';
import type {Env} from '../types';
import {runWithBackgroundBudget,BACKGROUND_LANE_NANO_USD} from '../db/background-budget';
import {discoveryStatement as statement,discoveryBatch} from '../db/pilot-discovery-store';
import {upsertDiscoveryBatchStatements,type DiscoveryContext} from './pilot-discovery-agenda';
import {isPilotAgentKey,PILOT_BATCH_LIMIT,PILOT_RENEWAL_HEADROOM,pilotRenewalDelay} from './pilot-policy';
import {discoveryContextVersion} from '../phases/catalog-pilot-discovery';

export function parsePilotAdmission(value:unknown):{batchId:string;agentIds:string[]}{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('PILOT_ADMISSION_INVALID');
 const data=value as Record<string,unknown>;
 if(Object.keys(data).some(key=>!['batchId','agentIds'].includes(key))||typeof data.batchId!=='string'
   ||!/^batch-[a-z0-9-]{1,60}$/.test(data.batchId)||!Array.isArray(data.agentIds)||data.agentIds.length<1||data.agentIds.length>PILOT_BATCH_LIMIT
   ||data.agentIds.some(id=>typeof id!=='string'||!isPilotAgentKey(`eip155:56:${id}`))||new Set(data.agentIds).size!==data.agentIds.length)throw Error('PILOT_ADMISSION_INVALID');
 return {batchId:data.batchId,agentIds:data.agentIds as string[]};
}

/** Explicit ID input only; never scans or automatically widens the catalogue.
 * Membership and durable outbox are committed together. No availability write.
 * Release gate remains closed until end-to-end budget validation is approved. */
export async function admitPilotBatch(env:Env,input:unknown,now:number){
 const request=parsePilotAdmission(input);
 if(env.CATALOG_PILOT_PAUSED!=='1'||env.CATALOG_PILOT_SEED_ENABLED!=='1'||env.BACKGROUND_COST_CONTROLS_ENABLED!=='1')throw Error('PILOT_ADMISSION_REQUIRES_PAUSE');
 return runWithBackgroundBudget(env.DB as unknown as D1DatabaseLike,'maintenance','pilot.admission',now,async db=>{
  const candidates:DiscoveryContext[]=[];
  const skipped:string[]=[];
  const origins=new Set<string>();
  for(const id of request.agentIds){
   const agentKey=`eip155:56:${id}`;
   const row=await statement(db,`SELECT e.endpointKey,COALESCE(e.originKey,e.endpointKey) originKey,e.endpoint,e.validationProtocol transport,
    ae.metadataVersion,c.compatibilityState,c.compatibilityCheckedAt,c.nextProbeAt,c.consecutiveFailures
    FROM catalog_agents a JOIN catalog_agent_endpoints ae ON ae.agentKey=a.agentKey
    JOIN catalog_endpoints e ON e.endpointKey=ae.endpointKey
    LEFT JOIN catalog_seller_capabilities c ON c.agentKey=a.agentKey AND c.endpointKey=e.endpointKey
    WHERE a.agentKey=? AND a.chainId=56 AND a.indexState='current' AND ae.declarationState='current'
      AND e.role='operational' AND e.eligibility='eligible' AND e.safety='safe' AND e.endpoint IS NOT NULL
      AND (c.state IS NULL OR c.state<>'suspended') AND e.validationProtocol IN ('a2a','mcp','erc8183_http')
    ORDER BY c.compatibilityCheckedAt DESC,e.endpointKey LIMIT 1`,[agentKey]).first<{
     endpointKey:string;originKey:string;endpoint:string;transport:string;metadataVersion:string|null;
     compatibilityState:string|null;compatibilityCheckedAt:number|null;nextProbeAt:number|null;consecutiveFailures:number|null;
    }>();
   // One new candidate per origin in a batch; retries do not consume more slots.
   if(!row||origins.has(row.originKey)){skipped.push(id);continue;}
   origins.add(row.originKey);
   candidates.push({...row,agentKey,chainId:56,contextVersion:discoveryContextVersion(row),previousFailures:row.consecutiveFailures??0,
    notBeforeMs:Math.max(row.nextProbeAt??0,row.compatibilityState==='compatible'&&row.compatibilityCheckedAt!==null
      ?row.compatibilityCheckedAt+pilotRenewalDelay(agentKey):0)});
  }
  const dayKey=`background_budget:${new Date(now).toISOString().slice(0,10)}:maintenance`;
  const writes=candidates.flatMap(context=>{
   const admission=statement(db,`WITH RECURSIVE slots(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM slots WHERE n<29)
    INSERT INTO catalog_pilot_admissions(slot,agentKey,batchId,admittedAt)
    SELECT n,?,?,? FROM slots WHERE NOT EXISTS(SELECT 1 FROM catalog_pilot_admissions WHERE slot=n)
      AND EXISTS(SELECT 1 FROM runtime_state WHERE key=? AND integerValue>=0 AND integerValue<=?
        AND textValue='granted') ORDER BY n LIMIT 1 ON CONFLICT(agentKey) DO NOTHING`,
    [context.agentKey,request.batchId,now,dayKey,BACKGROUND_LANE_NANO_USD.maintenance-PILOT_RENEWAL_HEADROOM]);
   return [admission,...upsertDiscoveryBatchStatements(db,[context],now,{requireAdmission:true})];
  });
  await discoveryBatch(db,writes);
  const admitted:string[]=[];
  for(const context of candidates){
   const result=await statement(db,'SELECT agentKey FROM catalog_pilot_discovery_work WHERE workKey=?',[`${context.agentKey}|${context.endpointKey}`]).first<{agentKey:string}>();
   if(result)admitted.push(context.agentKey.split(':')[2]!);else skipped.push(context.agentKey.split(':')[2]!);
  }
  return {admitted,skipped};
 },{estimateNanoUsd:500_000});
}
