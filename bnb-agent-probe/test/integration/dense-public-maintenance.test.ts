import {env} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {D1Database} from '../../src/types';
import {clearCatalogFixtures} from './catalog-fixtures';
import {metered,type ReadRecord} from './d1-meter';
import {constructDensePrototype,classifyDensePrototype,has,PROTOTYPE_TABLE} from '../prototypes/dense-public-classification';
import {installDenseMaintenance,dropDenseMaintenance,refreshDenseAgents} from '../prototypes/dense-public-maintenance';

const db=env.DB as unknown as D1Database,NOW=1_800_000_000_000,KEY='a'.repeat(64);
beforeEach(async()=>{await dropDenseMaintenance(db);await clearCatalogFixtures();await constructDensePrototype(db);await installDenseMaintenance(db);});
async function agent(chain:56|97=56,id='1'){
 const key=`eip155:${chain}:${id}`;
 await db.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES(?,?,?,'Original','ok','current',0,0)").bind(key,id,chain).run();return key;
}
async function declare(key:string,endpoint=KEY){
 await db.prepare("INSERT OR IGNORE INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt) VALUES(?,'a2a','https://seller.example/a2a','origin','safe','operational','a2a','eligible',0)").bind(endpoint).run();
 await db.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt) VALUES(?,?,'current','v1',0,0)").bind(key,endpoint).run();
}
async function capable(key:string){
 await db.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,schemaHash,compatibilityCheckedAt,compatibilityExpiresAt,nextProbeAt,createdAt,updatedAt)
 VALUES(?,?,'a2a','discovered','compatible','schema',?,?,?,0,0)`).bind(key,KEY,NOW,NOW+86400_000,NOW+86400_000).run();
}
async function observe(key:string,at:number,outcome='protocol_valid'){
 return db.prepare(`INSERT INTO catalog_observations(agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel)
 VALUES(?,?,'a2a','worker_probe',?,?,?,1,'protocol','platform_observed')`).bind(key,KEY,outcome,at,at+86400_000).run();
}
async function rows(){return (await db.prepare(`SELECT * FROM ${PROTOTYPE_TABLE} ORDER BY agent_agentKey,endpointKey`).all<Record<string,unknown>>()).results??[];}

it('maintains new agents, current declarations, sentinels, and capability-only rows without observations',async()=>{
 const key=await agent();expect(await rows()).toMatchObject([{agent_agentKey:key,endpointKey:'',cap_state:null}]);
 await declare(key);await capable(key);expect(await rows()).toMatchObject([{endpointKey:KEY,cap_state:'discovered',evidence_latestPlatformOutcome:null}]);
 await db.prepare("UPDATE catalog_agent_endpoints SET declarationState='removed' WHERE agentKey=?").bind(key).run();
 expect(await rows()).toMatchObject([{endpointKey:'',cap_state:null}]);
 await db.prepare("UPDATE catalog_agent_endpoints SET declarationState='current' WHERE agentKey=?").bind(key).run();
 expect(await rows()).toMatchObject([{endpointKey:KEY,cap_compatibilityState:'compatible'}]);
 await db.prepare('DELETE FROM catalog_agents WHERE agentKey=?').bind(key).run();expect(await rows()).toEqual([]);
});

it('inherits canonical late-observation ordering and never mixes equal IDs across networks',async()=>{
 const main=await agent(),test=await agent(97);await declare(main);await declare(test);await capable(main);
 await observe(main,NOW);await observe(main,NOW-1000,'timeout');
 expect(await rows()).toMatchObject([{agent_agentKey:main,evidence_latestPlatformOutcome:'protocol_valid',evidence_latestPlatformObservedAt:NOW},{agent_agentKey:test,evidence_latestPlatformOutcome:null,cap_state:null}]);
 await observe(main,NOW+1,'timeout');expect((await rows())[0]).toMatchObject({evidence_latestPlatformOutcome:'timeout'});
});

it('uses live shared endpoint policy and suspension; classification performs zero writes',async()=>{
 const key=await agent();await declare(key);await capable(key);
 const classify=()=>classifyDensePrototype(db,NOW,56,true,'');
 expect(has((await classify())[0]!,'requestable')).toBe(true);
 const before=await rows();
 await db.prepare("UPDATE catalog_endpoints SET safety='unsafe',eligibility='unsafe' WHERE endpointKey=?").bind(KEY).run();
 expect(await rows()).toEqual(before);
 expect(has((await classify())[0]!,'requestable')).toBe(false);
 await db.prepare("UPDATE catalog_endpoints SET safety='safe',eligibility='eligible' WHERE endpointKey=?").bind(KEY).run();
 await db.prepare("UPDATE catalog_seller_capabilities SET state='suspended' WHERE agentKey=?").bind(key).run();
 expect(has((await classify())[0]!,'requestable')).toBe(false);
 const log:ReadRecord[]=[];await classifyDensePrototype(metered(db,log),NOW+86400_001,56,true,'');
 expect(log.reduce((n,row)=>n+row.rowsWritten,0)).toBe(0);
});

it('rolls back source and copied rows together and absolute backfill cannot replay an older snapshot',async()=>{
 const key=await agent();await declare(key);await capable(key);const before=await rows();
 await expect(db.batch!([
   db.prepare("UPDATE catalog_agents SET name='Must rollback' WHERE agentKey=?").bind(key),
   db.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,indexState,firstSeenAt,lastSeenAt) VALUES(?,'1',56,'current',0,0)").bind(key),
 ])).rejects.toThrow();expect(await rows()).toEqual(before);
 await Promise.all([
   refreshDenseAgents(db,[key]),
   db.prepare("UPDATE catalog_agents SET name='Latest' WHERE agentKey=?").bind(key).run(),
 ]);
 expect((await rows())[0]?.agent_name).toBe('Latest');
 await refreshDenseAgents(db,[key]);expect((await rows())[0]?.agent_name).toBe('Latest');
});

it('records per-operation trigger costs and complete historical construction separately',async()=>{
 const key=await agent();await declare(key);await capable(key);
 const changes:Record<string,ReadRecord[]>={agent:[],capability:[],observation:[],sharedEndpoint:[],backfill:[],construction:[]};
 await metered(db,changes.agent!).prepare("UPDATE catalog_agents SET name='Changed' WHERE agentKey=?").bind(key).run();
 await metered(db,changes.capability!).prepare("UPDATE catalog_seller_capabilities SET state='suspended' WHERE agentKey=?").bind(key).run();
 await metered(db,changes.observation!).prepare(`INSERT INTO catalog_observations(agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel) VALUES(?,?,'a2a','worker_probe','protocol_valid',?,?,1,'protocol','platform_observed')`).bind(key,KEY,NOW,NOW+86400_000).run();
 await metered(db,changes.sharedEndpoint!).prepare("UPDATE catalog_endpoints SET safety='unsafe' WHERE endpointKey=?").bind(KEY).run();
 const expected=await rows();await refreshDenseAgents(metered(db,changes.backfill!),[key]);expect(await rows()).toEqual(expected);
 await dropDenseMaintenance(db);await constructDensePrototype(metered(db,changes.construction!));expect(await rows()).toEqual(expected);
 const costs=Object.fromEntries(Object.entries(changes).map(([name,log])=>[name,{reads:log.reduce((n,r)=>n+r.rowsRead,0),writes:log.reduce((n,r)=>n+r.rowsWritten,0)}]));
 // Only DDL construction reads six extra sqlite_master objects from the pilot.
 expect(costs).toEqual({agent:{reads:7,writes:3},capability:{reads:10,writes:4},observation:{reads:37,writes:11},sharedEndpoint:{reads:1,writes:2},backfill:{reads:5,writes:2},construction:{reads:146,writes:3}});
});

it('does not rewrite public rows for scheduling or ingestion bookkeeping updates',async()=>{
 const key=await agent();await declare(key);await capable(key);
 await declare(key,'b'.repeat(64));
 const before=await rows();
 const statements=[
   'UPDATE catalog_agents SET lastSeenAt=123 WHERE agentKey=?',
   'UPDATE catalog_seller_capabilities SET nextProbeAt=123,updatedAt=123 WHERE agentKey=?',
   'UPDATE catalog_agent_endpoints SET lastSeenAt=123 WHERE agentKey=?',
 ];
 const guarded:ReadRecord[]=[];
 for(const statement of statements)await metered(db,guarded).prepare(statement).bind(key).run();
 expect(await rows()).toEqual(before);
 await dropDenseMaintenance(db);
 const unguarded:ReadRecord[]=[];
 for(const statement of statements)await metered(db,unguarded).prepare(statement).bind(key).run();
 expect(guarded.map(row=>row.rowsWritten)).toEqual(unguarded.map(row=>row.rowsWritten));
});

it('keeps null transitions and individual evidence removals visible with update guards',async()=>{
 const key=await agent();await declare(key);await capable(key);await observe(key,NOW);
 await db.prepare('UPDATE catalog_seller_capabilities SET schemaHash=NULL WHERE agentKey=?').bind(key).run();
 expect((await rows())[0]?.cap_schemaHash).toBeNull();
 await db.prepare("UPDATE catalog_seller_capabilities SET schemaHash='renewed' WHERE agentKey=?").bind(key).run();
 expect((await rows())[0]?.cap_schemaHash).toBe('renewed');
 await db.prepare('DELETE FROM catalog_seller_capabilities WHERE agentKey=?').bind(key).run();
 expect((await rows())[0]).toMatchObject({cap_state:null,evidence_latestPlatformOutcome:'protocol_valid'});
 await db.prepare('DELETE FROM catalog_public_endpoint_evidence WHERE agentKey=?').bind(key).run();
 expect((await rows())[0]).toMatchObject({endpointKey:KEY,evidence_latestPlatformOutcome:null});
});

it('retains the complete trigger set if an atomic reinstall fails',async()=>{
 const key=await agent();await declare(key);
 const definitions=()=>db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'prototype_dense_%' ORDER BY name").all();
 const before=await definitions();
 const failingDb:D1Database={
   prepare:sql=>db.prepare(sql),
   batch:statements=>db.batch!([...statements,db.prepare('INSERT INTO missing_dense_installation_table VALUES(1)')]),
 };
 await expect(installDenseMaintenance(failingDb)).rejects.toThrow();
 expect((await definitions()).results).toEqual(before.results);
 await db.prepare("UPDATE catalog_agents SET name='Still maintained' WHERE agentKey=?").bind(key).run();
 expect((await rows())[0]?.agent_name).toBe('Still maintained');
});

it.each([2000,20000])('measures raw construction for %i current endpoints separately from observation-history backfill',async count=>{
 await dropDenseMaintenance(db);
 await db.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
 INSERT INTO catalog_agents(agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt)
 SELECT 'eip155:'||CASE WHEN x%2=0 THEN 56 ELSE 97 END||':'||x,CAST(x AS TEXT),CASE WHEN x%2=0 THEN 56 ELSE 97 END,'Agent','ok','current',0,0 FROM n`).bind(count).run();
 await db.prepare(`INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt)
 SELECT agentKey,'a2a','https://seller.example/a2a','origin','safe','operational','a2a','eligible',0 FROM catalog_agents`).run();
 await db.prepare(`INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt)
 SELECT agentKey,agentKey,'current','v1',0,0 FROM catalog_agents`).run();
 await db.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,nextProbeAt,createdAt,updatedAt)
 SELECT agentKey,agentKey,'a2a','discovered','pending',0,0,0 FROM catalog_agents`).run();
 const log:ReadRecord[]=[];await constructDensePrototype(metered(db,log));
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${PROTOTYPE_TABLE}`).first()).toEqual({n:count});
 expect({count,reads:log.reduce((n,r)=>n+r.rowsRead,0),writes:log.reduce((n,r)=>n+r.rowsWritten,0)}).toEqual({count,reads:count*4+141,writes:count+2});
});
