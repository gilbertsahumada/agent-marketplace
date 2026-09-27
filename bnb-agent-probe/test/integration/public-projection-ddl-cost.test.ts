import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import {clearCatalogFixtures} from './catalog-fixtures';
import type {D1PreparedStatement} from '../../src/types';

// Isolate schema installation from history backfill and from the one additive
// history index. These are local admission measurements, not a billing promise.
for(const observations of [0,8_000]) it(`measures projection DDL separately from its history index (${observations} observations)`,async context=>{
 const db=env.DB;
 await clearCatalogFixtures();
 const migrations=env.TEST_MIGRATIONS.filter(m=>/^003[67]_/.test(m.name));
 expect(migrations).toHaveLength(2);
 for(const migration of migrations)for(const query of migration.queries){
  const trigger=query.match(/CREATE TRIGGER\s+(\w+)/i)?.[1];
  if(trigger)await db.prepare(`DROP TRIGGER IF EXISTS ${trigger}`).run();
 }
 await db.batch!([
  db.prepare('DROP TABLE IF EXISTS projection_cost_migrations'),
  db.prepare('DROP TABLE IF EXISTS catalog_public_current_endpoints'),
  db.prepare('DROP TABLE IF EXISTS catalog_public_endpoint_evidence'),
  db.prepare('DROP TABLE IF EXISTS catalog_public_agent_metrics'),
  db.prepare('DROP INDEX IF EXISTS idx_catalog_observations_public_tuple'),
  db.prepare("DELETE FROM runtime_state WHERE key='catalog_public_projection_backfill_v1'"),
 ]);
 if(observations)await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?)
 INSERT INTO catalog_observations(agentKey,endpointKey,protocol,source,outcome,observedAt,durationMs)
 SELECT 'eip155:56:'||x,NULL,'a2a','worker_probe','protocol_valid',x,0 FROM n`).bind(observations).run();

 const costs:{operation:string;reads:number;writes:number;units:number}[]=[];
 async function measured(operation:string,statement:D1PreparedStatement){
  const result=await statement.run();
  const meta=(result as unknown as {meta?:{rows_read?:number;rows_written?:number}}).meta;
  const reads=Number(meta?.rows_read),writes=Number(meta?.rows_written);
  expect(Number.isFinite(reads)&&Number.isFinite(writes)).toBe(true);
  costs.push({operation,reads,writes,units:reads+1000*writes});
 }
 for(const migration of migrations)for(const [index,query] of migration.queries.entries()){
  await measured(/CREATE INDEX idx_catalog_observations_public_tuple/i.test(query)?'history-index':`${migration.name}:${index}`,db.prepare(query));
 }
 // Reproduce Wrangler-style migration bookkeeping on a separate local ledger,
 // preserving the test runner's own ledger and avoiding any reapplication.
 await measured('ledger-create',db.prepare('CREATE TABLE projection_cost_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)'));
 for(const migration of migrations)await measured('ledger-insert',db.prepare('INSERT INTO projection_cost_migrations(name) VALUES(?)').bind(migration.name));
 await measured('schema-preflight',db.prepare("SELECT name,type FROM sqlite_master WHERE name IN ('catalog_public_current_endpoints','catalog_public_endpoint_evidence','catalog_public_agent_metrics','idx_catalog_observations_public_tuple')"));
 await measured('ledger-preflight',db.prepare('SELECT name FROM projection_cost_migrations ORDER BY id'));
 const index=costs.find(row=>row.operation==='history-index')!;
 const fixed=costs.filter(row=>row!==index).reduce((sum,row)=>({reads:sum.reads+row.reads,writes:sum.writes+row.writes,units:sum.units+row.units}),{reads:0,writes:0,units:0});
 expect(fixed.units).toBeLessThanOrEqual(250_000);
 expect(index.writes).toBeLessThanOrEqual(observations+10);
 // Admission estimate, not an optimization gate: allow three reads per source
 // row plus schema overhead (the observed build is about two reads per row).
 expect(index.reads).toBeLessThanOrEqual(observations*3+250);
 expect(await db.prepare('SELECT COUNT(*) n FROM catalog_public_endpoint_evidence').first()).toEqual({n:0});
 expect(await db.prepare('SELECT COUNT(*) n FROM catalog_public_current_endpoints').first()).toEqual({n:0});
 const report={observations,fixed,index,costs};
 (context.task.meta as Record<string,unknown>).projectionDdlCost=report;
 console.log('PROJECTION_DDL_COST',JSON.stringify(report));
});
