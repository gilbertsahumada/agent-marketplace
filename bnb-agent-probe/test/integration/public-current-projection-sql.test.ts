import { env } from 'cloudflare:workers';
import { beforeEach, expect, it } from 'vitest';
import type { D1Database } from '../../src/types';
import { clearCatalogFixtures } from './catalog-fixtures';
import { metered, type ReadRecord } from './d1-meter';
import {
  PUBLIC_CURRENT_TABLE, publicCurrentColumns, publicCurrentSchemaStatements,
  publicCurrentSourceSql, publicCurrentUpsertPageSql, publicCurrentDeletePageSql,
} from '../../src/catalog/public-current-projection-sql';

const db = env.DB as unknown as D1Database;
const A = 'a'.repeat(64), B = 'b'.repeat(64), NOW = 1_800_000_000_000;
beforeEach(async () => {
  await clearCatalogFixtures();
  await db.batch!(publicCurrentSchemaStatements.map(sql => db.prepare(sql)));
  await db.prepare(`DELETE FROM ${PUBLIC_CURRENT_TABLE}`).run();
});
async function agent(chain = 56, id = '1', key = `eip155:${chain}:${id}`) {
  await db.prepare(`INSERT INTO catalog_agents(agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt)
    VALUES(?,?,?,'Name','ok','current',0,0)`).bind(key,id,chain).run();
  return key;
}
async function declare(key: string, endpoint = A) {
  await db.prepare(`INSERT OR IGNORE INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt)
    VALUES(?,'a2a','https://example.invalid/a2a','origin','safe','operational','a2a','eligible',0)`).bind(endpoint).run();
  await db.prepare(`INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt)
    VALUES(?,?,'current','v1',0,0)`).bind(key,endpoint).run();
}
async function capable(key: string) {
  await db.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,schemaHash,compatibilityCheckedAt,compatibilityExpiresAt,nextProbeAt,createdAt,updatedAt,lastAttemptId)
    VALUES(?,?,'a2a','discovered','compatible','hash',?,?,?,0,0,'00123')`).bind(key,A,NOW,NOW+1000,NOW+1000).run();
}
async function rows() { return (await db.prepare(`SELECT * FROM ${PUBLIC_CURRENT_TABLE} ORDER BY agent_agentKey,endpointKey`).all<Record<string,unknown>>()).results!; }
async function parity() {
  expect(await db.prepare(`SELECT ${publicCurrentColumns.join(',')} FROM ${PUBLIC_CURRENT_TABLE} ORDER BY agent_agentKey,endpointKey`).raw!())
    .toEqual(await db.prepare(`${publicCurrentSourceSql} ORDER BY a.agentKey,d.endpointKey`).raw!());
}

it('stores current endpoints, never missing sentinels; preserves raw values and null transitions', async () => {
  const key = await agent(); expect(await rows()).toEqual([]);
  await declare(key); await capable(key); await parity();
  expect((await rows())[0]?.cap_lastAttemptId).toBe('00123');
  await db.prepare('UPDATE catalog_agents SET name=NULL,categoriesJson=? WHERE agentKey=?').bind('{"unusual":"raw"}',key).run();
  await db.prepare('UPDATE catalog_seller_capabilities SET schemaHash=NULL,compatibilityExpiresAt=NULL WHERE agentKey=?').bind(key).run();
  await parity(); expect((await rows())[0]?.agent_name).toBeNull();
  await db.prepare("UPDATE catalog_agent_endpoints SET declarationState='removed' WHERE agentKey=?").bind(key).run();
  expect(await rows()).toEqual([]);
  await db.prepare("UPDATE catalog_agent_endpoints SET declarationState='current' WHERE agentKey=?").bind(key).run();
  await parity(); expect(await rows()).toHaveLength(1);
});

it('isolates equal IDs and exact old/new endpoint and chain keys, including noncanonical agent keys', async () => {
  const main = await agent(56,'1',"legacy:'unparsed-key"), test = await agent(97);
  await declare(main); await declare(main,B); await declare(test); await capable(main);
  await db.prepare('UPDATE catalog_seller_capabilities SET endpointKey=? WHERE agentKey=?').bind(B,main).run(); await parity();
  await db.prepare('UPDATE catalog_agent_endpoints SET agentKey=? WHERE agentKey=? AND endpointKey=?').bind(test,main,B).run(); await parity();
  await db.prepare("UPDATE catalog_agents SET chainId=97,agentId='2' WHERE agentKey=?").bind(main).run(); await parity();
  expect((await rows()).find(row => row.agent_agentKey === main)?.agent_chainId).toBe(97);
  await db.prepare('DELETE FROM catalog_agents WHERE agentKey=?').bind(main).run(); await parity();
  expect((await rows()).every(row => row.agent_agentKey === test)).toBe(true);
  await db.prepare('DELETE FROM catalog_agent_endpoints WHERE agentKey=? AND endpointKey=?').bind(test,B).run();
  await parity(); expect(await rows()).toHaveLength(1);
});

it('uses old agent key on key changes and rolls source/projection back together', async () => {
  const key = await agent(); await declare(key);
  await db.prepare("UPDATE catalog_agents SET agentKey='legacy-new' WHERE agentKey=?").bind(key).run();
  await parity(); expect(await rows()).toEqual([]);
  await db.prepare("UPDATE catalog_agent_endpoints SET agentKey='legacy-new' WHERE agentKey=?").bind(key).run(); await parity();
  const before = await rows();
  await expect(db.batch!([
    db.prepare("UPDATE catalog_agents SET name='Rolled back' WHERE agentKey='legacy-new'"),
    db.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,indexState,firstSeenAt,lastSeenAt) VALUES('legacy-new','1',56,'current',0,0)"),
  ])).rejects.toThrow(); expect(await rows()).toEqual(before);
});

it('propagates source evidence updates, ignores late evidence and rejects unsupported projection versions', async () => {
  const key = await agent(); await declare(key);
  for (const [at,outcome] of [[NOW,'protocol_valid'],[NOW-1000,'timeout']] as const) {
    await db.prepare(`INSERT INTO catalog_observations(agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel)
      VALUES(?,?,'a2a','worker_probe',?,?,?,1,'protocol','platform_observed')`).bind(key,A,outcome,at,at+1000).run();
  }
  await parity(); expect((await rows())[0]?.evidence_latestPlatformOutcome).toBe('protocol_valid');
  await expect(db.prepare('UPDATE catalog_public_endpoint_evidence SET projectionVersion=2 WHERE agentKey=?').bind(key).run()).rejects.toThrow();
  await parity();
  await db.prepare('UPDATE catalog_public_endpoint_evidence SET latestPlatformOutcome=NULL WHERE agentKey=?').bind(key).run();
  await parity(); expect((await rows())[0]?.evidence_latestPlatformOutcome).toBeNull();
  await db.prepare('DELETE FROM catalog_public_endpoint_evidence WHERE agentKey=?').bind(key).run(); await parity();
});

it('provides bound idempotent page upserts, no SQL interpretation of names, and no shared-policy fanout', async () => {
  const key = await agent(); await declare(key); await capable(key);
  const name = "name'; DELETE FROM catalog_agents; --";
  await db.prepare('UPDATE catalog_agents SET name=? WHERE agentKey=?').bind(name,key).run();
  await db.prepare(publicCurrentDeletePageSql).bind(JSON.stringify([[56,key,A]])).run(); expect(await rows()).toEqual([]);
  for (let i=0;i<2;i++) await db.prepare(publicCurrentUpsertPageSql).bind(JSON.stringify([[56,key,A]])).run();
  await parity(); expect((await rows())[0]?.agent_name).toBe(name);
  const before = await rows();
  await db.prepare("UPDATE catalog_endpoints SET eligibility='unsafe',safety='unsafe' WHERE endpointKey=?").bind(A).run();
  expect(await rows()).toEqual(before);
});

it('caps a page at forty endpoint tuples despite one-agent fanout and isolates network tuples', async () => {
  const key = await agent(), other = await agent(97);
  const endpoints = Array.from({length:100},(_,i) => i.toString(16).padStart(64,'0'));
  for (const endpoint of endpoints) await declare(key,endpoint);
  await declare(other,endpoints[0]!);
  await db.prepare(`DELETE FROM ${PUBLIC_CURRENT_TABLE}`).run();
  const tuples = JSON.stringify(endpoints.map(endpoint => [56,key,endpoint]));
  const plan = await db.prepare(`EXPLAIN QUERY PLAN ${publicCurrentUpsertPageSql}`).bind(tuples).all<{detail:string}>();
  expect(plan.results?.some(row => /SEARCH d USING/.test(row.detail))).toBe(true);
  expect(plan.results?.some(row => /SCAN d(?: |$)/.test(row.detail))).toBe(false);
  await db.prepare(publicCurrentUpsertPageSql).bind(tuples).run();
  expect(await rows()).toHaveLength(40);
  await db.prepare(publicCurrentUpsertPageSql).bind(JSON.stringify([[97,other,endpoints[0]]])).run();
  expect(await rows()).toHaveLength(41);
  await db.prepare(publicCurrentDeletePageSql).bind(JSON.stringify([[56,other,endpoints[0]]])).run();
  expect(await rows()).toHaveLength(41);
  await db.prepare(publicCurrentDeletePageSql).bind(JSON.stringify(endpoints.map(endpoint => [56,key,endpoint]))).run();
  expect((await rows()).map(row => row.agent_agentKey)).toEqual([other]);
});

it('uses the network-leading primary key and performs zero writes during reads', async () => {
  for (const chain of [56,97]) { const key=await agent(chain); await declare(key); }
  const query = `SELECT * FROM ${PUBLIC_CURRENT_TABLE} WHERE agent_chainId=?`;
  const plan = await db.prepare(`EXPLAIN QUERY PLAN ${query}`).bind(97).all<{detail:string}>();
  expect(plan.results?.some(row => row.detail.includes('SEARCH') && row.detail.includes('PRIMARY KEY') && row.detail.includes('agent_chainId=?'))).toBe(true);
  const log: ReadRecord[]=[];
  const result = await metered(db,log).prepare(query).bind(97).all();
  expect(result.results).toHaveLength(1); expect(log.reduce((sum,row) => sum+row.rowsWritten,0)).toBe(0);
  const columns = (await db.prepare(`PRAGMA table_info(${PUBLIC_CURRENT_TABLE})`).all<{name:string;type:string;pk:number}>()).results!;
  expect(columns.filter(row => row.pk).map(row => [row.name,row.type,row.pk])).toEqual([
    ['agent_agentKey','TEXT',2],['agent_chainId','INTEGER',1],['endpointKey','TEXT',3],
  ]);
});
