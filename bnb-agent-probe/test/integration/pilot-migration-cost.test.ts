import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';

it('builds only empty pilot tables with bounded DDL cost and no historical backfill',async()=>{
  await env.DB.prepare('DROP TABLE catalog_pilot_discovery_work').run();
  await env.DB.prepare('DROP TABLE catalog_pilot_origin_schedule').run();
  const migration=env.TEST_MIGRATIONS.find(m=>m.name==='0038_catalog_pilot_discovery.sql')!;
  expect(migration).toBeDefined();
  let reads=0,writes=0;
  for(const query of migration.queries){
    const result=await env.DB.prepare(query).run();
    const meta=(result as unknown as {meta:{rows_read:number;rows_written:number}}).meta;
    expect(Number.isSafeInteger(meta.rows_read)&&Number.isSafeInteger(meta.rows_written)).toBe(true);
    reads+=meta.rows_read;writes+=meta.rows_written;
  }
  expect(reads+1000*writes).toBeLessThanOrEqual(100_000);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_pilot_discovery_work').first()).toEqual({n:0});
  console.log('PILOT_DDL_COST',JSON.stringify({reads,writes,queries:migration.queries.length,units:reads+1000*writes}));
});
