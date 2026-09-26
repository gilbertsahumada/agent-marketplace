import {env} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {D1Database} from '../../src/types';
import {clearCatalogFixtures} from './catalog-fixtures';
import {metered,type ReadRecord} from './d1-meter';
import {has} from '../prototypes/dense-public-classification';
import {ENDPOINT_ONLY_TABLE,constructEndpointOnlyPrototype,classifyEndpointOnlyPrototype} from '../prototypes/endpoint-only-public-prototype';
import {dropEndpointOnlyMaintenance,installEndpointOnlyMaintenance,endpointOnlySourceSql} from '../prototypes/endpoint-only-maintenance';
const db=env.DB as unknown as D1Database,NOW=1_800_000_000_000,A='a'.repeat(64),B='b'.repeat(64);
beforeEach(async()=>{await dropEndpointOnlyMaintenance(db);await clearCatalogFixtures();await constructEndpointOnlyPrototype(db);await installEndpointOnlyMaintenance(db);});
async function agent(chain=56,id='1'){const key=`eip155:${chain}:${id}`;await db.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES(?,?,?,'Agent','ok','current',0,0)").bind(key,id,chain).run();return key;}
async function declare(key:string,endpoint=A){
 await db.prepare("INSERT OR IGNORE INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt) VALUES(?,'a2a','https://seller.example/a2a','origin','safe','operational','a2a','eligible',0)").bind(endpoint).run();
 await db.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt) VALUES(?,?,'current','v1',0,0)").bind(key,endpoint).run();
}
async function capable(key:string,endpoint=A){await db.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,schemaHash,compatibilityCheckedAt,compatibilityExpiresAt,nextProbeAt,createdAt,updatedAt) VALUES(?,?,'a2a','discovered','compatible','schema',?,?,?,0,0)`).bind(key,endpoint,NOW,NOW+86400_000,NOW+86400_000).run();}
async function rows(){return(await db.prepare(`SELECT * FROM ${ENDPOINT_ONLY_TABLE} ORDER BY agent_agentKey,endpointKey`).all<Record<string,unknown>>()).results!;}
async function parity(){const expected=(await db.prepare(`${endpointOnlySourceSql()} ORDER BY a.agentKey,d.endpointKey`).raw!()).slice();const actual=(await db.prepare(`SELECT * FROM ${ENDPOINT_ONLY_TABLE} ORDER BY agent_agentKey,endpointKey`).raw!()).slice();expect(actual).toEqual(expected);}
const measure=(log:ReadRecord[])=>({reads:log.reduce((n,r)=>n+r.rowsRead,0),writes:log.reduce((n,r)=>n+r.rowsWritten,0)});

it('stores only current declarations; deleting the last one removes the physical row but not Registry identity',async()=>{
 const key=await agent();expect(await rows()).toEqual([]);
 expect((await classifyEndpointOnlyPrototype(db,NOW,56,true,'','registry')).map(row=>row.agentKey)).toEqual([key]);
 await declare(key);await capable(key);expect(await rows()).toHaveLength(1);await parity();
 await db.prepare("UPDATE catalog_agent_endpoints SET declarationState='removed' WHERE agentKey=?").bind(key).run();expect(await rows()).toEqual([]);
 expect(await classifyEndpointOnlyPrototype(db,NOW,56,true,'','operational')).toEqual([]);
 expect((await classifyEndpointOnlyPrototype(db,NOW,56,true,'','registry'))).toHaveLength(1);
 await db.prepare("UPDATE catalog_agent_endpoints SET declarationState='current' WHERE agentKey=?").bind(key).run();expect(await rows()).toHaveLength(1);await parity();
 await db.prepare('DELETE FROM catalog_agent_endpoints WHERE agentKey=?').bind(key).run();expect(await rows()).toEqual([]);
});

it('updates only the changed pair, handles multiple endpoints and key changes, and isolates equal IDs across chains',async()=>{
 const main=await agent(),test=await agent(97);await declare(main,A);await declare(main,B);await declare(test,A);await capable(main,A);
 const untouched=(await rows()).find(row=>row.agent_agentKey===test)!;
 await db.prepare('UPDATE catalog_seller_capabilities SET endpointKey=? WHERE agentKey=?').bind(B,main).run();await parity();
 expect((await rows()).find(row=>row.agent_agentKey===test)).toEqual(untouched);
 await db.prepare('UPDATE catalog_agent_endpoints SET agentKey=? WHERE agentKey=? AND endpointKey=?').bind(test,main,B).run();await parity();
 expect((await rows()).filter(row=>row.agent_agentKey===main)).toHaveLength(1);
 await db.prepare('DELETE FROM catalog_agents WHERE agentKey=?').bind(main).run();await parity();expect((await rows()).every(row=>row.agent_agentKey===test)).toBe(true);
});

it('moves the physical network key on agent chain changes and removes it using the old chain on deletion',async()=>{
 const key=await agent(),untouched=await agent(97,'2');await declare(key,A);await declare(key,B);await capable(key);await declare(untouched,A);
 const other=(await rows()).find(row=>row.agent_agentKey===untouched);
 await db.prepare('UPDATE catalog_agents SET chainId=97 WHERE agentKey=?').bind(key).run();await parity();
 expect((await rows()).filter(row=>row.agent_agentKey===key).map(row=>row.agent_chainId)).toEqual([97,97]);
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE} WHERE agent_chainId=56 AND agent_agentKey=?`).bind(key).first()).toEqual({n:0});
 expect((await rows()).find(row=>row.agent_agentKey===untouched)).toEqual(other);
 await db.prepare('UPDATE catalog_agents SET chainId=56 WHERE agentKey=?').bind(key).run();await parity();
 expect((await rows()).filter(row=>row.agent_agentKey===key).map(row=>row.agent_chainId)).toEqual([56,56]);
 await db.prepare('DELETE FROM catalog_agents WHERE agentKey=?').bind(key).run();await parity();
 expect((await rows()).map(row=>row.agent_agentKey)).toEqual([untouched]);
});

it('copies null transitions and canonical late evidence, not stale new arrivals',async()=>{
 const key=await agent();await declare(key);await capable(key);
 await db.prepare('UPDATE catalog_seller_capabilities SET schemaHash=NULL,compatibilityExpiresAt=NULL WHERE agentKey=?').bind(key).run();await parity();expect((await rows())[0]?.cap_schemaHash).toBeNull();
 await db.prepare("UPDATE catalog_seller_capabilities SET schemaHash='new',compatibilityExpiresAt=? WHERE agentKey=?").bind(NOW+1000,key).run();await parity();
 for(const [at,outcome] of [[NOW,'protocol_valid'],[NOW-1000,'timeout']] as const)await db.prepare(`INSERT INTO catalog_observations(agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel) VALUES(?,?,'a2a','worker_probe',?,?,?,1,'protocol','platform_observed')`).bind(key,A,outcome,at,at+86400_000).run();
 await parity();expect((await rows())[0]?.evidence_latestPlatformOutcome).toBe('protocol_valid');
});

it('joins shared endpoint blocks live without fanout and classification writes nothing',async()=>{
 const main=await agent(),test=await agent(97);await declare(main);await declare(test);await capable(main);await capable(test);const before=await rows();
 expect(has((await classifyEndpointOnlyPrototype(db,NOW,56,true,''))[0]!,'requestable')).toBe(true);
 await db.prepare("UPDATE catalog_endpoints SET safety='unsafe',eligibility='unsafe' WHERE endpointKey=?").bind(A).run();expect(await rows()).toEqual(before);
 const log:ReadRecord[]=[];for(const chain of [56,97] as const){const result=await classifyEndpointOnlyPrototype(metered(db,log),NOW,chain,true,'','registry');expect(has(result[0]!,'requestable')).toBe(false);}
 expect(measure(log).writes).toBe(0);
});

it('does not rewrite copied rows for scheduling, timestamps or unchanged public fields',async()=>{
 const key=await agent();await declare(key);await capable(key);const before=await rows(),log:ReadRecord[]=[];
 await metered(db,log).prepare('UPDATE catalog_agents SET lastSeenAt=1,name=name WHERE agentKey=?').bind(key).run();
 await metered(db,log).prepare('UPDATE catalog_agent_endpoints SET lastSeenAt=1 WHERE agentKey=?').bind(key).run();
 await metered(db,log).prepare('UPDATE catalog_seller_capabilities SET updatedAt=1,nextProbeAt=2,state=state WHERE agentKey=?').bind(key).run();
 expect(await rows()).toEqual(before);expect(log.map(row=>row.rowsWritten)).toEqual([1,1,4]);
});

it('reinstalls atomically and keeps source and projection rolled back together',async()=>{
 const key=await agent();await declare(key);const before=await rows();
 await expect(db.batch!([db.prepare("UPDATE catalog_agents SET name='Rollback' WHERE agentKey=?").bind(key),db.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,indexState,firstSeenAt,lastSeenAt) VALUES(?,'1',56,'current',0,0)").bind(key)])).rejects.toThrow();expect(await rows()).toEqual(before);
 const failing={...db,prepare:(sql:string)=>db.prepare(sql.startsWith('CREATE TRIGGER prototype_endpoint_catalog_public_endpoint_evidence_delete')?sql+' INVALID':sql),batch:db.batch!.bind(db)} as D1Database;
 await expect(installEndpointOnlyMaintenance(failing)).rejects.toThrow();
 expect(await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'prototype_endpoint_%'").first()).toEqual({n:12});
 await db.prepare("UPDATE catalog_agents SET name='Kept' WHERE agentKey=?").bind(key).run();await parity();expect((await rows())[0]?.agent_name).toBe('Kept');
});

it('captures physical source-operation costs with endpoint-only maintenance',async()=>{
 const key=await agent();await declare(key);await capable(key);const logs:Record<string,ReadRecord[]>={agent:[],capability:[],declaration:[],endpoint:[],observation:[]};
 await metered(db,logs.agent!).prepare("UPDATE catalog_agents SET name='Change' WHERE agentKey=?").bind(key).run();
 await metered(db,logs.capability!).prepare("UPDATE catalog_seller_capabilities SET state='suspended' WHERE agentKey=?").bind(key).run();
 await metered(db,logs.observation!).prepare(`INSERT INTO catalog_observations(agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel) VALUES(?,?,'a2a','worker_probe','protocol_valid',?,?,1,'protocol','platform_observed')`).bind(key,A,NOW,NOW+86400_000).run();
 await metered(db,logs.endpoint!).prepare("UPDATE catalog_endpoints SET eligibility='unsafe',safety='unsafe' WHERE endpointKey=?").bind(A).run();
 await metered(db,logs.declaration!).prepare("UPDATE catalog_agent_endpoints SET declarationState='removed' WHERE agentKey=?").bind(key).run();
 // Chain lookup trades a few point reads on mutations for bounded per-network reads;
 // it adds no index or writes. Whole-day gates measure this cost as well.
 expect(Object.fromEntries(Object.entries(logs).map(([name,log])=>[name,measure(log)]))).toEqual({agent:{reads:7,writes:3},capability:{reads:14,writes:4},declaration:{reads:11,writes:4},endpoint:{reads:2,writes:4},observation:{reads:38,writes:11}});
});
