import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { healthResponse } from '../../src/routes/health';
import { loadConfig } from '../../src/config';
import { measureD1Invocation } from '../../src/db/invocation-metrics';
import { metered, type ReadRecord } from './d1-meter';
import type { D1Database } from '../../src/types';

const now = Date.UTC(2026, 8, 28);
it.each([336, 2000, 20000].flatMap(size => ['stale', 'fresh', 'absent'].map(stats => ({size, stats}))))(
  'bounds health reads with $size runtime rows and $stats statistics', async ({size, stats}) => {
    await env.DB.prepare('DELETE FROM runtime_state').run();
    await env.DB.prepare("INSERT INTO runtime_state VALUES ('last_header_summary', ?, NULL, ?)").bind(JSON.stringify({status:'ok'}), now).run();
    if (stats === 'stale') await env.DB.prepare('ANALYZE runtime_state').run();
    await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
      INSERT INTO runtime_state SELECT 'unrelated-'||x,NULL,x,? FROM n`).bind(size-1,now).run();
    if (stats === 'fresh') await env.DB.prepare('ANALYZE runtime_state').run();
    if (stats === 'absent') {
      await env.DB.prepare('ANALYZE runtime_state').run();
      await env.DB.prepare("DELETE FROM sqlite_stat1 WHERE tbl='runtime_state'").run();
      await env.DB.prepare('ANALYZE sqlite_schema').run();
    }
    const before = await env.DB.prepare('SELECT * FROM runtime_state ORDER BY key').all();
    const baseline: ReadRecord[] = [];
    const records: ReadRecord[] = [];
    // Frozen previous query, on the same fixture and clock; only the access hint is removed.
    const legacy = {prepare:(query:string)=>metered(env.DB as unknown as D1Database,baseline)
      .prepare(query.replace(/ INDEXED BY sqlite_autoindex_runtime_state_1/gi,''))};
    const reference = await healthResponse(legacy,loadConfig({}),now);
    const meter = measureD1Invocation(metered(env.DB as unknown as D1Database,records));
    const actual = await healthResponse(meter.db,loadConfig({}),now);
    expect(actual.status).toBe(200);
    expect(await actual.json()).toEqual(await reference.json());
    const totals = meter.snapshot();
    console.log(JSON.stringify({size,stats,before:baseline.map(r=>({reads:r.rowsRead,writes:r.rowsWritten})),after:totals,
      plan:(await env.DB.prepare('EXPLAIN QUERY PLAN '+records[0]!.sql).bind(...records[0]!.values).all()).results}));
    expect(totals).toMatchObject({queries:1,complete:true,rowsWritten:0});
    expect(totals.rowsRead).toBeLessThanOrEqual(100);
    expect(totals.rowsRead).toBe(17); // 16 requested keys plus the matching row.
    expect((await env.DB.prepare('EXPLAIN QUERY PLAN '+records[0]!.sql).bind(...records[0]!.values).all()).results)
      .toEqual(expect.arrayContaining([expect.objectContaining({detail:expect.stringContaining('SEARCH runtime_state USING INDEX sqlite_autoindex_runtime_state_1')})]));
    expect((await env.DB.prepare('SELECT * FROM runtime_state ORDER BY key').all()).results).toEqual(before.results);
  });

it('keeps all populated health keys bounded with stale statistics', async () => {
  await env.DB.prepare('DELETE FROM runtime_state').run();
  await env.DB.prepare("INSERT INTO runtime_state VALUES ('scheduler_lease',NULL,NULL,?)").bind(now).run();
  await env.DB.prepare('ANALYZE runtime_state').run();
  const keys=['sweep_offset','header_high_water','last_header_summary','last_sweep_summary','last_probe_summary',
    'last_scheduler_summary','next_scheduler_phase','sweep_round','commerce_cursor_56','commerce_cursor_97',
    'last_index_summary_56','last_index_summary_97','daily_budget_20260928','catalog_sweep_hour','catalog_capability_stats_v1'];
  for(const key of keys)await env.DB.prepare('INSERT INTO runtime_state VALUES (?,NULL,NULL,?)').bind(key,now).run();
  const meter=measureD1Invocation(env.DB);
  expect((await healthResponse(meter.db,loadConfig({}),now)).status).toBe(200);
  expect(meter.snapshot()).toMatchObject({queries:1,complete:true,rowsWritten:0});
  expect(meter.snapshot().rowsRead).toBeLessThanOrEqual(32);
});
