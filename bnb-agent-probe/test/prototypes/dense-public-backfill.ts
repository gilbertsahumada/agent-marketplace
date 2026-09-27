/** Local-only experiment. This is not a migration or a production release gate. */
import type {D1Database} from '../../src/types';
import {PROTOTYPE_TABLE,agentFields,capabilityFields,evidenceFields} from './dense-public-classification';
import {installDenseMaintenance} from './dense-public-maintenance';

export const DENSE_CHECKPOINT='prototype_dense_backfill_v1';
export const PAGE_ESTIMATE=200_000,VERIFY_ESTIMATE=1_000_000;
export interface DenseCheckpoint {version:1;phase:'building'|'verify'|'complete'|'mismatch';cursor:string;revision:number;lastToken?:string}
export interface BackfillOptions {admissionUnits:number;pageSize?:number;token?:string;expected?:DenseCheckpoint}
const source=`SELECT ${agentFields.map(name=>`a.${name}`).join(',')},${capabilityFields.map(name=>`c.${name}`).join(',')},${evidenceFields.map(name=>`p.${name}`).join(',')},COALESCE(d.endpointKey,''),d.declarationState
 FROM catalog_agents a LEFT JOIN catalog_agent_endpoints d ON d.agentKey=a.agentKey AND d.declarationState='current'
 LEFT JOIN catalog_seller_capabilities c ON c.agentKey=d.agentKey AND c.endpointKey=d.endpointKey
 LEFT JOIN catalog_public_endpoint_evidence p ON p.agentKey=d.agentKey AND p.endpointScope=d.endpointKey AND p.projectionVersion=1`;

/** Single bootstrap owner only. Install source triggers before publishing a
 * checkpoint; an absent checkpoint always means unavailable. Reinitialization
 * invalidates coverage BEFORE any DDL and restarts verification/backfill while
 * retaining all previous admission charges. Ordinary resume uses step(), not
 * initialize(). Trigger deployment still requires a separate release guard. */
export async function initializeDenseBackfill(db:D1Database):Promise<void>{
 const previous=await db.prepare('SELECT textValue,integerValue FROM runtime_state WHERE key=?').bind(DENSE_CHECKPOINT).first<{textValue:string;integerValue:number}>();
 if(previous){
  const prior=await denseBackfillStatus(db);
  if(!prior.state)throw new Error('INVALID_DENSE_CHECKPOINT');
  const invalidated=await db.prepare('UPDATE runtime_state SET textValue=? WHERE key=? AND textValue=? RETURNING key').bind(JSON.stringify({version:1,phase:'building',cursor:'',revision:prior.state.revision+1}),DENSE_CHECKPOINT,previous.textValue).all();
  if(invalidated.results?.length!==1)throw new Error('DENSE_INITIALIZATION_RACED');
 }
 const columns=[...agentFields.map(name=>`agent_${name}`),...capabilityFields.map(name=>`cap_${name}`),...evidenceFields.map(name=>`evidence_${name}`)];
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${PROTOTYPE_TABLE}(${columns.join(',')},endpointKey TEXT NOT NULL,declarationState TEXT,PRIMARY KEY(agent_agentKey,endpointKey)) WITHOUT ROWID`).run();
 await installDenseMaintenance(db);
 await db.prepare('INSERT OR IGNORE INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES(?,?,0,0)').bind(DENSE_CHECKPOINT,JSON.stringify({version:1,phase:'building',cursor:'',revision:0})).run();
}

export async function denseBackfillStatus(db:D1Database):Promise<{state:DenseCheckpoint|null;reservedUnits:number|null}>{
 const row=await db.prepare('SELECT textValue,integerValue FROM runtime_state WHERE key=?').bind(DENSE_CHECKPOINT).first<{textValue:string;integerValue:number}>();
 if(!row)return{state:null,reservedUnits:null};
 try{
  const state=JSON.parse(row.textValue) as DenseCheckpoint;
  if(state.version!==1||!['building','verify','complete','mismatch'].includes(state.phase)||typeof state.cursor!=='string'||!Number.isSafeInteger(state.revision)||state.revision<0||!Number.isSafeInteger(row.integerValue)||row.integerValue<0)throw new Error('invalid');
  return{state,reservedUnits:row.integerValue};
 }catch{return{state:null,reservedUnits:null};}
}
export async function denseBackfillReady(db:D1Database):Promise<boolean>{return(await denseBackfillStatus(db)).state?.phase==='complete';}

/** Conservative fixed estimates are an explicit prototype admission policy,
 * not measured cost or a production spending guarantee. Even control reads
 * cost money; callers must meter every call, including refused admissions.
 * Admission commits before the data batch: failed/abandoned attempts and
 * contenders that reserve before losing the page CAS remain charged. No
 * refund is claimed. A statement can exceed its estimate once executed. */
export async function stepDenseBackfill(db:D1Database,options:BackfillOptions):Promise<'progress'|'complete'|'mismatch'|'denied'|'raced'|'unavailable'>{
 const size=options.pageSize??40;
 if(!Number.isInteger(size)||size<1||size>40||!Number.isSafeInteger(options.admissionUnits)||options.admissionUnits<0)throw new Error('INVALID_DENSE_ADMISSION');
 if(!db.batch)throw new Error('DENSE_BATCH_REQUIRED');
 const {state,reservedUnits}=await denseBackfillStatus(db);
 if(!state||reservedUnits===null)return'unavailable';
 if(state.phase==='complete'||state.phase==='mismatch')return state.phase;
 const expected=options.expected??state;
 if(JSON.stringify(expected)!==JSON.stringify(state))return'raced';
 const estimate=state.phase==='verify'?VERIFY_ESTIMATE:PAGE_ESTIMATE;
 if(reservedUnits+estimate>options.admissionUnits)return'denied';
 // Keep the conservative admission charge outside the replacement transaction.
 // Only this invocation's successful RETURNING result permits a data batch;
 // an ambiguous admission throws and its retry must reserve again.
 const reserved=await db.prepare(`UPDATE runtime_state SET integerValue=integerValue+?
   WHERE key=? AND textValue=? AND integerValue+?<=? RETURNING key`)
   .bind(estimate,DENSE_CHECKPOINT,JSON.stringify(state),estimate,options.admissionUnits).all();
 if(reserved.success!==true)throw new Error('DENSE_ADMISSION_UNCONFIRMED');
 if(reserved.results?.length!==1){
  const latest=await denseBackfillStatus(db);
  return JSON.stringify(latest.state)===JSON.stringify(state)?'denied':'raced';
 }
 const token=options.token??crypto.randomUUID();
 const finalState=state.phase==='building'
  ? `json_remove(json_set(textValue,'$.cursor',COALESCE(json_extract(textValue,'$.page[#-1]'),json_extract(textValue,'$.cursor')),'$.phase',CASE WHEN json_array_length(json_extract(textValue,'$.page'))=0 THEN 'verify' ELSE 'building' END,'$.revision',json_extract(textValue,'$.revision')+1,'$.lastToken',?), '$.token','$.page')`
  : `json_remove(json_set(textValue,'$.phase',CASE WHEN NOT EXISTS(SELECT * FROM (${source}) EXCEPT SELECT * FROM ${PROTOTYPE_TABLE}) AND NOT EXISTS(SELECT * FROM ${PROTOTYPE_TABLE} EXCEPT SELECT * FROM (${source})) THEN 'complete' ELSE 'mismatch' END,'$.revision',json_extract(textValue,'$.revision')+1,'$.lastToken',?), '$.token')`;
 const claim=state.phase==='building'
  ? db.prepare(`UPDATE runtime_state SET textValue=json_set(textValue,'$.token',?,'$.page',json((SELECT json_group_array(agentKey) FROM(SELECT agentKey FROM catalog_agents WHERE agentKey>json_extract(runtime_state.textValue,'$.cursor') ORDER BY agentKey LIMIT ?)))) WHERE key=? AND textValue=? RETURNING key`).bind(token,size,DENSE_CHECKPOINT,JSON.stringify(state))
  : db.prepare(`UPDATE runtime_state SET textValue=json_set(textValue,'$.token',?) WHERE key=? AND textValue=? RETURNING key`).bind(token,DENSE_CHECKPOINT,JSON.stringify(state));
 const statements=[claim];
 if(state.phase==='building'){
  const keys="SELECT j.value FROM runtime_state r,json_each(r.textValue,'$.page') j WHERE r.key=? AND json_extract(r.textValue,'$.token')=?";
  statements.push(db.prepare(`DELETE FROM ${PROTOTYPE_TABLE} WHERE agent_agentKey IN(${keys})`).bind(DENSE_CHECKPOINT,token));
  statements.push(db.prepare(`INSERT INTO ${PROTOTYPE_TABLE} ${source} WHERE a.agentKey IN(${keys})`).bind(DENSE_CHECKPOINT,token));
 }
 statements.push(db.prepare(`UPDATE runtime_state SET textValue=${finalState} WHERE key=? AND json_extract(textValue,'$.token')=?`).bind(token,DENSE_CHECKPOINT,token));
 const results=await db.batch(statements);
 if(!(results[0]?.results?.length))return'raced';
 const after=await denseBackfillStatus(db);
 if(after.state?.lastToken!==token)return'raced';
 return after.state.phase==='complete'||after.state.phase==='mismatch'?after.state.phase:'progress';
}
