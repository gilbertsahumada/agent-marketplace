import type {D1Database} from '../types';
import {publicProjectionDatabase} from '../db/public-projection-queries';
import {PUBLIC_PROJECTION_CURSOR_KEY,publicProjectionsReady} from './public-projections';
import {PUBLIC_CURRENT_TABLE,publicCurrentColumns,publicCurrentSourceSql,publicCurrentTriggerStatements,publicCurrentUpsertPageSql} from './public-current-projection-sql';

export const PUBLIC_CURRENT_BACKFILL_KEY='catalog_public_current_backfill_v1';
export const PUBLIC_CURRENT_PAGE_RESERVATION=80_000;
export const PUBLIC_CURRENT_VERIFY_RESERVATION=2_000_000;
type State={version:1;phase:'building'|'verify'|'complete'|'mismatch';agentKey:string;endpointKey:string;revision:number;lastToken?:string};
export async function readPublicCurrentBackfillStatus(db:D1Database):Promise<{state:State;reserved:number}|null>{
 const row=await publicProjectionDatabase(db).first<{textValue:string;integerValue:number}>('SELECT textValue,integerValue FROM runtime_state WHERE key=?',[PUBLIC_CURRENT_BACKFILL_KEY]);
 if(!row)return null;
 try{const state=JSON.parse(row.textValue) as State;
  if(state.version!==1||!['building','verify','complete','mismatch'].includes(state.phase)||typeof state.agentKey!=='string'||typeof state.endpointKey!=='string'||!Number.isSafeInteger(state.revision)||state.revision<0||!Number.isSafeInteger(row.integerValue)||row.integerValue<0)return null;
  return{state,reserved:row.integerValue};
 }catch{return null;}
}
/** One bounded checkpoint lookup. The caller also checks shared sparse coverage.
 * Deployment must invalidate this checkpoint BEFORE changing projection DDL. */
export async function publicCurrentProjectionReady(db:D1Database):Promise<boolean>{
 try{return (await readPublicCurrentBackfillStatus(db))?.state.phase==='complete';}catch{return false;}
}
/** NEW build only, not resume. Preserve all charged reservations, even from
 * failures, and invalidate old claims before the caller replaces infrastructure. */
export async function beginPublicCurrentBackfill(db:D1Database):Promise<void>{
 const orm=publicProjectionDatabase(db);
 const old=await orm.first('SELECT textValue FROM runtime_state WHERE key=?',[PUBLIC_CURRENT_BACKFILL_KEY]);
 const current=await readPublicCurrentBackfillStatus(db);
 if(old&&!current)throw Error('INVALID_PUBLIC_CURRENT_CHECKPOINT');
 const state:State={version:1,phase:'building',agentKey:'',endpointKey:'',revision:(current?.state.revision??-1)+1};
 const result=current
  ?await orm.statement('UPDATE runtime_state SET textValue=? WHERE key=? AND textValue=? RETURNING key',[JSON.stringify(state),PUBLIC_CURRENT_BACKFILL_KEY,JSON.stringify(current.state)])
  :await orm.statement('INSERT INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES(?,?,0,0) ON CONFLICT(key) DO NOTHING RETURNING key',[PUBLIC_CURRENT_BACKFILL_KEY,JSON.stringify(state)]);
 if(!result.success||result.results?.length!==1)throw Error('PUBLIC_CURRENT_RESET_RACED');
}
const infrastructureNames=[PUBLIC_CURRENT_TABLE,...publicCurrentTriggerStatements.filter(sql=>sql.startsWith('CREATE TRIGGER')).map(sql=>sql.split(' ')[2])];
async function infrastructureReady(db:D1Database):Promise<boolean>{
 const names=infrastructureNames;
 const result=await publicProjectionDatabase(db).all<{name:string}>(`SELECT name FROM sqlite_master WHERE name IN (${names.map(()=>'?').join(',')})`,names);
 return result.length===names.length;
}
/** Admission is durable before data writes. A rolled-back batch or CAS loser
 * keeps its charge; no automatic retry/refund. The supplied cap must have been
 * admitted by the shared release budget, not inferred from remaining balance. */
export async function stepPublicCurrentBackfill(db:D1Database,cap:number,token:string=crypto.randomUUID()):Promise<'progress'|'complete'|'mismatch'|'denied'|'unavailable'|'raced'>{
 if(!Number.isSafeInteger(cap)||cap<0||!db.batch||!token)throw Error('INVALID_PUBLIC_CURRENT_OPTIONS');
 const orm=publicProjectionDatabase(db);
 const current=await readPublicCurrentBackfillStatus(db);if(!current)return'unavailable';
 const {state}=current;if(state.phase==='complete'||state.phase==='mismatch')return state.phase;
 const estimate=state.phase==='verify'?PUBLIC_CURRENT_VERIFY_RESERVATION:PUBLIC_CURRENT_PAGE_RESERVATION;
 if(current.reserved+estimate>cap)return'denied';
 const serialized=JSON.stringify(state);
 const admission=await orm.statement('UPDATE runtime_state SET integerValue=integerValue+? WHERE key=? AND textValue=? AND integerValue+?<=? RETURNING key',[estimate,PUBLIC_CURRENT_BACKFILL_KEY,serialized,estimate,cap]);
 if(!admission.success)throw Error('PUBLIC_CURRENT_ADMISSION_UNCONFIRMED');
 if(admission.results?.length!==1)return'raced';
 if(!await infrastructureReady(db)||!await publicProjectionsReady(db))return'unavailable';
 const page=`SELECT json_group_array(json_array(chainId,agentKey,endpointKey)) FROM (
  SELECT a.chainId,d.agentKey,d.endpointKey FROM catalog_agent_endpoints d CROSS JOIN catalog_agents a ON a.agentKey=d.agentKey
  WHERE (d.agentKey,d.endpointKey)>(json_extract(runtime_state.textValue,'$.agentKey'),json_extract(runtime_state.textValue,'$.endpointKey'))
   AND d.declarationState='current' ORDER BY d.agentKey,d.endpointKey LIMIT 40)`;
 const claim=orm.statement(`UPDATE runtime_state SET textValue=json_set(textValue,'$.token',?${state.phase==='building'?`, '$.page',json((${page}))`:''}) WHERE key=? AND textValue=? RETURNING key`,[token,PUBLIC_CURRENT_BACKFILL_KEY,serialized]);
 const statements=[claim];
 if(state.phase==='building'){
  // Replace the helper's single bound JSON page with the transaction's claimed
  // page. This keeps source reads, absolute upsert and cursor atomic.
  const sql=publicCurrentUpsertPageSql.replace('json_each(?)',`json_each((SELECT json_extract(textValue,'$.page') FROM runtime_state WHERE key=? AND json_extract(textValue,'$.token')=?))`);
  statements.push(orm.statement(sql,[PUBLIC_CURRENT_BACKFILL_KEY,token]));
 }
 const sparse=`EXISTS(SELECT 1 FROM runtime_state WHERE key='${PUBLIC_PROJECTION_CURSOR_KEY}' AND json_valid(textValue) AND json_extract(textValue,'$.version')=1 AND json_extract(textValue,'$.phase')='complete')`;
 // Recheck inside the same transaction as coverage approval: a concurrent
 // bootstrap must never leave a complete checkpoint without maintenance.
 const infrastructure=`(SELECT COUNT(*) FROM sqlite_master WHERE name IN (${infrastructureNames.map(name=>`'${name}'`).join(',')}))=${infrastructureNames.length}`;
 const projected=`SELECT ${publicCurrentColumns.join(',')} FROM ${PUBLIC_CURRENT_TABLE}`;
 const final=state.phase==='building'
  ?`json_remove(json_set(textValue,'$.agentKey',COALESCE(json_extract(textValue,'$.page[#-1][1]'),json_extract(textValue,'$.agentKey')),'$.endpointKey',COALESCE(json_extract(textValue,'$.page[#-1][2]'),json_extract(textValue,'$.endpointKey')),'$.phase',CASE WHEN json_array_length(json_extract(textValue,'$.page'))=0 THEN 'verify' ELSE 'building' END,'$.revision',json_extract(textValue,'$.revision')+1,'$.lastToken',?), '$.token','$.page')`
  :`json_remove(json_set(textValue,'$.phase',CASE WHEN ${sparse} AND ${infrastructure} AND NOT EXISTS(SELECT * FROM (${publicCurrentSourceSql}) EXCEPT ${projected}) AND NOT EXISTS(${projected} EXCEPT SELECT * FROM (${publicCurrentSourceSql})) THEN 'complete' ELSE 'mismatch' END,'$.revision',json_extract(textValue,'$.revision')+1,'$.lastToken',?), '$.token')`;
 statements.push(orm.statement(`UPDATE runtime_state SET textValue=${final} WHERE key=? AND json_extract(textValue,'$.token')=?`,[token,PUBLIC_CURRENT_BACKFILL_KEY,token]));
 const results=await orm.batch(statements);if(results.some(result=>!result.success))throw Error('PUBLIC_CURRENT_BATCH_UNCONFIRMED');
 if(results[0]?.results?.length!==1)return'raced';
 const after=await readPublicCurrentBackfillStatus(db);if(after?.state.lastToken!==token)return'raced';
 return after.state.phase==='complete'||after.state.phase==='mismatch'?after.state.phase:'progress';
}
