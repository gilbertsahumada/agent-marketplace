import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import {enqueueCatalogDiscoveryPage,processNextCatalogIngestTask} from '../../src/phases/catalog-ingest';
import type {CatalogAgent} from '../../src/trust8004/types';
import type {D1Database} from '../../src/types';
import type {D1DatabaseLike} from '../../src/db/client';
import {PUBLIC_CURRENT_TABLE,publicCurrentSourceSql,publicCurrentTriggerStatements} from '../../src/catalog/public-current-projection-sql';
import {clearCatalogFixtures} from './catalog-fixtures';
import {metered,type ReadRecord} from './d1-meter';
import {deleteInsertTriggerReference} from '../fixtures/public-current-delete-insert-reference';
const db=env.DB as unknown as D1Database,ormDb=db as unknown as D1DatabaseLike,NOW=1_788_000_000_000;
function agent(declarations:number,version:number):CatalogAgent{return{chainId:56,agentId:'904',owner:`0x${'904'.padStart(40,'0')}`,metadataUri:`ipfs://metadata/904/${version}`,blockNumber:'1904',name:`Agent 904 v${version}`,description:null,imageUrl:null,registeredAt:NOW+904,metadataUpdatedAt:NOW+version,metadataAvailable:true,declarations:{a2a:false,erc8183:true},declaredEndpoints:[],indexEndpoints:Array.from({length:declarations},(_,index)=>({protocol:'erc8183_http',endpoint:`https://agent-904.example.com/${version}/commerce-${index}`,rawProtocol:'ERC-8183',source:'services',sourceIndex:index}))};}
it('quantifies the unchanged 94-write ingest gate and a local-only upsert proposal',async()=>{
 const reports:unknown[]=[];let reference:unknown;
 try{for(const mode of ['source','current','upsert'] as const){
  await db.batch!(publicCurrentTriggerStatements.filter(sql=>sql.startsWith('DROP')).map(sql=>db.prepare(sql)));await clearCatalogFixtures();await db.prepare(`DELETE FROM ${PUBLIC_CURRENT_TABLE}`).run();await db.prepare('DELETE FROM runtime_state').run();
  if(mode!=='source')await db.batch!((mode==='upsert'?publicCurrentTriggerStatements:deleteInsertTriggerReference).map(sql=>db.prepare(sql)));
  const original=agent(5,1);await enqueueCatalogDiscoveryPage(ormDb,[original],{nowMs:NOW,source:'header'});
  await processNextCatalogIngestTask(ormDb,{nowMs:NOW+1,maxDeclarations:4,fetchAgent:async()=>original,leaseOwner:'write-budget-test'});
  const records:ReadRecord[]=[];const replacement=agent(4,2);
  const progress=await processNextCatalogIngestTask(metered(db,records) as unknown as D1DatabaseLike,{nowMs:NOW+2,maxDeclarations:4,fetchAgent:async()=>replacement,leaseOwner:'write-budget-test'});
  expect(progress).toMatchObject({status:'retiring',declarationsProcessed:4,errorCode:null});
  const actual=(await db.prepare(publicCurrentSourceSql+' ORDER BY a.agentKey,d.endpointKey').raw!());
  if(mode==='source')reference=actual;else{expect(actual).toEqual(reference);expect(await db.prepare(`SELECT * FROM ${PUBLIC_CURRENT_TABLE} ORDER BY agent_agentKey,endpointKey`).raw!()).toEqual(actual);}
  const writes=records.reduce((n,r)=>n+r.rowsWritten,0),reads=records.reduce((n,r)=>n+r.rowsRead,0);
  reports.push({mode,reads,writes,operations:records.filter(r=>r.rowsWritten).map(r=>({sql:r.sql,reads:r.rowsRead,writes:r.rowsWritten}))});
  if(mode==='current')expect(writes).toBeGreaterThan(94);if(mode==='upsert')expect(writes).toBeLessThanOrEqual(94);
 }
 console.log('CURRENT_INGEST_WRITE_DIAGNOSTIC',JSON.stringify(reports));
 }finally{await db.batch!(publicCurrentTriggerStatements.map(sql=>db.prepare(sql)));}
});

it('checks the proposal key moves, deletion and point-access plan without modifying source SQL',async()=>{
 await clearCatalogFixtures();await db.prepare('DELETE FROM runtime_state').run();
 await db.batch!(publicCurrentTriggerStatements.map(sql=>db.prepare(sql)));
 try{
  const original=agent(2,1);await enqueueCatalogDiscoveryPage(ormDb,[original],{nowMs:NOW,source:'header'});
  await processNextCatalogIngestTask(ormDb,{nowMs:NOW+1,maxDeclarations:4,fetchAgent:async()=>original});
  const key='eip155:56:904';
  const parity=async()=>expect(await db.prepare(`SELECT * FROM ${PUBLIC_CURRENT_TABLE} ORDER BY agent_agentKey,endpointKey`).raw!()).toEqual(await db.prepare(publicCurrentSourceSql+' ORDER BY a.agentKey,d.endpointKey').raw!());
  await db.prepare('UPDATE catalog_agents SET chainId=97 WHERE agentKey=?').bind(key).run();await parity();
  expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE} WHERE agent_chainId=56`).first()).toEqual({n:0});
  await db.prepare('DELETE FROM catalog_seller_capabilities WHERE agentKey=?').bind(key).run();await parity();
  expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE} WHERE cap_state IS NOT NULL`).first()).toEqual({n:0});
  await db.prepare("UPDATE catalog_agent_endpoints SET declarationState='removed' WHERE agentKey=?").bind(key).run();await parity();
  expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE}`).first()).toEqual({n:0});
  await db.prepare("UPDATE catalog_agent_endpoints SET declarationState='current' WHERE agentKey=?").bind(key).run();await parity();
  const plan=(await db.prepare(`EXPLAIN QUERY PLAN DELETE FROM ${PUBLIC_CURRENT_TABLE} WHERE agent_chainId=? AND agent_agentKey=? AND endpointKey=? AND NOT EXISTS (SELECT 1 FROM catalog_agents a JOIN catalog_agent_endpoints d ON d.agentKey=a.agentKey WHERE a.chainId=${PUBLIC_CURRENT_TABLE}.agent_chainId AND a.agentKey=${PUBLIC_CURRENT_TABLE}.agent_agentKey AND d.endpointKey=${PUBLIC_CURRENT_TABLE}.endpointKey AND d.declarationState='current')`).bind(97,key,'example').all<{detail:string}>()).results!;
  expect(plan.some(row=>row.detail.includes('SEARCH catalog_public_current_endpoints USING PRIMARY KEY'))).toBe(true);
  expect(plan.some(row=>/SCAN (catalog_agents|catalog_agent_endpoints|catalog_public_current_endpoints)/.test(row.detail))).toBe(false);
  console.log('CURRENT_INGEST_UPSERT_DELETE_PLAN',JSON.stringify(plan));
  await db.prepare('DELETE FROM catalog_agents WHERE agentKey=?').bind(key).run();await parity();expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE}`).first()).toEqual({n:0});
 }finally{await db.batch!(publicCurrentTriggerStatements.map(sql=>db.prepare(sql)));}
});
