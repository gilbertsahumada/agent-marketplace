import type { D1DatabaseLike } from '../db/client';
import { discoveryStatement as statement, type DiscoveryStatement } from '../db/pilot-discovery-store';
import type { Env } from '../types';
import type { WorkerConfig } from '../config';
import { claimDiscoveryExecution, completeDiscoveryExecution, discoveryFencePredicate,
  DISCOVERY_REFRESH_MS, type DiscoveryMessage, type DiscoveryClaim, type DiscoveryCommitGuard } from '../catalog/pilot-discovery-agenda';
import { discoverNegotiationInput, SellerProbeError } from '../lib/seller-client';
import { probeCatalogEndpoint, type CatalogProbeObservation, type CatalogProbeProtocol } from './catalog-probe';
import { NEGOTIATION_DETECTOR_VERSION } from '../../../src/shared/negotiation-profiles';
import type { NegotiationContract } from '../../../src/shared/negotiation-input';
import type { CatalogCapabilityProbeSummary } from './catalog-capability';
import { pilotRenewalDelay } from '../catalog/pilot-policy';
import { sha256 } from '../routes/catalog-quotes';

interface Target {agentKey:string;endpointKey:string;originKey:string;endpoint:string;transport:CatalogProbeProtocol;chainId:56|97;metadataVersion:string|null;
  state:string|null;consecutiveFailures:number|null;nextProbeAt:number|null;compatibilityState:string|null;compatibilityCheckedAt:number|null;compatibilityExpiresAt:number|null;schemaHash:string|null}
async function target(db:D1DatabaseLike,agentKey:string,endpointKey:string){
  return statement(db,`SELECT a.agentKey,e.endpointKey,COALESCE(e.originKey,e.endpointKey) originKey,e.endpoint,e.validationProtocol transport,
    a.chainId,ae.metadataVersion,c.state,c.consecutiveFailures,c.nextProbeAt,c.compatibilityState,c.compatibilityCheckedAt,c.compatibilityExpiresAt,c.schemaHash
    FROM catalog_agents a JOIN catalog_agent_endpoints ae ON ae.agentKey=a.agentKey
    JOIN catalog_endpoints e ON e.endpointKey=ae.endpointKey
    LEFT JOIN catalog_seller_capabilities c ON c.agentKey=a.agentKey AND c.endpointKey=e.endpointKey
    WHERE a.agentKey=? AND ae.endpointKey=? AND a.indexState='current' AND ae.declarationState='current'
    AND e.role='operational' AND e.eligibility='eligible' AND e.safety='safe' AND e.endpoint IS NOT NULL
    AND e.validationProtocol IN ('a2a','mcp','erc8183_http') LIMIT 1`,[agentKey,endpointKey]).first<Target>();
}
export function discoveryContextVersion(row:{metadataVersion:string|null;transport:string;endpoint:string}):string{
  return JSON.stringify([row.metadataVersion,row.transport,row.endpoint]);
}
function skipped(agentKey:string,endpointKey:string,errorCode:string|null=null):CatalogCapabilityProbeSummary{
  return{status:'skipped',agentKey,endpointKey,requestId:null,attemptId:null,errorCode,durationMs:0};
}
export interface DiscoveryDependencies {now?:()=>number;fetchImpl?:typeof fetch;
  probe?:typeof probeCatalogEndpoint;discover?:typeof discoverNegotiationInput}

export async function runCatalogDiscovery(work:DiscoveryMessage,env:Env,config:WorkerConfig,dependencies:DiscoveryDependencies={}):Promise<CatalogCapabilityProbeSummary & {compatibilitySucceeded?:boolean}>{
  const now=dependencies.now??Date.now,started=now(),db=env.DB as unknown as D1DatabaseLike;
  const claim=await claimDiscoveryExecution(db,work,started,Number(env.CATALOG_QUOTE_ORIGIN_PER_MINUTE??'1'));
  if(!claim)return skipped(work.workKey.split('|')[0]??'',work.workKey.split('|')[1]??'');
  const found=await target(db,claim.agentKey,claim.endpointKey);
  if(!found||found.state==='suspended'||found.transport!==claim.transport
    ||found.originKey!==claim.originKey||discoveryContextVersion(found)!==claim.contextVersion){
    await completeDiscoveryExecution(db,claim,{success:false,errorCode:'DISCOVERY_CONTEXT_CHANGED',backoffMinutes:config.catalogFailureBackoffMinutes},now());
    return skipped(claim.agentKey,claim.endpointKey,'DISCOVERY_CONTEXT_CHANGED');
  }
  const timeoutMs=found.transport==='a2a'?config.catalogA2aTimeoutMs:found.transport==='mcp'?config.catalogMcpTimeoutMs:config.catalogErc8183TimeoutMs;
  if ((found.nextProbeAt??0)>started) {
    await completeDiscoveryExecution(db,claim,{success:false,deferUntil:found.nextProbeAt!},now());
    return skipped(claim.agentKey,claim.endpointKey,'DISCOVERY_BACKOFF');
  }
  if (found.compatibilityState==='compatible' && (found.compatibilityCheckedAt??0)>work.enqueuedAt && (found.compatibilityExpiresAt??0)>started) {
    await completeDiscoveryExecution(db,claim,{success:true,deferUntil:Math.max(started+60_000,found.compatibilityCheckedAt!+pilotRenewalDelay(claim.agentKey))},now());
    return skipped(claim.agentKey,claim.endpointKey,'DISCOVERY_RENEWED');
  }
  // Share only successful GET responses within this one context execution;
  // never cache across agents, chains, credentials or separate validations.
  const cache=new Map<string,Response>();
  const fetchImpl:typeof fetch=async(input,init)=>{
    const key=String(input),get=(init?.method??'GET')==='GET';
    const cached=get?cache.get(key):undefined;if(cached)return cached.clone();
    const response=await(dependencies.fetchImpl??fetch)(input,init);
    if(get&&response.ok)cache.set(key,response.clone());return response;
  };
  const probe=await(dependencies.probe??probeCatalogEndpoint)({agentKey:claim.agentKey,endpointKey:claim.endpointKey,endpoint:found.endpoint,
    protocol:found.transport,priority:0,consecutiveFailures:claim.failures},{fetchImpl,timeoutMs,
    maxResponseBytes:config.maxSellerResponseBytes,freshnessMs:DISCOVERY_REFRESH_MS,now});
  let contract:NegotiationContract|undefined,errorCode=probe.errorCode??undefined;
  if(probe.outcome==='protocol_valid')try{
    contract=await(dependencies.discover??discoverNegotiationInput)({endpoint:found.endpoint,transport:found.transport,request:{},
      fetch:fetchImpl,timeoutMs,maxResponseBytes:config.maxSellerResponseBytes});
  }catch(error){errorCode=error instanceof SellerProbeError?error.code:'SELLER_UNREACHABLE';}
  const schemaHash=contract?await sha256(contract):null;
  const finished=now(),sourceGuard=discoverySourceGuard(claim,found);
  const evidence=discoveryEvidence(db,claim,probe,contract,schemaHash,errorCode,finished,sourceGuard);
  // Evidence and completion share one transaction. Test our inserted event,
  // not the old capability snapshot which our own preceding write replaces.
  const completionGuard:DiscoveryCommitGuard={sql:'EXISTS(SELECT 1 FROM catalog_observations WHERE attemptId=? AND agentKey=? AND endpointKey=?)',
    values:[`${claim.runId}:discovery`,claim.agentKey,claim.endpointKey]};
  const committed=await completeDiscoveryExecution(db,claim,{success:!!contract,protocolValid:probe.outcome==='protocol_valid',...(errorCode?{errorCode}:{}),backoffMinutes:config.catalogFailureBackoffMinutes},finished,evidence,completionGuard);
  return{status:'skipped',agentKey:claim.agentKey,endpointKey:claim.endpointKey,requestId:null,attemptId:null,
    errorCode:committed?(errorCode??null):'DISCOVERY_STALE_COMPLETION',durationMs:Math.max(0,finished-started),
    compatibilitySucceeded:committed&&!!contract};
}

function discoverySourceGuard(claim:DiscoveryClaim,found:Target):DiscoveryCommitGuard{
  return{sql:`EXISTS(SELECT 1 FROM catalog_agents a JOIN catalog_agent_endpoints ae ON ae.agentKey=a.agentKey
    JOIN catalog_endpoints e ON e.endpointKey=ae.endpointKey
    WHERE a.agentKey=? AND ae.endpointKey=? AND a.indexState='current' AND ae.declarationState='current'
    AND e.role='operational' AND e.eligibility='eligible' AND e.safety='safe' AND e.endpoint IS NOT NULL
    AND e.validationProtocol=? AND COALESCE(e.originKey,e.endpointKey)=?
    AND json_array(ae.metadataVersion,e.validationProtocol,e.endpoint)=?
    AND NOT EXISTS(SELECT 1 FROM catalog_seller_capabilities c WHERE c.agentKey=a.agentKey AND c.endpointKey=e.endpointKey
      AND (c.state='suspended' OR NOT(c.compatibilityCheckedAt IS ? AND c.schemaHash IS ?))))`,
    values:[claim.agentKey,claim.endpointKey,claim.transport,claim.originKey,claim.contextVersion,found.compatibilityCheckedAt,found.schemaHash]};
}
function discoveryEvidence(db:D1DatabaseLike,claim:DiscoveryClaim,probe:CatalogProbeObservation,contract:NegotiationContract|undefined,schemaHash:string|null,errorCode:string|undefined,now:number,sourceGuard:DiscoveryCommitGuard):DiscoveryStatement[]{
  const fence=discoveryFencePredicate(claim,now),condition=`EXISTS(SELECT 1 FROM catalog_pilot_discovery_work WHERE ${fence.sql}) AND (${sourceGuard.sql})`;
  const guardValues=[...fence.values,...sourceGuard.values];
  const compatible=!!contract;
  const state=compatible?'compatible':/PARAMETERS|SCHEMA|REQUIRED_SKILLS|TOOL_REQUIRED|UNSUPPORTED/.test(errorCode??'')?'unsupported':'unavailable';
  return[
    // The observation is attached to this agent/context only. No sibling
    // capability or other chain receives success from this execution.
    statement(db,`INSERT INTO catalog_observations(agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,httpStatus,errorCode,durationMs,detailsJson,attemptId,validationKind,verificationLevel)
      SELECT ?,?,?,'worker_probe',?,?,?,?,?,?,?,?,'protocol','platform_observed' WHERE ${condition} ON CONFLICT DO NOTHING`,
      [claim.agentKey,claim.endpointKey,claim.transport,probe.outcome,probe.observedAt,probe.expiresAt,probe.httpStatus,probe.errorCode,probe.durationMs,
        JSON.stringify({capabilityCount:probe.capabilityCount,method:probe.method,contextVersion:claim.contextVersion}),`${claim.runId}:discovery`,...guardValues]),
    statement(db,`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,createdAt,updatedAt,compatibilityState,schemaHash,detectorVersion,negotiationProfile,schemaSource,compatibilityCheckedAt,compatibilityExpiresAt,compatibilityErrorCode)
      SELECT ?,?,?,'discovered',?,?,?,?,?,?,?,?,?,? WHERE ${condition}
      ON CONFLICT(agentKey,endpointKey) DO UPDATE SET compatibilityState=excluded.compatibilityState,schemaHash=excluded.schemaHash,
      detectorVersion=excluded.detectorVersion,negotiationProfile=excluded.negotiationProfile,schemaSource=excluded.schemaSource,
      compatibilityCheckedAt=excluded.compatibilityCheckedAt,compatibilityExpiresAt=excluded.compatibilityExpiresAt,
      compatibilityErrorCode=excluded.compatibilityErrorCode,updatedAt=excluded.updatedAt`,
      [claim.agentKey,claim.endpointKey,claim.transport,now,now,state,schemaHash,NEGOTIATION_DETECTOR_VERSION,
        contract?.provenance?.profile??null,contract?.provenance?.source??null,now,compatible?now+DISCOVERY_REFRESH_MS:null,errorCode??null,...guardValues]),
  ];
}
