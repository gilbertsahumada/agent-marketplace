/** Local experiment. No production route, migration or spending authorization. */
import type {D1Database} from '../../src/types';
import {ENDPOINT_ONLY_TABLE,endpointOnlyColumns,endpointOnlySourceSql} from './endpoint-only-public-prototype';

export const ENDPOINT_BACKFILL_KEY='prototype_endpoint_backfill_v1';
export const ENDPOINT_PAGE_RESERVATION=80_000;
export const ENDPOINT_VERIFY_RESERVATION=2_000_000;
type State={version:1;phase:'building'|'verify'|'complete'|'mismatch';agentKey:string;endpointKey:string;revision:number;lastToken?:string};
export async function endpointBackfillStatus(db:D1Database):Promise<{state:State;reserved:number}|null>{
 const row=await db.prepare('SELECT textValue,integerValue FROM runtime_state WHERE key=?').bind(ENDPOINT_BACKFILL_KEY).first<{textValue:string;integerValue:number}>();
 if(!row)return null;
 try{const state=JSON.parse(row.textValue) as State;
  if(state.version!==1||!['building','verify','complete','mismatch'].includes(state.phase)||typeof state.agentKey!=='string'||typeof state.endpointKey!=='string'||!Number.isSafeInteger(state.revision)||state.revision<0||!Number.isSafeInteger(row.integerValue)||row.integerValue<0)return null;
  return{state,reserved:row.integerValue};
 }catch{return null;}
}

/** Begin a NEW build, never a resume. Call BEFORE replacing the table or
 * triggers so a failed rebuild cannot retain a previous coverage approval.
 * Existing reservations stay charged; revision invalidates old page claims.
 * Resume an existing build by calling stepEndpointBackfill directly. */
export async function initializeEndpointCheckpoint(db:D1Database):Promise<void>{
 const initial:State={version:1,phase:'building',agentKey:'',endpointKey:'',revision:0};
 await db.prepare(`INSERT INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES(?,?,0,0)
  ON CONFLICT(key) DO UPDATE SET textValue=json_set(excluded.textValue,'$.revision',json_extract(runtime_state.textValue,'$.revision')+1)`)
  .bind(ENDPOINT_BACKFILL_KEY,JSON.stringify(initial)).run();
}

export async function stepEndpointBackfill(db:D1Database,cap:number,token:string=crypto.randomUUID()):Promise<'progress'|'complete'|'mismatch'|'denied'|'unavailable'|'raced'>{
 if(!Number.isSafeInteger(cap)||cap<0||!db.batch)throw new Error('INVALID_ENDPOINT_BACKFILL_OPTIONS');
 const current=await endpointBackfillStatus(db);if(!current)return'unavailable';
 const {state}=current;if(state.phase==='complete'||state.phase==='mismatch')return state.phase;
 const estimate=state.phase==='verify'?ENDPOINT_VERIFY_RESERVATION:ENDPOINT_PAGE_RESERVATION;
 if(current.reserved+estimate>cap)return'denied';
 const serialized=JSON.stringify(state);
 // Abandoned attempts stay charged even if the following batch rolls back.
 const admission=await db.prepare('UPDATE runtime_state SET integerValue=integerValue+? WHERE key=? AND textValue=? AND integerValue+?<=? RETURNING key')
  .bind(estimate,ENDPOINT_BACKFILL_KEY,serialized,estimate,cap).all();
 if(admission.success!==true)throw new Error('ENDPOINT_ADMISSION_UNCONFIRMED');
 if(admission.results?.length!==1)return'raced';
 const page=`SELECT json_group_array(json_array(agentKey,endpointKey)) FROM (
  SELECT d.agentKey,d.endpointKey FROM catalog_agent_endpoints d
  WHERE (d.agentKey,d.endpointKey)>(json_extract(runtime_state.textValue,'$.agentKey'),json_extract(runtime_state.textValue,'$.endpointKey'))
   AND d.declarationState='current' AND EXISTS(SELECT 1 FROM catalog_agents a WHERE a.agentKey=d.agentKey)
  ORDER BY d.agentKey,d.endpointKey LIMIT 40)`;
 const claim=db.prepare(`UPDATE runtime_state SET textValue=json_set(textValue,'$.token',?${state.phase==='building'?`, '$.page',json((${page}))`:''}) WHERE key=? AND textValue=? RETURNING key`).bind(token,ENDPOINT_BACKFILL_KEY,serialized);
 const statements=[claim];
 if(state.phase==='building'){
  const keys="SELECT json_extract(j.value,'$[0]'),json_extract(j.value,'$[1]') FROM runtime_state r,json_each(r.textValue,'$.page') j WHERE r.key=? AND json_extract(r.textValue,'$.token')=?";
  const updates=endpointOnlyColumns.filter(column=>!['agent_chainId','agent_agentKey','endpointKey'].includes(column)).map(column=>`${column}=excluded.${column}`).join(',');
  // Absolute values, one bounded tuple at a time. Triggers remove declarations
  // concurrently; no per-agent DELETE/refill fanout or synthetic empty rows.
  statements.push(db.prepare(`INSERT INTO ${ENDPOINT_ONLY_TABLE} ${endpointOnlySourceSql}
   AND (d.agentKey,d.endpointKey) IN (${keys})
   ON CONFLICT(agent_chainId,agent_agentKey,endpointKey) DO UPDATE SET ${updates}`).bind(ENDPOINT_BACKFILL_KEY,token));
 }
 const final=state.phase==='building'
  ? `json_remove(json_set(textValue,'$.agentKey',COALESCE(json_extract(textValue,'$.page[#-1][0]'),json_extract(textValue,'$.agentKey')),'$.endpointKey',COALESCE(json_extract(textValue,'$.page[#-1][1]'),json_extract(textValue,'$.endpointKey')),'$.phase',CASE WHEN json_array_length(json_extract(textValue,'$.page'))=0 THEN 'verify' ELSE 'building' END,'$.revision',json_extract(textValue,'$.revision')+1,'$.lastToken',?), '$.token','$.page')`
  : `json_remove(json_set(textValue,'$.phase',CASE WHEN NOT EXISTS(SELECT * FROM (${endpointOnlySourceSql}) EXCEPT SELECT * FROM ${ENDPOINT_ONLY_TABLE}) AND NOT EXISTS(SELECT * FROM ${ENDPOINT_ONLY_TABLE} EXCEPT SELECT * FROM (${endpointOnlySourceSql})) THEN 'complete' ELSE 'mismatch' END,'$.revision',json_extract(textValue,'$.revision')+1,'$.lastToken',?), '$.token')`;
 statements.push(db.prepare(`UPDATE runtime_state SET textValue=${final} WHERE key=? AND json_extract(textValue,'$.token')=?`).bind(token,ENDPOINT_BACKFILL_KEY,token));
 const results=await db.batch(statements);if(results[0]?.results?.length!==1)return'raced';
 const after=await endpointBackfillStatus(db);if(after?.state.lastToken!==token)return'raced';
 return after.state.phase==='complete'||after.state.phase==='mismatch'?after.state.phase:'progress';
}
