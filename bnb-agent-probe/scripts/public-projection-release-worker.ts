/** Temporary maintenance entrypoint, not the application Worker. No catalog,
 * scheduled or queue handlers. No deployment configuration is supplied here.
 * Deploying/enabling this file requires a separate reviewed release decision.
 * External DDL/backup must use the same admission plan before execution. */
import type {D1Database,D1PreparedStatement} from '../src/types';
import {publicProjectionDatabase} from '../src/db/public-projection-queries';
import {backfillPublicProjections,readPublicProjectionCoverage} from '../src/catalog/public-projections';
import {beginPublicCurrentBackfill,readPublicCurrentBackfillStatus,stepPublicCurrentBackfill,PUBLIC_CURRENT_PAGE_RESERVATION,PUBLIC_CURRENT_VERIFY_RESERVATION} from '../src/catalog/public-current-backfill';

export const RELEASE_LEDGER_KEY='public_projection_release_budget_v1';
export const RELEASE_CAP=250_000_000;
export const RELEASE_LIMITS={base:9_000_000,current:84_000_000,c:150_000_000,overhead:7_000_000} as const;
export const PRIOR_CAPTURE_UNITS=986_144;
// Frozen local 8000-observation / 2398-hot-key benchmark, with current triggers:
// evidence 131480, metrics 21779, verify_evidence 98387, verify_metrics 3884.
// These are admission estimates, not upper bounds on arbitrary live histories.
export const SPARSE_RESERVATIONS={evidence:180_000,metrics:40_000,verify_evidence:130_000,verify_metrics:20_000} as const;
const CONTROL_RESERVATION=5_000;
type Lane='base'|'current';
type Ledger={version:1;cap:number;phase:'initializing'|'active';base:number;current:number;overhead:number;cReserved:number;revision:number;halted:boolean;lastToken?:string;active:null|{token:string;lane:Lane|'overhead';reservation:number;completed?:{workUnits:number;phase:'initializing'|'active'}}};
export interface ReleaseEnvironment{DB:D1Database;PUBLIC_PROJECTION_RELEASE_SECRET?:string;PUBLIC_PROJECTION_RELEASE_ENABLED?:string;PUBLIC_PROJECTION_INDEX_RESERVATION_UNITS?:string}

function meter(db:D1Database){
 let units=0,reliable=true;const underlying=new WeakMap<D1PreparedStatement,D1PreparedStatement>();
 const record=(result:unknown)=>{
  const meta=(result as {meta?:{rows_read?:unknown;rows_written?:unknown}})?.meta;
  if(!Number.isSafeInteger(meta?.rows_read)||!Number.isSafeInteger(meta?.rows_written)||Number(meta?.rows_read)<0||Number(meta?.rows_written)<0){reliable=false;throw Error('RELEASE_METADATA_UNAVAILABLE');}
  units+=Number(meta!.rows_read)+1000*Number(meta!.rows_written);
 };
 const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>{
  const wrapped:D1PreparedStatement={bind:(...values)=>wrap(statement.bind(...values)),
   async all<T>(){const result=await statement.all<T>();record(result);return result;},
   async run(){const result=await statement.run();record(result);return result;},
   async first<T>(columnName?:string){const result=await statement.all<T>();record(result);const row=result.results?.[0];return row===undefined?null:columnName?(row as Record<string,unknown>)[columnName] as T:row;},
  };underlying.set(wrapped,statement);return wrapped;
 };
 const measured:D1Database={prepare:query=>wrap(db.prepare(query)),...(db.batch?{async batch<T>(statements:D1PreparedStatement[]){const result=await db.batch!<T>(statements.map(statement=>underlying.get(statement)??statement));result.forEach(record);return result;}}:{})};
 return{db:measured,units:()=>units,reliable:()=>reliable};
}
function decode(text:string):Ledger{
 const value=JSON.parse(text) as Ledger;
 if(value.version!==1||value.cap!==RELEASE_CAP||!['initializing','active'].includes(value.phase)||value.cReserved!==RELEASE_LIMITS.c||typeof value.halted!=='boolean'
  ||!['base','current','overhead','revision'].every(key=>Number.isSafeInteger(value[key as keyof Ledger])&&Number(value[key as keyof Ledger])>=0)
  ||value.base>RELEASE_LIMITS.base||value.current>RELEASE_LIMITS.current||value.overhead>RELEASE_LIMITS.overhead
  ||value.base+value.current+value.overhead+value.cReserved>RELEASE_CAP
  ||value.active!==null&&(!value.active||typeof value.active.token!=='string'||!['base','current','overhead'].includes(value.active.lane)||!Number.isSafeInteger(value.active.reservation)||value.active.reservation<0))throw Error('RELEASE_LEDGER_INVALID');
 return value;
}
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function authorized(request:Request,secret:string){
 const header=request.headers.get('authorization')??'';
 const hash=async(text:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
 const [a,b]=await Promise.all([hash(header),hash(`Bearer ${secret}`)]);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]!^b[i]!;return difference===0;
}

export default {async fetch(request:Request,env:ReleaseEnvironment):Promise<Response>{
 if(env.PUBLIC_PROJECTION_RELEASE_ENABLED!=='1')return response({error:'not_enabled'},404);
 const secret=env.PUBLIC_PROJECTION_RELEASE_SECRET;
 if(!secret||secret.length<32||!env.DB?.batch)return response({error:'configuration_required'},503);
 if(!await authorized(request,secret))return response({error:'unauthorized'},401);
 const url=new URL(request.url),operation=url.pathname.slice(1);
 if(url.search||!['status','init','step','confirm'].includes(operation)||(operation==='status'?request.method!=='GET':request.method!=='POST'))return response({error:'invalid_request'},400);
 let input:Record<string,unknown>={};
 if(operation!=='status'){
  if(Number(request.headers.get('content-length')??0)>512)return response({error:'invalid_request'},400);
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>512)return response({error:'invalid_request'},400);
  try{input=JSON.parse(text||'{}');}catch{return response({error:'invalid_request'},400);}
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>operation==='step'?key!=='target':operation==='confirm'?key!=='token':true)
   ||operation==='step'&&!['sparse','current'].includes(String(input.target))||operation==='confirm'&&(typeof input.token!=='string'||input.token.length>128))return response({error:'invalid_request'},400);
 }
 const measured=meter(env.DB),db=measured.db,orm=publicProjectionDatabase(db);
 let bootstrapControl=0;
 let token:string|undefined,admittedLane:Lane|'overhead'|undefined,fullCharge=0;
 try{
  let row=await orm.first<{textValue:string}>('SELECT textValue FROM runtime_state WHERE key=?',[RELEASE_LEDGER_KEY]);
  if(!row){
   if(operation!=='init')return response({error:'initialization_required'},409);
   const indexUnits=Number(env.PUBLIC_PROJECTION_INDEX_RESERVATION_UNITS);
   if(!Number.isSafeInteger(indexUnits)||indexUnits<7_871_859||indexUnits>RELEASE_LIMITS.base)return response({error:'reviewed_index_reservation_required'},409);
   const prior=await readPublicCurrentBackfillStatus(db);
   if(prior&&prior.reserved>RELEASE_LIMITS.current)return response({error:'prior_current_budget_exceeded'},409);
   const ledger:Ledger={version:1,cap:RELEASE_CAP,phase:'initializing',base:indexUnits,current:prior?.reserved??0,cReserved:RELEASE_LIMITS.c,overhead:PRIOR_CAPTURE_UNITS+CONTROL_RESERVATION,revision:0,halted:false,active:null};
   bootstrapControl=CONTROL_RESERVATION;
   await orm.statement('INSERT INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES(?,?,0,0) ON CONFLICT(key) DO NOTHING',[RELEASE_LEDGER_KEY,JSON.stringify(ledger)]);
   row=await orm.first<{textValue:string}>('SELECT textValue FROM runtime_state WHERE key=?',[RELEASE_LEDGER_KEY]);
  }
  if(!row)throw Error('RELEASE_LEDGER_UNAVAILABLE');
  decode(row.textValue);
  // Every admitted request, including status, confirmation and denied work,
  // retains its control charge. Exhausted attempts still incur the initial
  // lookup: stop callers and disable this tool, not a hard billing guarantee.
  const charged=await orm.statement(`UPDATE runtime_state SET textValue=json_set(textValue,'$.overhead',json_extract(textValue,'$.overhead')+?,'$.revision',json_extract(textValue,'$.revision')+1) WHERE key=? AND json_extract(textValue,'$.overhead')<=? RETURNING textValue`,[CONTROL_RESERVATION,RELEASE_LEDGER_KEY,RELEASE_LIMITS.overhead-CONTROL_RESERVATION]);
  const chargedRow=charged.results?.[0] as {textValue:string}|undefined;
  if(!chargedRow)return response({error:'control_budget_exhausted'},409);
  const state=decode(chargedRow.textValue);
  row=chargedRow;
  if(operation==='status')return response({ledger:state,measuredUnits:measured.units()});
  if(operation==='confirm'){
   if(!state.active&&state.lastToken===input.token)return response({status:'confirmed',ledger:state});
   const active=state.active,done=active?.completed;
   if(state.halted||!active||active.token!==input.token||!done||!Number.isSafeInteger(done.workUnits)||done.workUnits<0||done.workUnits>active.reservation)return response({error:'confirmation_unavailable'},409);
   // Confirmation has a separate durable control charge and never performs
   // source work, including recovery after an ambiguous acknowledgement.
   const confirmed:Ledger={...state,[active.lane]:state[active.lane]-active.reservation+done.workUnits,active:null,lastToken:active.token,phase:done.phase,revision:state.revision+1};
   const result=await orm.statement('UPDATE runtime_state SET textValue=? WHERE key=? AND textValue=? RETURNING key',[JSON.stringify(confirmed),RELEASE_LEDGER_KEY,row.textValue]);
   if(result.results?.length!==1)return response({error:'concurrent_confirmation'},409);
   return response({status:'confirmed',ledger:confirmed,measuredUnits:measured.units()});
  }
  if(state.halted||state.active)return response({error:state.halted?'release_halted':'operator_recovery_required',ledger:state},409);
  const controlled=state;
  if(operation==='init'&&controlled.phase==='active')return response({status:'already_initialized',ledger:controlled});
  if(operation==='step'&&controlled.phase!=='active')return response({error:'initialization_required'},409);
  let lane:Lane|'overhead',amount:number;
  if(operation==='init'){lane='overhead';amount=10_000;}
  else if(input.target==='sparse'){
   const cursor=await readPublicProjectionCoverage(db);if(!cursor)return response({error:'sparse_migration_required'},409);
   if(cursor.phase==='complete')return response({status:'complete',ledger:controlled});
   lane='base';amount=SPARSE_RESERVATIONS[cursor.phase];
  }else{
   const checkpoint=await readPublicCurrentBackfillStatus(db);if(!checkpoint)return response({error:'current_checkpoint_required'},409);
   if(checkpoint.state.phase==='complete'||checkpoint.state.phase==='mismatch')return response({status:checkpoint.state.phase,ledger:controlled});
   lane='current';amount=checkpoint.state.phase==='verify'?PUBLIC_CURRENT_VERIFY_RESERVATION:PUBLIC_CURRENT_PAGE_RESERVATION;
  }
  if(controlled[lane]+amount>RELEASE_LIMITS[lane])return response({error:'lane_budget_exhausted',lane,requiredUnits:amount},409);
  token=crypto.randomUUID();admittedLane=lane;
  const claimed:Ledger={...controlled,[lane]:controlled[lane]+amount,active:{token,lane,reservation:amount},revision:controlled.revision+1};
  fullCharge=claimed[lane];
  const admission=await orm.statement('UPDATE runtime_state SET textValue=? WHERE key=? AND textValue=? RETURNING key',[JSON.stringify(claimed),RELEASE_LEDGER_KEY,row.textValue]);
  if(admission.results?.length!==1){token=undefined;return response({error:'concurrent_operation'},409);}
  const before=measured.units();let result:unknown;
  if(operation==='init'){await beginPublicCurrentBackfill(db);result='initialized';}
  else if(input.target==='sparse')result=(await backfillPublicProjections(db,{batchSize:40,nowMs:Date.now()})).cursor.phase;
  else result=await stepPublicCurrentBackfill(db,RELEASE_LIMITS.current);
  const workUnits=measured.units()-before;
  // A strict, successful measurement permits reconciliation; any thrown or
  // unknown result keeps the entire durable reservation. Controls stay charged.
  // Leave the execution lock in place while observing settlement metadata.
  // Reserve an additional write before checking the control envelope.
  if(measured.units()-workUnits+2_010>CONTROL_RESERVATION+bootstrapControl)throw Error('RELEASE_CONTROL_ESTIMATE_EXCEEDED');
  const settled:Ledger={...claimed,active:{token,lane,reservation:amount,completed:{workUnits,phase:operation==='init'?'active':claimed.phase}},lastToken:token,
   halted:workUnits>amount,revision:claimed.revision+1};
  if(settled[lane]>RELEASE_LIMITS[lane])settled.halted=true;
  // Preserve control charges admitted by status requests during source work.
  const finish=await orm.statement(`UPDATE runtime_state SET textValue=json_set(textValue,'$.active',json(?),'$.lastToken',?,'$.halted',json(?),'$.revision',json_extract(textValue,'$.revision')+1) WHERE key=? AND json_extract(textValue,'$.active.token')=? RETURNING textValue`,[JSON.stringify(settled.active),token,JSON.stringify(settled.halted),RELEASE_LEDGER_KEY,token]);
  if(finish.results?.length!==1)throw Error('RELEASE_SETTLEMENT_RACED');
  const persisted=decode((finish.results[0] as {textValue:string}).textValue);
  token=undefined;
  return response({status:result,confirmationRequired:true,ledger:persisted,workUnits,measuredUnits:measured.units(),controlsCharged:CONTROL_RESERVATION+bootstrapControl},persisted.halted?409:200);
 }catch{
  if(token&&admittedLane){
   // Best effort marks unknown work as halted, retaining its full charge.
   // If this fails (or the isolate dies), the durable lock requires operator
   // investigation. It has no automatic expiry/replay that could double-run.
   try{await orm.statement(`UPDATE runtime_state SET textValue=json_set(textValue,'$.halted',json('true'),'$.active',json('null'),?,MAX(COALESCE(json_extract(textValue,?),0),?)) WHERE key=? AND (json_extract(textValue,'$.active.token')=? OR (json_extract(textValue,'$.active') IS NULL AND json_extract(textValue,'$.lastToken')=?))`,['$.'+admittedLane,'$.'+admittedLane,fullCharge,RELEASE_LEDGER_KEY,token,token]);}catch{/* Locked conservatively. */}
  }
  return response({error:'release_operation_unconfirmed'},503);
 }finally{console.info('public_projection_release',{operation,knownMetadata:measured.reliable(),measuredUnits:measured.units()});}
}};
