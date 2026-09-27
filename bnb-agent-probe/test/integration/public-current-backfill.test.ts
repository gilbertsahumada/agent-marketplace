import {env} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {D1Database} from '../../src/types';
import {clearCatalogFixtures} from './catalog-fixtures';
import {metered,type ReadRecord} from './d1-meter';
import {seedEndpointCardinalityFixture} from '../prototypes/endpoint-only-cardinality-fixture';
import {PUBLIC_PROJECTION_CURSOR_KEY} from '../../src/catalog/public-projections';
import {PUBLIC_CURRENT_TABLE,publicCurrentSchemaStatements,publicCurrentTriggerStatements} from '../../src/catalog/public-current-projection-sql';
import {PUBLIC_CURRENT_BACKFILL_KEY,beginPublicCurrentBackfill,readPublicCurrentBackfillStatus,publicCurrentProjectionReady,stepPublicCurrentBackfill} from '../../src/catalog/public-current-backfill';
const db=env.DB as unknown as D1Database;
beforeEach(async()=>{
 await db.prepare('DROP TRIGGER IF EXISTS test_public_current_fail').run();
 await db.batch!(publicCurrentTriggerStatements.filter(sql=>sql.startsWith('DROP')).map(sql=>db.prepare(sql)));
 await clearCatalogFixtures();await db.prepare(`DROP TABLE IF EXISTS ${PUBLIC_CURRENT_TABLE}`).run();
 await db.prepare('DELETE FROM runtime_state WHERE key IN (?,?)').bind(PUBLIC_CURRENT_BACKFILL_KEY,PUBLIC_PROJECTION_CURSOR_KEY).run();
});
async function seed(count=100){
 await db.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES('opaque','1',97,'Name','ok','current',0,0)").run();
 await db.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?) INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt) SELECT printf('%064d',x),'a2a','https://example.invalid','origin','safe','operational','a2a','eligible',0 FROM n`).bind(count).run();
 await db.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt) SELECT 'opaque',endpointKey,'current','v1',0,0 FROM catalog_endpoints").run();
 await beginPublicCurrentBackfill(db);await db.batch!(publicCurrentSchemaStatements.map(sql=>db.prepare(sql)));
 await db.prepare('INSERT INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES(?,?,0,0)').bind(PUBLIC_PROJECTION_CURSOR_KEY,JSON.stringify({version:1,phase:'complete',agentKey:'',endpointScope:''})).run();
}
async function finish(){for(let i=0;i<10;i++){const result=await stepPublicCurrentBackfill(db,10_000_000);if(result==='complete')return;expect(result).toBe('progress');}throw Error('incomplete');}
it('bounds fanout by 40 tuples and approves exact coverage only',async()=>{await seed();expect(await publicCurrentProjectionReady(db)).toBe(false);await stepPublicCurrentBackfill(db,10_000_000);expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE}`).first()).toEqual({n:40});await finish();expect(await publicCurrentProjectionReady(db)).toBe(true);});
it('invalidates before failed reconstruction and retains charges',async()=>{await seed(2);await finish();const old=await readPublicCurrentBackfillStatus(db);await beginPublicCurrentBackfill(db);await expect(db.prepare('CREATE TABLE invalid (').run()).rejects.toThrow();expect(await publicCurrentProjectionReady(db)).toBe(false);expect((await readPublicCurrentBackfillStatus(db))?.reserved).toBe(old?.reserved);});
it('retains failed admission charges without cursor advancement',async()=>{await seed(2);const before=await readPublicCurrentBackfillStatus(db);const failed=new Proxy(db,{get(t,k){if(k==='batch')return async()=>{throw Error('BATCH_FAIL');};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});await expect(stepPublicCurrentBackfill(failed,80_000)).rejects.toThrow('BATCH_FAIL');expect(await readPublicCurrentBackfillStatus(db)).toEqual({...before,reserved:80_000});expect(await stepPublicCurrentBackfill(db,80_000)).toBe('denied');});
it('fails closed without sparse coverage or maintenance infrastructure',async()=>{await seed(2);await db.prepare('DELETE FROM runtime_state WHERE key=?').bind(PUBLIC_PROJECTION_CURSOR_KEY).run();expect(await stepPublicCurrentBackfill(db,10_000_000)).toBe('unavailable');await db.prepare('DROP TRIGGER public_current_catalog_agents_insert').run();expect(await stepPublicCurrentBackfill(db,10_000_000)).toBe('unavailable');});
it('does not approve corrupted rows',async()=>{await seed(2);await stepPublicCurrentBackfill(db,10_000_000);await stepPublicCurrentBackfill(db,10_000_000);await db.prepare(`UPDATE ${PUBLIC_CURRENT_TABLE} SET agent_name='bad'`).run();expect(await stepPublicCurrentBackfill(db,10_000_000)).toBe('mismatch');expect(await publicCurrentProjectionReady(db)).toBe(false);});
it('never admits two pages beyond the supplied allowance',async()=>{await seed();const results=await Promise.all([stepPublicCurrentBackfill(db,80_000),stepPublicCurrentBackfill(db,80_000)]);expect(results.filter(v=>v==='progress')).toHaveLength(1);expect((await readPublicCurrentBackfillStatus(db))?.reserved).toBe(80_000);expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE}`).first()).toEqual({n:40});});
it('keeps one page owner even with duplicate concurrent tokens',async()=>{
 await seed();let arrived=0;let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 const concurrent=new Proxy(db,{get(t,k){if(k==='batch')return async(statements:Parameters<NonNullable<D1Database['batch']>>[0])=>{if(++arrived===2)release();await barrier;return t.batch!(statements);};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
 expect((await Promise.all([stepPublicCurrentBackfill(concurrent,10_000_000,'same'),stepPublicCurrentBackfill(concurrent,10_000_000,'same')])).sort()).toEqual(['progress','raced']);
 expect((await readPublicCurrentBackfillStatus(db))?.reserved).toBe(160_000);expect((await readPublicCurrentBackfillStatus(db))?.state.revision).toBe(1);
});
it('cannot approve when infrastructure disappears immediately before verification',async()=>{
 await seed(2);await stepPublicCurrentBackfill(db,10_000_000);await stepPublicCurrentBackfill(db,10_000_000);
 const missing=new Proxy(db,{get(t,k){if(k==='batch')return async(statements:Parameters<NonNullable<D1Database['batch']>>[0])=>{await t.prepare('DROP TRIGGER public_current_catalog_agents_insert').run();return t.batch!(statements);};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
 expect(await stepPublicCurrentBackfill(missing,10_000_000)).toBe('mismatch');expect(await publicCurrentProjectionReady(db)).toBe(false);
});
it('rejects incomplete checkpoints instead of resetting charges',async()=>{
 await seed(2);await db.prepare('UPDATE runtime_state SET textValue=? WHERE key=?').bind('{"version":1,"phase":"complete"}',PUBLIC_CURRENT_BACKFILL_KEY).run();
 expect(await publicCurrentProjectionReady(db)).toBe(false);expect(await stepPublicCurrentBackfill(db,10_000_000)).toBe('unavailable');await expect(beginPublicCurrentBackfill(db)).rejects.toThrow('INVALID_PUBLIC_CURRENT_CHECKPOINT');
});
it('meters every page control and keeps public readiness a single key read',async()=>{
 await seed();const records:ReadRecord[]=[];await stepPublicCurrentBackfill(metered(db,records),10_000_000);
 const reads=records.reduce((sum,row)=>sum+row.rowsRead,0),writes=records.reduce((sum,row)=>sum+row.rowsWritten,0);
 expect(reads+1000*writes).toBeLessThanOrEqual(80_000);console.log('CURRENT_BACKFILL_PAGE',{reads,writes,queries:records.length});
 await finish();const gate:ReadRecord[]=[];expect(await publicCurrentProjectionReady(metered(db,gate))).toBe(true);expect(gate).toHaveLength(1);expect(gate[0]!.rowsRead).toBeLessThanOrEqual(1);expect(gate[0]!.rowsWritten).toBe(0);
});
it('rolls back rows and cursor together on an actual D1 batch failure',async()=>{
 await seed(2);const before=await readPublicCurrentBackfillStatus(db);
 await db.prepare(`CREATE TRIGGER test_public_current_fail BEFORE INSERT ON ${PUBLIC_CURRENT_TABLE} BEGIN SELECT RAISE(ABORT,'FAIL_WRITE');END`).run();
 await expect(stepPublicCurrentBackfill(db,10_000_000)).rejects.toThrow('FAIL_WRITE');
 expect(await readPublicCurrentBackfillStatus(db)).toEqual({...before,reserved:80_000});expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE}`).first()).toEqual({n:0});
 await db.prepare('DROP TRIGGER test_public_current_fail').run();await finish();
});
it('preserves updates behind the cursor and exact cross-network identity',async()=>{
 await seed();await stepPublicCurrentBackfill(db,10_000_000);
 await db.prepare("UPDATE catalog_agents SET name='Latest',chainId=56 WHERE agentKey='opaque'").run();
 await db.prepare("DELETE FROM catalog_agent_endpoints WHERE agentKey='opaque' AND endpointKey=?").bind('1'.padStart(64,'0')).run();await finish();
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE} WHERE agent_chainId=56 AND agent_name='Latest'`).first()).toEqual({n:99});
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE} WHERE agent_chainId=97`).first()).toEqual({n:0});
});
it('meters production backfill at observed cardinalities including every admission and infrastructure check',async()=>{
 // Counts only, not a replica of private production payloads. Source seeding
 // and its already-complete sparse prerequisite are outside migration work.
 await seedEndpointCardinalityFixture(db);
 await db.prepare('INSERT INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES(?,?,0,0)').bind(PUBLIC_PROJECTION_CURSOR_KEY,JSON.stringify({version:1,phase:'complete',agentKey:'',endpointScope:''})).run();
 const setup:ReadRecord[]=[];await beginPublicCurrentBackfill(metered(db,setup));
 await metered(db,setup).batch!(publicCurrentSchemaStatements.map(sql=>db.prepare(sql)));
 const records:ReadRecord[]=[];let calls=0,maxPageUnits=0;
 for(;;){const page:ReadRecord[]=[];const result=await stepPublicCurrentBackfill(metered(db,page),83_680_000);calls++;records.push(...page);
  const units=page.reduce((sum,row)=>sum+row.rowsRead+1000*row.rowsWritten,0);
  if(result==='complete')break;expect(result).toBe('progress');maxPageUnits=Math.max(maxPageUnits,units);expect(units).toBeLessThanOrEqual(80_000);if(calls>1100)throw Error('NO_PROGRESS');
 }
 const sum=(rows:ReadRecord[])=>({reads:rows.reduce((s,r)=>s+r.rowsRead,0),writes:rows.reduce((s,r)=>s+r.rowsWritten,0),queries:rows.length});
 expect(calls).toBe(1022);expect((await readPublicCurrentBackfillStatus(db))?.reserved).toBe(83_680_000);
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE}`).first()).toEqual({n:40767});
 console.log('PUBLIC_CURRENT_RELEASE_BACKFILL',JSON.stringify({calls,maxPageUnits,setup:sum(setup),steps:sum(records),total:sum([...setup,...records]),reserved:83_680_000}));
},180_000);
