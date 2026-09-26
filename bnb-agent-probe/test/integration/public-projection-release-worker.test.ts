import {env} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import release,{RELEASE_LEDGER_KEY,RELEASE_LIMITS,PRIOR_CAPTURE_UNITS,type ReleaseEnvironment} from '../../scripts/public-projection-release-worker';
import {PUBLIC_CURRENT_BACKFILL_KEY,readPublicCurrentBackfillStatus} from '../../src/catalog/public-current-backfill';
import type {D1Database} from '../../src/types';
const secret='isolated-local-release-secret-123456789';
const bindings:ReleaseEnvironment={DB:env.DB,PUBLIC_PROJECTION_RELEASE_SECRET:secret,PUBLIC_PROJECTION_RELEASE_ENABLED:'1',PUBLIC_PROJECTION_INDEX_RESERVATION_UNITS:'7871859'};
const rawCall=(path:string,body:unknown={},settings=bindings)=>release.fetch(new Request('https://release.invalid/'+path,{method:path==='status'?'GET':'POST',headers:{authorization:`Bearer ${secret}`},...(path==='status'?{}:{body:JSON.stringify(body)})}),settings);
const call=async(path:string,body:unknown={},settings=bindings)=>{const result=await rawCall(path,body,settings);if(result.ok){const value=await result.clone().json() as {confirmationRequired?:boolean;ledger?:{active?:{token:string}}};if(value.confirmationRequired)expect((await rawCall('confirm',{token:value.ledger!.active!.token},settings)).status).toBe(200);}return result;};
const ledger=async()=>JSON.parse((await env.DB.prepare('SELECT textValue FROM runtime_state WHERE key=?').bind(RELEASE_LEDGER_KEY).first<{textValue:string}>())!.textValue);
beforeEach(async()=>{await env.DB.prepare('DELETE FROM runtime_state WHERE key=?').bind(RELEASE_LEDGER_KEY).run();});
it('has no automatic or catalogue handlers and rejects requests before D1 without the dedicated secret',async()=>{
 expect(Object.keys(release)).toEqual(['fetch']);let reads=0;
 const db={prepare(){reads++;throw Error('UNEXPECTED_DB');},batch:async()=>[]} as D1Database;
 expect((await release.fetch(new Request('https://release.invalid/status'),{...bindings,DB:db})).status).toBe(401);
 expect((await call('catalog-agents',{}, {...bindings,DB:db})).status).toBe(400);
 expect((await call('init',{}, {...bindings,DB:db,PUBLIC_PROJECTION_RELEASE_ENABLED:'0'})).status).toBe(404);
 expect(reads).toBe(0);
});
it('initializes the shared cap, protects C and preserves existing current charges',async()=>{
 await env.DB.prepare('UPDATE runtime_state SET integerValue=123 WHERE key=?').bind(PUBLIC_CURRENT_BACKFILL_KEY).run();
 expect((await call('init')).status).toBe(200);const state=await ledger();
 expect(state).toMatchObject({version:1,cap:250_000_000,phase:'active',base:7_871_859,cReserved:150_000_000,halted:false,active:null});
 expect(state.overhead).toBeGreaterThan(PRIOR_CAPTURE_UNITS);expect((await readPublicCurrentBackfillStatus(env.DB))?.reserved).toBe(123);
 const checkpoint=await readPublicCurrentBackfillStatus(env.DB);expect((await call('init')).status).toBe(200);expect(await readPublicCurrentBackfillStatus(env.DB)).toEqual(checkpoint);
});
it('advances only explicitly requested work and reconciles measured successful use',async()=>{
 await call('init');const initial=await ledger();expect((await call('status')).status).toBe(200);expect((await readPublicCurrentBackfillStatus(env.DB))?.state.phase).toBe('building');
 const result=await call('step',{target:'current'});expect(result.status).toBe(200);const body=await result.json() as {workUnits:number;status:string};
 expect(body.status).toBe('progress');const state=await ledger();expect(state.current).toBe(initial.current+body.workUnits);expect(state.current-initial.current).toBeLessThan(80_000);expect(state.base).toBe(initial.base);expect(state.cReserved).toBe(initial.cReserved);
});
it('refuses a page when its lane has insufficient allowance without advancing the cursor',async()=>{
 await call('init');const state=await ledger();state.current=RELEASE_LIMITS.current-79_999;
 await env.DB.prepare('UPDATE runtime_state SET textValue=? WHERE key=?').bind(JSON.stringify(state),RELEASE_LEDGER_KEY).run();const before=await readPublicCurrentBackfillStatus(env.DB);
 expect((await call('step',{target:'current'})).status).toBe(409);expect(await readPublicCurrentBackfillStatus(env.DB)).toEqual(before);expect((await ledger()).current).toBe(state.current);
});
it('retains a reservation and halts on an unconfirmed batch instead of retrying it',async()=>{
 const prior=(await readPublicCurrentBackfillStatus(env.DB))!.reserved;
 await call('init');const failing=new Proxy(env.DB as unknown as D1Database,{get(t,k){if(k==='batch')return async()=>{throw Error('ISOLATE_FAILURE');};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
 expect((await call('step',{target:'current'},{...bindings,DB:failing})).status).toBe(503);
 expect(await ledger()).toMatchObject({current:prior+80_000,halted:true,active:null});expect((await call('step',{target:'current'})).status).toBe(409);
});
it('fails closed when work metadata is missing, even if the underlying transaction committed',async()=>{
 const prior=(await readPublicCurrentBackfillStatus(env.DB))!.reserved;
 await call('init');const unknown=new Proxy(env.DB as unknown as D1Database,{get(t,k){if(k==='batch')return async(statements:Parameters<NonNullable<D1Database['batch']>>[0])=>(await t.batch!(statements)).map(({success,results})=>({success,results}));const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
 expect((await call('step',{target:'current'},{...bindings,DB:unknown})).status).toBe(503);expect(await ledger()).toMatchObject({current:prior+80_000,halted:true});
});
it('never expires an abandoned execution lock into an automatic duplicate',async()=>{
 await call('init');const state=await ledger();state.active={token:'abandoned',lane:'current',reservation:80_000};state.current+=80_000;
 await env.DB.prepare('UPDATE runtime_state SET textValue=? WHERE key=?').bind(JSON.stringify(state),RELEASE_LEDGER_KEY).run();
 expect(await (await call('step',{target:'current'})).json()).toMatchObject({error:'operator_recovery_required'});expect(await ledger()).toEqual({...state,overhead:state.overhead+5000,revision:state.revision+1});
});
it('restores the full charge and halts when the pending settlement commits without metadata',async()=>{
 await call('init');const before=await ledger();
 const unknown=new Proxy(env.DB as unknown as D1Database,{get(t,k){
  if(k==='prepare')return(query:string)=>{
   const wrap=(statement:ReturnType<D1Database['prepare']>):ReturnType<D1Database['prepare']>=>new Proxy(statement,{get(s,key){
    if(key==='bind')return(...args:unknown[])=>wrap(s.bind(...args));
    if(key==='run')return async()=>{const result=await s.run();if(query.includes("'$.active',json(?)"))return{success:result.success,results:result.results};return result;};
    const value=Reflect.get(s,key);return typeof value==='function'?value.bind(s):value;
   }});return wrap(t.prepare(query));
  };const value=Reflect.get(t,k);return typeof value==='function'?value.bind(t):value;
 }});
 expect((await call('step',{target:'current'},{...bindings,DB:unknown})).status).toBe(503);
 expect(await ledger()).toMatchObject({current:before.current+80_000,halted:true,active:null});
 expect((await call('step',{target:'current'})).status).toBe(409);
});
it('holds the full reservation until explicit confirmation and confirms idempotently without replay',async()=>{
 await call('init');const before=await ledger();expect((await rawCall('step',{target:'current'})).status).toBe(200);
 const pending=await ledger(),checkpoint=await readPublicCurrentBackfillStatus(env.DB);
 expect(pending.current).toBe(before.current+80_000);expect(pending.active.completed).toBeTruthy();
 expect((await rawCall('step',{target:'current'})).status).toBe(409);
 expect((await rawCall('confirm',{token:'wrong'})).status).toBe(409);
 const results=await Promise.all([rawCall('confirm',{token:pending.active.token}),rawCall('confirm',{token:pending.active.token})]);
 expect(results.some(result=>result.status===200)).toBe(true);
 expect((await rawCall('confirm',{token:pending.active.token})).status).toBe(200);
 expect(await readPublicCurrentBackfillStatus(env.DB)).toEqual(checkpoint);
 expect((await ledger()).current).toBe(before.current+pending.active.completed.workUnits);
});
it('admits at most one concurrent operation using a compare-and-swap ledger',async()=>{
 await call('init');const before=await readPublicCurrentBackfillStatus(env.DB);const results=await Promise.all([call('step',{target:'current'}),call('step',{target:'current'})]);
 expect(results.filter(result=>result.status===200)).toHaveLength(1);expect(results.filter(result=>result.status===409)).toHaveLength(1);
 expect((await readPublicCurrentBackfillStatus(env.DB))?.state.revision).toBe(before!.state.revision+1);
});
it('recovers an applied confirmation with a lost ACK without executing source work',async()=>{
 await call('init');await rawCall('step',{target:'current'});const pending=await ledger(),checkpoint=await readPublicCurrentBackfillStatus(env.DB);
 const unknown=new Proxy(env.DB as unknown as D1Database,{get(t,k){
  if(k==='prepare')return(query:string)=>{
   const wrap=(statement:ReturnType<D1Database['prepare']>):ReturnType<D1Database['prepare']>=>new Proxy(statement,{get(s,key){
    if(key==='bind')return(...args:unknown[])=>wrap(s.bind(...args));
    if(key==='run')return async()=>{const result=await s.run();return{success:result.success,results:result.results};};
    const value=Reflect.get(s,key);return typeof value==='function'?value.bind(s):value;
   }});return wrap(t.prepare(query));
  };const value=Reflect.get(t,k);return typeof value==='function'?value.bind(t):value;
 }});
 expect((await rawCall('confirm',{token:pending.active.token},{...bindings,DB:unknown})).status).toBe(503);
 expect((await rawCall('confirm',{token:pending.active.token})).status).toBe(200);
 expect(await readPublicCurrentBackfillStatus(env.DB)).toEqual(checkpoint);
 expect((await ledger()).current).toBe(pending.current-80_000+pending.active.completed.workUnits);
});
it('charges every admitted status and wrong confirmation until the control allowance is exhausted',async()=>{
 await call('init');const state=await ledger();state.overhead=RELEASE_LIMITS.overhead-15_000;
 await env.DB.prepare('UPDATE runtime_state SET textValue=? WHERE key=?').bind(JSON.stringify(state),RELEASE_LEDGER_KEY).run();
 const checkpoint=await readPublicCurrentBackfillStatus(env.DB);
 expect((await rawCall('status')).status).toBe(200);
 expect((await ledger()).overhead).toBe(RELEASE_LIMITS.overhead-10_000);
 expect((await rawCall('confirm',{token:'wrong'})).status).toBe(409);
 expect((await ledger()).overhead).toBe(RELEASE_LIMITS.overhead-5_000);
 expect((await rawCall('status')).status).toBe(200);
 expect((await ledger()).overhead).toBe(RELEASE_LIMITS.overhead);
 expect(await (await rawCall('status')).json()).toMatchObject({error:'control_budget_exhausted'});
 expect((await ledger()).overhead).toBe(RELEASE_LIMITS.overhead);
 expect(await readPublicCurrentBackfillStatus(env.DB)).toEqual(checkpoint);
});
it('retains control charges for halted and active refusals, including concurrent requests',async()=>{
 await call('init');const state=await ledger();state.halted=true;
 await env.DB.prepare('UPDATE runtime_state SET textValue=? WHERE key=?').bind(JSON.stringify(state),RELEASE_LEDGER_KEY).run();
 const results=await Promise.all([rawCall('step',{target:'current'}),rawCall('confirm',{token:'wrong'}),rawCall('status')]);
 expect(results.map(result=>result.status)).toEqual([409,409,200]);
 expect((await ledger()).overhead).toBe(state.overhead+15_000);
 expect((await ledger()).halted).toBe(true);
});
