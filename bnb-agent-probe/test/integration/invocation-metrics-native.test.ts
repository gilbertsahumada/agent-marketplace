import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { measureD1Invocation } from '../../src/db/invocation-metrics';

it.each([
  'SELECT 1 AS x, 2 AS x',
  'SELECT 1 AS "2", 2 AS "1"',
  'SELECT 1 AS x WHERE 0',
])('preserves native raw column order, duplicates and empty metadata: %s', async query => {
  for (const options of [undefined, { columnNames: true }]) {
    const meter = measureD1Invocation(env.DB);
    const reference = await env.DB.prepare(query).raw!(options);
    expect(await meter.db.prepare(query).raw!(options)).toEqual(reference);
    expect(meter.snapshot()).toMatchObject({ queries: 1, rowsRead: null, rowsWritten: null,
      knownRowsRead: 0, knownRowsWritten: 0, complete: false, unmeasuredQueries: 1 });
  }
});
