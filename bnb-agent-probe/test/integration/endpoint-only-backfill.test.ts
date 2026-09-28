import {env} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import {clearCatalogFixtures} from './catalog-fixtures';
import {metered,type ReadRecord} from './d1-meter';
import type {D1Database} from '../../src/types';
import {constructEndpointOnlyPrototype,ENDPOINT_ONLY_TABLE} from '../prototypes/endpoint-only-public-prototype';
import {dropEndpointOnlyMaintenance,installEndpointOnlyMaintenance} from '../prototypes/endpoint-only-maintenance';
import {ENDPOINT_BACKFILL_KEY,ENDPOINT_PAGE_RESERVATION,endpointBackfillStatus,initializeEndpointCheckpoint,stepEndpointBackfill} from '../prototypes/endpoint-only-backfill';
import {seedEndpointCardinalityFixture} from '../prototypes/endpoint-only-cardinality-fixture';
const db=env.DB as unknown as D1Database;
const cost=(log:ReadRecord[])=>({reads:log.reduce((n,r)=>n+r.rowsRead,0),writes:log.reduce((n,r)=>n+r.rowsWritten,0),queries:log.length});
beforeEach(async()=>{await dropEndpointOnlyMaintenance(db);await clearCatalogFixtures();await db.prepare('DELETE FROM runtime_state WHERE key=?').bind(ENDPOINT_BACKFILL_KEY).run();});
async function seed(count:number){
 await db.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt)VALUES('eip155:56:1','1',56,'Agent','ok','current',0,0),('eip155:97:1','1',97,'Empty','ok','current',0,0)").run();
 await db.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
 INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt)
 SELECT printf('%064d',x),'a2a','https://seller.example/a2a','origin','safe','operational','a2a','eligible',0 FROM n`).bind(count).run();
 await db.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt) SELECT 'eip155:56:1',endpointKey,'current',0,0 FROM catalog_endpoints").run();
 await constructEndpointOnlyPrototype(db);await db.prepare(`DELETE FROM ${ENDPOINT_ONLY_TABLE}`).run();
 await installEndpointOnlyMaintenance(db);await initializeEndpointCheckpoint(db);
}
async function finish(){for(let n=0;n<10;n++){const result=await stepEndpointBackfill(db,10_000_000);if(result==='complete')return;expect(result).toBe('progress');}throw new Error('NOT_COMPLETE');}
it('bounds a page by endpoint tuples even when one agent owns the whole backlog',async()=>{
 await seed(100);const log:ReadRecord[]=[];
 expect(await stepEndpointBackfill(metered(db,log),10_000_000)).toBe('progress');
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE}`).first()).toEqual({n:40});
 expect((await endpointBackfillStatus(db))?.state).toMatchObject({agentKey:'eip155:56:1',endpointKey:'40'.padStart(64,'0'),revision:1});
 expect(cost(log).reads+1000*cost(log).writes).toBeLessThanOrEqual(ENDPOINT_PAGE_RESERVATION);
 await finish();expect(await db.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE}`).first()).toEqual({n:100});
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE} WHERE agent_agentKey='eip155:97:1'`).first()).toEqual({n:0});
});
it('retains the reservation but not cursor advancement after a failed page',async()=>{
 await seed(5);const before=await endpointBackfillStatus(db);
 await db.prepare(`CREATE TRIGGER prototype_endpoint_failure BEFORE INSERT ON ${ENDPOINT_ONLY_TABLE} BEGIN SELECT RAISE(ABORT,'FAIL_PAGE');END`).run();
 await expect(stepEndpointBackfill(db,10_000_000)).rejects.toThrow('FAIL_PAGE');
 expect(await endpointBackfillStatus(db)).toEqual({...before,reserved:ENDPOINT_PAGE_RESERVATION});
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE}`).first()).toEqual({n:0});
 expect(await stepEndpointBackfill(db,ENDPOINT_PAGE_RESERVATION)).toBe('denied');
 await db.prepare('DROP TRIGGER prototype_endpoint_failure').run();await finish();
});
it('keeps source updates behind the cursor and verifies coverage before approval',async()=>{
 await seed(100);await stepEndpointBackfill(db,10_000_000);
 await Promise.all([stepEndpointBackfill(db,10_000_000),db.prepare("UPDATE catalog_agents SET name='Latest' WHERE agentKey='eip155:56:1'").run()]);
 await db.prepare("DELETE FROM catalog_agent_endpoints WHERE agentKey='eip155:56:1' AND endpointKey=?").bind('1'.padStart(64,'0')).run();
 await finish();
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE} WHERE agent_name='Latest'`).first()).toEqual({n:99});
});
it('fails closed on a mismatch rather than treating backfill exhaustion as readiness',async()=>{
 await seed(2);await stepEndpointBackfill(db,10_000_000);await stepEndpointBackfill(db,10_000_000);
 await db.prepare(`UPDATE ${ENDPOINT_ONLY_TABLE} SET agent_name='Bad'`).run();
 expect(await stepEndpointBackfill(db,10_000_000)).toBe('mismatch');
});

it('invalidates previous coverage before rebuilding without refunding admitted work',async()=>{
 await seed(2);await finish();
 const before=await endpointBackfillStatus(db);
 expect(before?.state.phase).toBe('complete');
 await initializeEndpointCheckpoint(db);
 const restarted=await endpointBackfillStatus(db);
 expect(restarted?.state).toMatchObject({phase:'building',agentKey:'',endpointKey:'',revision:before!.state.revision+1});
 expect(restarted?.reserved).toBe(before!.reserved);
 // Coverage is already unavailable if subsequent table construction fails.
 await db.prepare(`DELETE FROM ${ENDPOINT_ONLY_TABLE}`).run();
 expect((await endpointBackfillStatus(db))?.state.phase).toBe('building');
 await finish();
 expect((await endpointBackfillStatus(db))?.reserved).toBeGreaterThan(before!.reserved);
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE}`).first()).toEqual({n:2});
});

it('keeps a single page owner with duplicate concurrent tokens and conservative reservations',async()=>{
 await seed(100);let arrived=0;let release!:()=>void;
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 const concurrent=new Proxy(db,{get(target,key){
  if(key==='batch')return async(statements:Parameters<NonNullable<D1Database['batch']>>[0])=>{if(++arrived===2)release();await barrier;return target.batch!(statements);};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const results=await Promise.all([stepEndpointBackfill(concurrent,10_000_000,'same'),stepEndpointBackfill(concurrent,10_000_000,'same')]);
 expect(results.sort()).toEqual(['progress','raced']);
 expect((await endpointBackfillStatus(db))?.reserved).toBe(2*ENDPOINT_PAGE_RESERVATION);
 expect((await endpointBackfillStatus(db))?.state.revision).toBe(1);
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE}`).first()).toEqual({n:40});
 await finish();
});

it('never admits two workers against a single remaining page allowance',async()=>{
 await seed(100);
 const results=await Promise.all([stepEndpointBackfill(db,ENDPOINT_PAGE_RESERVATION),stepEndpointBackfill(db,ENDPOINT_PAGE_RESERVATION)]);
 expect(results.filter(result=>result==='progress')).toHaveLength(1);
 expect((await endpointBackfillStatus(db))?.reserved).toBe(ENDPOINT_PAGE_RESERVATION);
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE}`).first()).toEqual({n:40});
});

it('meters a complete bounded backfill for the observed declaration cardinalities',async()=>{
 const setup:ReadRecord[]=[],steps:ReadRecord[]=[];
 await constructEndpointOnlyPrototype(metered(db,setup));
 await seedEndpointCardinalityFixture(db);
 await installEndpointOnlyMaintenance(metered(db,setup));await initializeEndpointCheckpoint(metered(db,setup));
 let calls=0,maxPageUnits=0;
 for(;;){
  const page:ReadRecord[]=[];const before=await endpointBackfillStatus(db);
  const result=await stepEndpointBackfill(metered(db,page),90_000_000);steps.push(...page);calls++;
  const units=cost(page).reads+1000*cost(page).writes;
  if(before?.state.phase==='building')maxPageUnits=Math.max(maxPageUnits,units);
  if(result==='complete')break;expect(result).toBe('progress');if(calls>1022)throw new Error('UNBOUNDED_BACKFILL');
 }
 const status=await endpointBackfillStatus(db);
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE}`).first()).toEqual({n:40767});
 expect(calls).toBe(1022);expect(maxPageUnits).toBeLessThanOrEqual(ENDPOINT_PAGE_RESERVATION);
 expect(status?.reserved).toBeLessThanOrEqual(90_000_000);
 console.info('ENDPOINT_BACKFILL_CARDINALITY',JSON.stringify({fixture:'observed agent/declaration counts only; no historic payload replica',setup:cost(setup),steps:cost(steps),calls,maxPageUnits,reserved:status?.reserved}));
 expect({setup:cost(setup),steps:cost(steps),calls,maxPageUnits,reserved:status?.reserved}).toEqual({
  // Six additional sqlite_master objects from the pilot affect DDL setup only.
  setup:{reads:143,writes:16,queries:28},steps:{reads:661468,writes:43833,queries:6131},calls:1022,maxPageUnits:43249,reserved:83680000,
 });
},120_000);
