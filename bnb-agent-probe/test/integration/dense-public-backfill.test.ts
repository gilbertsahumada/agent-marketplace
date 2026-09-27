import {env} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {D1Database} from '../../src/types';
import {clearCatalogFixtures} from './catalog-fixtures';
import {dropDenseMaintenance} from '../prototypes/dense-public-maintenance';
import {PROTOTYPE_TABLE} from '../prototypes/dense-public-classification';
import {DENSE_CHECKPOINT,PAGE_ESTIMATE,VERIFY_ESTIMATE,initializeDenseBackfill,denseBackfillReady,denseBackfillStatus,stepDenseBackfill} from '../prototypes/dense-public-backfill';
import {metered,type ReadRecord} from './d1-meter';
const db=env.DB as unknown as D1Database,options={admissionUnits:10_000_000,pageSize:1};
beforeEach(async()=>{await dropDenseMaintenance(db);await db.prepare(`DROP TABLE IF EXISTS ${PROTOTYPE_TABLE}`).run();await clearCatalogFixtures();await db.prepare('DELETE FROM runtime_state WHERE key=?').bind(DENSE_CHECKPOINT).run();});
async function agent(id:string){await db.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES(?,?,56,'Original','ok','current',0,0)").bind(`eip155:56:${id}`,id).run();}
async function finish(){for(let n=0;n<10;n++){const result=await stepDenseBackfill(db,options);if(result==='complete')return;expect(result).toBe('progress');}throw new Error('BACKFILL_DID_NOT_COMPLETE');}
const cost=(log:ReadRecord[])=>({queries:log.length,reads:log.reduce((n,r)=>n+r.rowsRead,0),writes:log.reduce((n,r)=>n+r.rowsWritten,0)});

it('fails closed without a checkpoint and only marks complete after bidirectional verification',async()=>{
 await agent('20');await agent('30');expect(await denseBackfillReady(db)).toBe(false);
 expect(await stepDenseBackfill(db,options)).toBe('unavailable');
 await initializeDenseBackfill(db);expect(await denseBackfillReady(db)).toBe(false);
 expect(await stepDenseBackfill(db,options)).toBe('progress');expect(await denseBackfillReady(db)).toBe(false);
 expect(await stepDenseBackfill(db,options)).toBe('progress');
 expect(await stepDenseBackfill(db,options)).toBe('progress');
 expect((await denseBackfillStatus(db)).state?.phase).toBe('verify');expect(await denseBackfillReady(db)).toBe(false);
 expect(await stepDenseBackfill(db,options)).toBe('complete');expect(await denseBackfillReady(db)).toBe(true);
 const logs:ReadRecord[]=[];expect(await stepDenseBackfill(metered(db,logs),options)).toBe('complete');expect(cost(logs).writes).toBe(0);
});

it('source triggers cover inserts behind the cursor and changes concurrent with a page',async()=>{
 await agent('20');await agent('30');await initializeDenseBackfill(db);await stepDenseBackfill(db,options);
 await agent('10');
 await Promise.all([
  stepDenseBackfill(db,options),
  db.prepare("UPDATE catalog_agents SET name='Latest' WHERE agentId='20'").run(),
 ]);
 await finish();
 expect((await db.prepare(`SELECT agent_agentId id,agent_name name FROM ${PROTOTYPE_TABLE} ORDER BY agent_agentId`).all()).results).toEqual([{id:'10',name:'Original'},{id:'20',name:'Latest'},{id:'30',name:'Original'}]);
});

it.each([false,true])('serializes duplicate workers with a checkpoint CAS, retaining both pre-admitted reservations; same token=%s',async sameToken=>{
 await agent('20');await agent('30');await initializeDenseBackfill(db);
 const expected=(await denseBackfillStatus(db)).state!;
 let release!:()=>void,arrived=0;const both=new Promise<void>(resolve=>{release=resolve;});
 const concurrent=new Proxy(db,{get(target,key){if(key==='batch')return async(statements:Parameters<NonNullable<D1Database['batch']>>[0])=>{if(++arrived===2)release();await both;return target.batch!(statements);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const outcomes=await Promise.all([stepDenseBackfill(concurrent,{...options,expected,token:'first'}),stepDenseBackfill(concurrent,{...options,expected,token:sameToken?'first':'second'})]);
 expect(outcomes.sort()).toEqual(['progress','raced']);
 expect(await denseBackfillStatus(db)).toMatchObject({state:{cursor:'eip155:56:20',revision:1},reservedUnits:2*PAGE_ESTIMATE});
 const after=await denseBackfillStatus(db);
 expect(await stepDenseBackfill(db,{...options,expected,token:'first'})).toBe('raced');
 expect(await denseBackfillStatus(db)).toEqual(after);
 await finish();expect(await db.prepare(`SELECT COUNT(*) n FROM ${PROTOTYPE_TABLE}`).first()).toEqual({n:2});
});

it('retains an abandoned admission when the isolate fails before the data batch',async()=>{
 await agent('20');await initializeDenseBackfill(db);const before=await denseBackfillStatus(db);
 const abandoned=new Proxy(db,{get(target,key){if(key==='batch')return async()=>{throw new Error('ISOLATE_STOPPED');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await expect(stepDenseBackfill(abandoned,options)).rejects.toThrow('ISOLATE_STOPPED');
 expect(await denseBackfillStatus(db)).toEqual({...before,reservedUnits:PAGE_ESTIMATE});
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${PROTOTYPE_TABLE}`).first()).toEqual({n:0});
 expect(await stepDenseBackfill(db,{...options,admissionUnits:PAGE_ESTIMATE})).toBe('denied');
 await finish();expect(await denseBackfillReady(db)).toBe(true);
});

it('never exceeds the admission cap when concurrent callers compete for the last page reservation',async()=>{
 await agent('20');await initializeDenseBackfill(db);
 const results=await Promise.all([stepDenseBackfill(db,{...options,admissionUnits:PAGE_ESTIMATE}),stepDenseBackfill(db,{...options,admissionUnits:PAGE_ESTIMATE})]);
 expect(results.filter(value=>value==='progress')).toHaveLength(1);
 expect(results.filter(value=>value==='denied'||value==='raced')).toHaveLength(1);
 expect(await denseBackfillStatus(db)).toMatchObject({state:{cursor:'eip155:56:20',revision:1},reservedUnits:PAGE_ESTIMATE});
});

it('retains admission after a failed page while replacement and cursor roll back; retry is absolute',async()=>{
 await agent('20');await initializeDenseBackfill(db);
 await db.prepare(`CREATE TRIGGER prototype_fail_dense BEFORE INSERT ON ${PROTOTYPE_TABLE} BEGIN SELECT RAISE(ABORT,'INJECTED_PAGE_FAILURE');END`).run();
 const before=await denseBackfillStatus(db);
 await expect(stepDenseBackfill(db,options)).rejects.toThrow('INJECTED_PAGE_FAILURE');
 expect(await denseBackfillStatus(db)).toEqual({...before,reservedUnits:PAGE_ESTIMATE});expect(await db.prepare(`SELECT COUNT(*) n FROM ${PROTOTYPE_TABLE}`).first()).toEqual({n:0});
 expect(await stepDenseBackfill(db,{...options,admissionUnits:PAGE_ESTIMATE})).toBe('denied');
 expect((await denseBackfillStatus(db)).state).toEqual(before.state);
 await db.prepare('DROP TRIGGER prototype_fail_dense').run();await finish();expect(await denseBackfillReady(db)).toBe(true);
});

it('retains an incomplete cursor when the local admission cap cannot fit another page or verification',async()=>{
 await agent('20');await initializeDenseBackfill(db);
 const initial=await denseBackfillStatus(db),log:ReadRecord[]=[];
 expect(await stepDenseBackfill(metered(db,log),{...options,admissionUnits:PAGE_ESTIMATE-1})).toBe('denied');
 expect(cost(log).writes).toBe(0);expect(await denseBackfillStatus(db)).toEqual(initial);
 await stepDenseBackfill(db,options);await stepDenseBackfill(db,options);
 const before=await denseBackfillStatus(db);
 expect(await stepDenseBackfill(db,{...options,admissionUnits:2*PAGE_ESTIMATE+VERIFY_ESTIMATE-1})).toBe('denied');
 expect(await denseBackfillStatus(db)).toEqual(before);expect(await denseBackfillReady(db)).toBe(false);
});

it.each(['missing','corrupt','orphan'])('does not approve %s rows as complete coverage',async kind=>{
 await agent('20');await initializeDenseBackfill(db);await stepDenseBackfill(db,options);await stepDenseBackfill(db,options);
 if(kind==='missing')await db.prepare(`DELETE FROM ${PROTOTYPE_TABLE}`).run();
 if(kind==='corrupt')await db.prepare(`UPDATE ${PROTOTYPE_TABLE} SET agent_name='Corrupt'`).run();
 if(kind==='orphan'){
  const columns=(await db.prepare(`PRAGMA table_info(${PROTOTYPE_TABLE})`).all<{name:string}>()).results!;
  await db.prepare(`INSERT INTO ${PROTOTYPE_TABLE} SELECT ${columns.map(({name})=>name==='agent_agentKey'?"'orphan'":name).join(',')} FROM ${PROTOTYPE_TABLE}`).run();
 }
 expect(await stepDenseBackfill(db,options)).toBe('mismatch');expect(await denseBackfillReady(db)).toBe(false);
});

it('records page controls and verification physical costs separately from estimated admission',async()=>{
 await agent('20');await initializeDenseBackfill(db);const page:ReadRecord[]=[],empty:ReadRecord[]=[],verify:ReadRecord[]=[];
 await stepDenseBackfill(metered(db,page),options);await stepDenseBackfill(metered(db,empty),options);await stepDenseBackfill(metered(db,verify),options);
 expect((await denseBackfillStatus(db)).reservedUnits).toBe(2*PAGE_ESTIMATE+VERIFY_ESTIMATE);
 expect({page:cost(page),empty:cost(empty),verify:cost(verify)}).toEqual({page:{queries:7,reads:16,writes:4},empty:{queries:7,reads:13,writes:3},verify:{queries:5,reads:15,writes:3}});
});

it.each([2000,20000])('measures resumable %i-agent initialization including verification and control reads',async count=>{
 await db.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
 INSERT INTO catalog_agents(agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt)
 SELECT 'eip155:'||CASE WHEN x%2=0 THEN 56 ELSE 97 END||':'||x,CAST(x AS TEXT),CASE WHEN x%2=0 THEN 56 ELSE 97 END,'Agent','ok','current',0,0 FROM n`).bind(count).run();
 await db.prepare(`INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt)
 SELECT agentKey,'a2a','https://seller.example/a2a','origin','safe','operational','a2a','eligible',0 FROM catalog_agents`).run();
 await db.prepare(`INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt)
 SELECT agentKey,agentKey,'current','v1',0,0 FROM catalog_agents`).run();
 await db.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,nextProbeAt,createdAt,updatedAt)
 SELECT agentKey,agentKey,'a2a','discovered','pending',0,0,0 FROM catalog_agents`).run();
 const initialization:ReadRecord[]=[],steps:ReadRecord[]=[];
 await initializeDenseBackfill(metered(db,initialization));
 let calls=0;
 for(;;){const result=await stepDenseBackfill(metered(db,steps),{admissionUnits:250_000_000,pageSize:40});calls++;if(result==='complete')break;expect(result).toBe('progress');if(calls>count/40+2)throw new Error('EXCESS_PAGES');}
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${PROTOTYPE_TABLE}`).first()).toEqual({n:count});
 expect({count,calls,initialization:cost(initialization),steps:cost(steps),reserved:(await denseBackfillStatus(db)).reservedUnits}).toEqual({count,calls:count/40+2,initialization:{queries:28,reads:1,writes:16},steps:{queries:count/40*7+12,reads:count*23.25+17,writes:count*1.075+6},reserved:(count/40+1)*PAGE_ESTIMATE+VERIFY_ESTIMATE});
 expect(cost(steps.slice(-5))).toEqual({queries:5,reads:count*14+5,writes:3});
},120_000);

it('invalidates an old complete marker before rebuilding a missing table and retains charges',async()=>{
 await agent('20');await initializeDenseBackfill(db);await finish();
 const prior=await denseBackfillStatus(db);
 await db.prepare(`DROP TABLE ${PROTOTYPE_TABLE}`).run();
 await initializeDenseBackfill(db);expect(await denseBackfillReady(db)).toBe(false);
 expect((await denseBackfillStatus(db)).reservedUnits).toBe(prior.reservedUnits);
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${PROTOTYPE_TABLE}`).first()).toEqual({n:0});
 await finish();expect(await denseBackfillReady(db)).toBe(true);
});
