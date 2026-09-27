import {env} from 'cloudflare:workers';
import {getTableConfig} from 'drizzle-orm/sqlite-core';
import {schema} from '../../src/db/schema';
import {PUBLIC_CURRENT_TABLE,publicCurrentCreateTableSql,publicCurrentSchemaStatements,publicCurrentTriggerStatements} from '../../src/catalog/public-current-projection-sql';
import {clearCatalogFixtures} from './catalog-fixtures';

const db=env.DB, key='eip155:56:700',endpoint='a'.repeat(64);
const normalized=(sql:string)=>sql.replace(/\bIF NOT EXISTS\s+/gi,'').replace(/\s+/g,' ').trim().replace(/;$/,'');
const migration=()=>env.TEST_MIGRATIONS.find(item=>item.name==='0037_catalog_public_current_endpoints.sql');
async function dropCurrent(){
 await db.batch!(publicCurrentTriggerStatements.filter(sql=>sql.startsWith('DROP')).map(sql=>db.prepare(sql)));
 await db.prepare(`DROP TABLE IF EXISTS ${PUBLIC_CURRENT_TABLE}`).run();
}
async function seed(){
 await db.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES(?,'700',56,'Agent','ok','current',0,0)").bind(key).run();
 await db.prepare("INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt) VALUES(?,'a2a','https://seller.example/a2a','origin','safe','operational','a2a','eligible',0)").bind(endpoint).run();
 await db.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt) VALUES(?,?,'current','v1',0,0)").bind(key,endpoint).run();
}
beforeEach(async()=>{await clearCatalogFixtures();});

it('fresh migrated schema matches the generator and declared column types and network-first primary key',async()=>{
 expect(migration()).toBeDefined();
 const table=await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").bind(PUBLIC_CURRENT_TABLE).first<{sql:string}>();
 expect(normalized(table!.sql)).toBe(normalized(publicCurrentCreateTableSql));
 expect(table!.sql).toMatch(/WITHOUT ROWID/i);
 const declared=(schema as unknown as Record<string,Parameters<typeof getTableConfig>[0]>).catalogPublicCurrentEndpoints;
 expect(declared).toBeDefined();const config=getTableConfig(declared!);
 const actual=(await db.prepare(`PRAGMA table_info(${PUBLIC_CURRENT_TABLE})`).all<{name:string;type:string;notnull:number;pk:number}>()).results!;
 expect(actual.map(c=>({name:c.name,type:c.type,notnull:c.notnull}))).toEqual(config.columns.map(c=>({name:c.name,type:c.getSQLType().toUpperCase(),notnull:Number(c.notNull)})));
 expect(actual.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name)).toEqual(['agent_chainId','agent_agentKey','endpointKey']);
 expect(config.primaryKeys[0]!.columns.map(c=>c.name)).toEqual(['agent_chainId','agent_agentKey','endpointKey']);
 expect(config.indexes).toHaveLength(0);
 expect((await db.prepare(`PRAGMA index_list(${PUBLIC_CURRENT_TABLE})`).all<{origin:string}>()).results!.every(row=>row.origin==='pk')).toBe(true);
});

it('installs exactly the generated triggers and does not mark coverage approved',async()=>{
 const before=(await db.prepare('SELECT * FROM runtime_state ORDER BY key').all()).results;
 const actual=(await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'public_current_%' ORDER BY name").all<{sql:string}>()).results!.map(row=>normalized(row.sql)).sort();
 expect(actual).toEqual(publicCurrentTriggerStatements.filter(sql=>sql.startsWith('CREATE')).map(normalized).sort());
 await seed();expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE}`).first()).toEqual({n:1});
 expect((await db.prepare('SELECT * FROM runtime_state ORDER BY key').all()).results).toEqual(before);
});

it('upgrades a populated 0036 schema additively without backfilling or changing coverage',async()=>{
 expect(migration()).toBeDefined();await dropCurrent();await seed();
 const state=(await db.prepare('SELECT * FROM runtime_state ORDER BY key').all()).results;
 const source=await db.prepare('SELECT * FROM catalog_agents WHERE agentKey=?').bind(key).first();
 await db.batch!(migration()!.queries.map(sql=>db.prepare(sql)));
 expect(await db.prepare(`SELECT COUNT(*) n FROM ${PUBLIC_CURRENT_TABLE}`).first()).toEqual({n:0});
 expect(await db.prepare('SELECT * FROM catalog_agents WHERE agentKey=?').bind(key).first()).toEqual(source);
 expect((await db.prepare('SELECT * FROM runtime_state ORDER BY key').all()).results).toEqual(state);
 await db.prepare("UPDATE catalog_agents SET name='Updated' WHERE agentKey=?").bind(key).run();
 expect(await db.prepare(`SELECT agent_name FROM ${PUBLIC_CURRENT_TABLE}`).first()).toEqual({agent_name:'Updated'});
});

it('rolls back a failed DDL batch instead of leaving a partially installed projection',async()=>{
 await dropCurrent();
 await expect(db.batch!([...publicCurrentSchemaStatements.map(sql=>db.prepare(sql)),db.prepare('INSERT INTO nonexistent_projection_migration_target VALUES(1)')])).rejects.toThrow();
 expect(await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name=? OR name LIKE 'public_current_%'").bind(PUBLIC_CURRENT_TABLE).first()).toEqual({n:0});
 await db.batch!(migration()!.queries.map(sql=>db.prepare(sql)));
});

it('keeps source and projected updates in the same transaction',async()=>{
 await seed();
 await expect(db.batch!([db.prepare("UPDATE catalog_agents SET name='Rollback' WHERE agentKey=?").bind(key),db.prepare('INSERT INTO nonexistent_projection_migration_target VALUES(1)')])).rejects.toThrow();
 expect(await db.prepare('SELECT name FROM catalog_agents WHERE agentKey=?').bind(key).first()).toEqual({name:'Agent'});
 expect(await db.prepare(`SELECT agent_name FROM ${PUBLIC_CURRENT_TABLE}`).first()).toEqual({agent_name:'Agent'});
});
