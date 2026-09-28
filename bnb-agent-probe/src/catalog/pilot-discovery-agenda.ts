import type { D1DatabaseLike } from '../db/client';
import { discoveryStatement as statement, discoveryBatch, type DiscoveryStatement } from '../db/pilot-discovery-store';
import {BackgroundBudgetError} from '../db/background-budget';
import { isPilotAgentKey, pilotRenewalDelay } from './pilot-policy';

export const DISCOVERY_INITIAL_DELAY_MS=60_000;
export const DISCOVERY_REFRESH_MS=86_400_000;
export const DISCOVERY_LEASE_MS=60_000;
const DELIVERY_RETRY_MS=5*60_000;
const NEVER=8_640_000_000_000_000;
export const DISCOVERY_WORK_KIND='catalog_pilot_discovery' as const;
type Cohort='initial'|'refresh';
export interface DiscoveryContext {
  agentKey:string; endpointKey:string; originKey:string; chainId:56|97;
  transport:string; contextVersion:string; priorityClass?:number;
  /** Bootstrap migration may retain a later backoff; never accelerate it. */
  notBeforeMs?:number;
  /** Existing queue deliveries were already admitted; only the adapter uses 0. */
  initialDelayMs?:number;
  /** Backfill-only initial values; never overwrite an existing work item. */
  initialCohort?:Cohort;previousFailures?:number;
}
export interface DiscoveryMessage {schemaVersion:3;kind:typeof DISCOVERY_WORK_KIND;workKey:string;generation:number;runId:string;enqueuedAt:number}
export interface DiscoveryRow extends DiscoveryContext {
  workKey:string;generation:number;cohort:Cohort;priorityClass:number;state:string;
  nextAttemptAt:number;runId:string|null;executionFence:number;deliveryAt:number;failures:number;lastErrorCode:string|null;
}
export interface DiscoveryClaim extends DiscoveryRow {runId:string;executionFence:number;executionToken:string}
export interface DiscoveryCommitGuard {sql:string;values:unknown[]}
interface Origin {originKey:string;wakeAt:number;turn:number;revision:number;minute:number;used:number;nextCohort:Cohort;nextChain:56|97}
async function rows<T>(query:DiscoveryStatement):Promise<readonly T[]>{
  const result=await query.all<T>();if(!result.success)throw new Error('DISCOVERY_DATABASE_FAILED');return result.results??[];
}
async function batch(db:D1DatabaseLike,statements:DiscoveryStatement[]):Promise<void>{
  const results=await discoveryBatch(db,statements);if(results.length!==statements.length||results.some(r=>!r.success))throw new Error('DISCOVERY_DATABASE_FAILED');
}
const workKey=(context:Pick<DiscoveryContext,'agentKey'|'endpointKey'>)=>`${context.agentKey}|${context.endpointKey}`;

/** Call in the ingester's admitted unit. Same-context rediscovery is a no-op:
 * it cannot reset a backoff, lease, generation or already-current evidence. */
export async function upsertDiscoveryWork(db:D1DatabaseLike,context:DiscoveryContext,now:number):Promise<void>{
  await batch(db,upsertDiscoveryStatements(db,context,now));
}

/** The ingester must include these statements in its source/cursor batch. */
export function upsertDiscoveryStatements(db:D1DatabaseLike,context:DiscoveryContext,now:number):DiscoveryStatement[]{
  return upsertDiscoveryBatchStatements(db,[context],now);
}

/** At most 96 bound values per work statement and 83 per origin statement.
 * Twelve declarations need three queries, not thirty-six. Include every
 * returned statement in the SAME source/cursor transaction. */
export function upsertDiscoveryBatchStatements(db:D1DatabaseLike,contexts:readonly DiscoveryContext[],now:number,options:{scheduleOrigins?:boolean;requireAdmission?:boolean}={}):DiscoveryStatement[]{
  const changed='contextVersion<>excluded.contextVersion OR transport<>excluded.transport OR originKey<>excluded.originKey';
  const writes:DiscoveryStatement[]=[];
  for(const context of contexts)if(!isPilotAgentKey(context.agentKey)||!context.endpointKey||!context.originKey||!context.contextVersion
    ||context.agentKey.split(':')[1]!==String(context.chainId)||!['a2a','mcp','erc8183_http'].includes(context.transport))throw new Error('DISCOVERY_CONTEXT_INVALID');
  const workPageSize=options.requireAdmission?7:8;
  for(let offset=0;offset<contexts.length;offset+=workPageSize){
    const page=contexts.slice(offset,offset+workPageSize),values=page.flatMap(context=>[
      workKey(context),context.agentKey,context.endpointKey,context.originKey,context.chainId,context.transport,context.contextVersion,context.priorityClass??0,
      Math.max(now+(context.initialDelayMs??DISCOVERY_INITIAL_DELAY_MS),context.notBeforeMs??0),now,context.initialCohort??'initial',context.previousFailures??0,
      ...(options.requireAdmission?[context.agentKey]:[])]);
    writes.push(statement(db,`INSERT INTO catalog_pilot_discovery_work(workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,priorityClass,nextAttemptAt,updatedAt,cohort,failures)
      ${options.requireAdmission?page.map(()=>`SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM catalog_pilot_admissions WHERE agentKey=?)`).join(' UNION ALL '):`VALUES ${page.map(()=>'(?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`}
      ON CONFLICT(workKey) DO UPDATE SET
      generation=generation+CASE WHEN ${changed} THEN 1 ELSE 0 END,
      state=CASE WHEN ${changed} THEN 'scheduled' ELSE state END,
      cohort=CASE WHEN ${changed} THEN 'initial' ELSE cohort END,
      runId=CASE WHEN ${changed} THEN NULL ELSE runId END,
      nextAttemptAt=CASE WHEN ${changed} THEN MAX(excluded.nextAttemptAt,CASE WHEN failures>0 THEN nextAttemptAt ELSE 0 END) ELSE nextAttemptAt END,
      originKey=excluded.originKey,transport=excluded.transport,contextVersion=excluded.contextVersion,
      priorityClass=excluded.priorityClass,updatedAt=excluded.updatedAt
      WHERE ${changed} OR priorityClass<>excluded.priorityClass`,values));
  }
  for(let offset=0;options.scheduleOrigins!==false&&offset<contexts.length;offset+=80){
    const keys=contexts.slice(offset,offset+80).map(workKey);
    writes.push(statement(db,`WITH input(workKey) AS(VALUES ${keys.map(()=>'(?)').join(',')})
      INSERT INTO catalog_pilot_origin_schedule(originKey,wakeAt,turn)
      SELECT w.originKey,MIN(w.nextAttemptAt),? FROM input CROSS JOIN catalog_pilot_discovery_work w ON w.workKey=input.workKey
      WHERE w.state='scheduled' AND w.updatedAt=? GROUP BY w.originKey
      ON CONFLICT(originKey) DO UPDATE SET wakeAt=MIN(wakeAt,excluded.wakeAt),revision=revision+1
      WHERE wakeAt>excluded.wakeAt OR leaseUntil>?`,[...keys,now,now,now]));
  }
  return writes;
}

export async function suspendDiscoveryWork(db:D1DatabaseLike,key:string,now:number):Promise<void>{
  await statement(db,`UPDATE catalog_pilot_discovery_work SET state='suspended',generation=generation+1,runId=NULL,updatedAt=?
    WHERE workKey=? AND state<>'suspended'`,[now,key]).run();
}

/** One durable deferral for an initial task; stale messages cannot move it. */
export async function deferInitialDiscovery(db:D1DatabaseLike,work:DiscoveryMessage,until:number,now:number):Promise<void>{
  await batch(db,[statement(db,`UPDATE catalog_pilot_discovery_work SET state='scheduled',runId=NULL,
    nextAttemptAt=MAX(nextAttemptAt,?),deliveryAt=0,updatedAt=?
    WHERE workKey=? AND generation=? AND runId=? AND state='dispatch' AND cohort='initial'`,
    [until,now,work.workKey,work.generation,work.runId]),
    statement(db,`UPDATE catalog_pilot_origin_schedule SET wakeAt=MIN(wakeAt,?),revision=revision+1
      WHERE originKey=(SELECT originKey FROM catalog_pilot_discovery_work WHERE workKey=? AND generation=?
        AND state='scheduled' AND runId IS NULL AND updatedAt=?)`,[until,work.workKey,work.generation,now])]);
}

/** Fixed set of index seeks, not a ranking over a provider's backlog. */
async function heads(db:D1DatabaseLike,origin:string):Promise<readonly DiscoveryRow[]>{
  const classes:string[]=[],values:unknown[]=[];
  for(const cohort of ['initial','refresh'])for(const chain of [56,97])for(let priority=0;priority<4;priority++){
    classes.push('(?,?,?)');values.push(cohort,chain,priority);
  }
  return rows<DiscoveryRow>(statement(db,`WITH classes(cohort,chainId,priorityClass) AS (VALUES ${classes.join(',')})
    SELECT w.* FROM classes CROSS JOIN catalog_pilot_discovery_work w ON w.workKey=(
      SELECT workKey FROM catalog_pilot_discovery_work INDEXED BY idx_pilot_discovery_origin_head
      WHERE originKey=? AND state='scheduled' AND cohort=classes.cohort AND chainId=classes.chainId
      AND priorityClass=classes.priorityClass ORDER BY nextAttemptAt,workKey LIMIT 1)`,[...values,origin]));
}

async function refreshOrigin(db:D1DatabaseLike,originKey:string,now:number,token:string,turn:number,originPerMinute:number,revision:number):Promise<void>{
  const candidates=await heads(db,originKey);
  const earliest=candidates.reduce((n,row)=>Math.min(n,row.nextAttemptAt),NEVER);
  await statement(db,`UPDATE catalog_pilot_origin_schedule SET
    wakeAt=CASE WHEN minute=? AND used>=? THEN MAX(?,?) WHEN ?<=? THEN 0 ELSE ? END,
    turn=COALESCE(?,turn),leaseToken=NULL,leaseUntil=0
    WHERE originKey=? AND leaseToken=? AND revision=?`,
    [Math.floor(now/60_000),originPerMinute,earliest,(Math.floor(now/60_000)+1)*60_000,earliest,now,earliest,turn,originKey,token,revision]).run();
}

async function controlFirst<Row>(query:DiscoveryStatement):Promise<Row|null>{
  const result=await query.run(),meta=result.meta as {rows_read?:unknown;rows_written?:unknown}|undefined;
  if(!result.success||!meta||!Number.isSafeInteger(meta.rows_read)||Number(meta.rows_read)<0||meta.rows_written!==0
    ||!Array.isArray(result.results)||result.results.length>1)throw new BackgroundBudgetError('metadata');
  return(result.results[0] as Row|undefined)??null;
}
export async function discoveryAgendaHasDue(db:D1DatabaseLike,now:number):Promise<boolean>{
  const origin=await controlFirst<{originKey:string}>(statement(db,'SELECT originKey FROM catalog_pilot_origin_schedule WHERE wakeAt<=? ORDER BY wakeAt,turn LIMIT 1',[now]));
  if(origin&&typeof origin.originKey!=='string')throw new BackgroundBudgetError('metadata');
  if(origin)return true;
  for(const state of ['dispatch','running']){
    const row=await controlFirst<{workKey:string}>(statement(db,'SELECT workKey FROM catalog_pilot_discovery_work WHERE state=? AND deliveryAt<=? ORDER BY deliveryAt LIMIT 1',[state,now]));
    if(row&&typeof row.workKey!=='string')throw new BackgroundBudgetError('metadata');
    if(row)return true;
  }
  return false;
}

export interface AgendaOptions {nowMs:number;maxOrigins?:number;originPerMinute?:number;
  limits?:Record<56|97,{initial:number;refresh:number}>;
  /** Legacy bootstrap=0 shares the normal quota, not zero initial service. */
  combinedLimits?:Partial<Record<56|97,number>>}
/** The supplied binding must be admitted/metered by the caller. A read-only
 * preflight permits idle invocations to avoid all accounting writes. Outbox
 * intents precede send and remain durable after successful or ambiguous send. */
export async function produceDiscoveryAgenda(db:D1DatabaseLike,queue:{send(body:unknown):Promise<unknown>},options:AgendaOptions){
  const now=options.nowMs,max=Math.min(44,options.maxOrigins??44),originLimit=options.originPerMinute??1;
  if(!Number.isSafeInteger(max)||max<1||!Number.isSafeInteger(originLimit)||originLimit<1||originLimit>4)throw new Error('DISCOVERY_LIMIT_INVALID');
  const limits=options.limits??{56:{initial:40,refresh:2},97:{initial:1,refresh:1}};
  const summary={selected:0,enqueued:0,sendFailed:0,replayed:0};
  if(!await discoveryAgendaHasDue(db,now))return summary;
  const sleepers=await rows<Origin>(statement(db,'SELECT * FROM catalog_pilot_origin_schedule WHERE wakeAt>0 AND wakeAt<=? ORDER BY wakeAt,turn LIMIT ?',[now,max]));
  const ready=await rows<Origin>(statement(db,'SELECT * FROM catalog_pilot_origin_schedule WHERE wakeAt=0 ORDER BY turn,originKey LIMIT ?',[max]));
  const fresh=[...sleepers,...ready].sort((a,b)=>a.turn-b.turn||a.originKey.localeCompare(b.originKey)).slice(0,max);
  // Recovery uses deadline-leading indexes and a fixed window. A running
  // invocation cannot commit after recovery clears its execution lease.
  // Recovery and fresh dispatch SHARE the window, not one window per state.
  // With both classes waiting, reserve half for fresh origins. The one-slot
  // free-plan window alternates by minute instead of starving either class.
  const recoveryLimit=!fresh.length?max:max===1?Math.floor(now/60_000)%2:Math.floor(max/2);
  const expired:DiscoveryRow[]=[];
  if(recoveryLimit)for(const state of ['dispatch','running'])
    expired.push(...await rows<DiscoveryRow>(statement(db,'SELECT * FROM catalog_pilot_discovery_work WHERE state=? AND deliveryAt<=? ORDER BY deliveryAt,workKey LIMIT ?',[state,now,recoveryLimit])));
  let recoveryAttempts=0;
  for(const row of expired.sort((a,b)=>a.deliveryAt-b.deliveryAt||a.workKey.localeCompare(b.workKey)).slice(0,recoveryLimit)){
      recoveryAttempts++;
      const recovered=await rows<DiscoveryRow>(statement(db,`UPDATE catalog_pilot_discovery_work SET state='dispatch',deliveryAt=?,executionFence=executionFence+1
        WHERE workKey=? AND generation=? AND runId=? AND state=? AND deliveryAt<=? RETURNING *`,[now+DELIVERY_RETRY_MS,row.workKey,row.generation,row.runId,row.state,now]));
      if(!recovered[0])continue;
      try{await queue.send(message(recovered[0],now));summary.replayed++;}catch{summary.sendFailed++;}
  }
  // Merge only two bounded index windows. Promoting wakeAt and acquiring its
  // lease in one CAS avoids a standalone write for each cold provider.
  const origins=fresh.slice(0,max-recoveryAttempts);
  if(!origins.length)return summary;
  const [sequence]=await rows<{integerValue:number}>(statement(db,`INSERT INTO runtime_state(key,integerValue,updatedAt) VALUES('catalog_pilot_agenda_turn_v1',?,?)
    ON CONFLICT(key) DO UPDATE SET integerValue=MAX(integerValue,?)+?,updatedAt=excluded.updatedAt RETURNING integerValue`,[now+origins.length,now,now,origins.length]));
  if(!sequence)throw new Error('DISCOVERY_SEQUENCE_FAILED');
  const used={56:{initial:0,refresh:0},97:{initial:0,refresh:0}};
  for(const [index,origin]of origins.entries()){
    const token=crypto.randomUUID();
    const [owned]=await rows<Origin>(statement(db,`UPDATE catalog_pilot_origin_schedule SET ${origin.wakeAt===0?'':'wakeAt=0,'}leaseToken=?,leaseUntil=?
      WHERE originKey=? AND wakeAt=? AND wakeAt<=? AND leaseUntil<=? RETURNING *`,[token,now+DISCOVERY_LEASE_MS,origin.originKey,origin.wakeAt,now,now]));
    if(!owned)continue;
    const candidates=(await heads(db,origin.originKey)).filter(row=>row.nextAttemptAt<=now&&used[row.chainId][row.cohort]<limits[row.chainId][row.cohort]
      &&used[row.chainId].initial+used[row.chainId].refresh<(options.combinedLimits?.[row.chainId]??Infinity));
    candidates.sort((a,b)=>Number(a.cohort!==owned.nextCohort)-Number(b.cohort!==owned.nextCohort)
      ||Number(a.chainId!==owned.nextChain)-Number(b.chainId!==owned.nextChain)||a.priorityClass-b.priorityClass||a.nextAttemptAt-b.nextAttemptAt||a.workKey.localeCompare(b.workKey));
    const candidate=candidates[0],minute=Math.floor(now/60_000);
    if(candidate&&(owned.minute!==minute||owned.used<originLimit)){
      const runId=crypto.randomUUID();
      await batch(db,[statement(db,`UPDATE catalog_pilot_discovery_work SET state='dispatch',runId=?,deliveryAt=?,updatedAt=?
        WHERE workKey=? AND generation=? AND state='scheduled' AND nextAttemptAt<=?
        AND EXISTS(SELECT 1 FROM catalog_pilot_origin_schedule WHERE originKey=? AND leaseToken=? AND leaseUntil>?)`,
        [runId,now+DELIVERY_RETRY_MS,now,candidate.workKey,candidate.generation,now,origin.originKey,token,now]),
        statement(db,`UPDATE catalog_pilot_origin_schedule SET minute=?,used=CASE WHEN minute=? THEN used+1 ELSE 1 END,
          nextCohort=?,nextChain=? WHERE originKey=? AND leaseToken=?
          AND EXISTS(SELECT 1 FROM catalog_pilot_discovery_work WHERE workKey=? AND runId=?)`,
          [minute,minute,candidate.cohort==='initial'?'refresh':'initial',candidate.chainId===56?97:56,origin.originKey,token,candidate.workKey,runId])]);
      const committed=await statement(db,'SELECT * FROM catalog_pilot_discovery_work WHERE workKey=? AND runId=?',[candidate.workKey,runId]).first<DiscoveryRow>();
      if(committed){
        summary.selected++;used[candidate.chainId][candidate.cohort]++;
        try{await queue.send(message(committed,now));summary.enqueued++;}catch{summary.sendFailed++;}
      }
    }
    await refreshOrigin(db,origin.originKey,now,token,sequence.integerValue-origins.length+index+1,originLimit,owned.revision);
  }
  return summary;
}
function message(row:DiscoveryRow,now:number):DiscoveryMessage{return{schemaVersion:3,kind:DISCOVERY_WORK_KIND,workKey:row.workKey,generation:row.generation,runId:row.runId!,enqueuedAt:now};}

export function parseDiscoveryMessage(value:unknown,now:number):DiscoveryMessage{
  if(!value||typeof value!=='object')throw new Error('DISCOVERY_MESSAGE_INVALID');const row=value as DiscoveryMessage;
  if(row.schemaVersion!==3||row.kind!==DISCOVERY_WORK_KIND||typeof row.workKey!=='string'||row.workKey.length>256||!isPilotAgentKey(row.workKey.split('|')[0]??'')
    ||typeof row.runId!=='string'||!/^[\da-f-]{36}$/.test(row.runId)||!Number.isSafeInteger(row.generation)||row.generation<1
    ||!Number.isSafeInteger(row.enqueuedAt)||row.enqueuedAt<0||row.enqueuedAt>now+300_000)throw new Error('DISCOVERY_MESSAGE_INVALID');
  return{schemaVersion:3,kind:DISCOVERY_WORK_KIND,workKey:row.workKey,generation:row.generation,runId:row.runId,enqueuedAt:row.enqueuedAt};
}
export async function claimDiscoveryExecution(db:D1DatabaseLike,input:DiscoveryMessage,now:number,originPerMinute=1):Promise<DiscoveryClaim|null>{
  if(!Number.isInteger(originPerMinute)||originPerMinute<1||originPerMinute>4)throw new Error('DISCOVERY_LIMIT_INVALID');
  const work=parseDiscoveryMessage(input,now);
  const token=crypto.randomUUID(),minute=Math.floor(now/60_000);
  // The endpoint execution mutex and physical-request quota are global to an
  // origin, even when two independently queued contexts belong to two chains.
  const result=await discoveryBatch(db,[statement(db,`UPDATE catalog_pilot_origin_schedule SET executionToken=?,executionLeaseUntil=?,
    executionUsed=CASE WHEN executionMinute=? THEN executionUsed+1 ELSE 1 END,executionMinute=?
    WHERE executionLeaseUntil<=? AND (executionMinute<>? OR executionUsed<?)
    AND originKey=(SELECT originKey FROM catalog_pilot_discovery_work WHERE workKey=? AND generation=? AND runId=? AND state='dispatch')`,
    [token,now+DISCOVERY_LEASE_MS,minute,minute,now,minute,originPerMinute,work.workKey,work.generation,work.runId]),
    statement(db,`UPDATE catalog_pilot_discovery_work SET state='running',executionFence=executionFence+1,executionToken=?,deliveryAt=?,updatedAt=?
      WHERE workKey=? AND generation=? AND runId=? AND state='dispatch'
      AND EXISTS(SELECT 1 FROM catalog_pilot_origin_schedule o WHERE o.originKey=catalog_pilot_discovery_work.originKey AND o.executionToken=?) RETURNING *`,
      [token,now+DISCOVERY_LEASE_MS,now,work.workKey,work.generation,work.runId,token])]);
  if(result.some(row=>!row.success))throw new Error('DISCOVERY_DATABASE_FAILED');
  return (result[1]?.results?.[0] as DiscoveryClaim|undefined)??null;
}

/** Additional evidence statements must include discoveryFencePredicate(claim).
 * They execute before the transition in this same atomic batch. */
export async function completeDiscoveryExecution(db:D1DatabaseLike,claim:DiscoveryClaim,result:{success:boolean;deferUntil?:number;protocolValid?:boolean;errorCode?:string;backoffMinutes?:readonly number[]},now:number,evidence:DiscoveryStatement[]=[],sourceGuard?:DiscoveryCommitGuard):Promise<boolean>{
  if (result.deferUntil!==undefined && (!Number.isSafeInteger(result.deferUntil)||result.deferUntil<=now)) throw new Error('PILOT_DEFERRAL_INVALID');
  const failures=result.deferUntil!==undefined?claim.failures:result.success?0:claim.failures+1,backoff=result.backoffMinutes??[60,360,1440,10080];
  const providerBlocked=/PARAMETERS|SCHEMA|REQUIRED_SKILLS|TOOL_REQUIRED|UNSUPPORTED/.test(result.errorCode??'')||result.errorCode==='SELLER_ACCESS_DENIED';
  const delay=result.success?pilotRenewalDelay(claim.agentKey):(providerBlocked?10080:backoff[Math.min(failures-1,backoff.length-1)]??60)*60_000;
  const fence=discoveryFencePredicate(claim,now),due=result.deferUntil??now+delay;
  const priority=result.protocolValid===undefined?claim.priorityClass:(result.protocolValid?0:2)+(claim.transport==='erc8183_http'?0:1);
  // Completion and the conservative wake are one transaction. A process may
  // stop immediately after this batch without hiding scheduled work forever.
  // Do not clear a concurrent producer's lease or overwrite its earlier wake.
  const completed=await discoveryBatch(db,[...evidence,statement(db,`UPDATE catalog_pilot_discovery_work SET state='scheduled',cohort=CASE WHEN cohort='initial' AND ${result.success?1:0}=0 THEN 'initial' ELSE 'refresh' END,nextAttemptAt=?,runId=NULL,failures=?,lastErrorCode=?,priorityClass=?,updatedAt=?
    WHERE ${fence.sql} ${sourceGuard?`AND (${sourceGuard.sql})`:''}`,[due,failures,result.deferUntil!==undefined?claim.lastErrorCode:result.errorCode??null,priority,now,...fence.values,...sourceGuard?.values??[]]),
    statement(db,`UPDATE catalog_pilot_origin_schedule SET wakeAt=MIN(wakeAt,?),revision=revision+1,executionToken=NULL,executionLeaseUntil=0
      WHERE originKey=? AND executionToken=? AND EXISTS(SELECT 1 FROM catalog_pilot_discovery_work
      WHERE workKey=? AND generation=? AND executionFence=? AND executionToken=? AND state='scheduled' AND runId IS NULL AND updatedAt=?)`,
      [due,claim.originKey,claim.executionToken,claim.workKey,claim.generation,claim.executionFence,claim.executionToken,now])]);
  if(completed.some(r=>!r.success))throw new Error('DISCOVERY_DATABASE_FAILED');
  const meta=completed[evidence.length]!.meta as {changes?:number};
  // D1 changes is the directly changed table row, not index-maintenance writes.
  return meta.changes===1;
}
export function discoveryFencePredicate(claim:DiscoveryClaim,now:number):DiscoveryCommitGuard{return{
  sql:`workKey=? AND generation=? AND runId=? AND executionFence=? AND executionToken=? AND state='running' AND deliveryAt>?
    AND EXISTS(SELECT 1 FROM catalog_pilot_origin_schedule o WHERE o.originKey=catalog_pilot_discovery_work.originKey AND o.executionToken=? AND o.executionLeaseUntil>?)`,
  values:[claim.workKey,claim.generation,claim.runId,claim.executionFence,claim.executionToken,now,claim.executionToken,now]};}
