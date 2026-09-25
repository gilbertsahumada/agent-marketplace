import { describe, expect, it, vi } from 'vitest';
import { measureD1Invocation, publicOperation } from '../src/db/invocation-metrics';
import type { D1Database } from '../src/types';

function fixture(meta: unknown = { rows_read: 3, rows_written: 2 }) {
  const all = vi.fn(async () => ({ success: true, results: [{ value: 7 }], meta }));
  const statement = { bind: () => statement, all, run: all, first: async () => ({ value: 7 }) };
  const batch = vi.fn(async (statements: unknown[]) => statements.map(() => ({ success: true, results: [], meta })));
  return { db: { prepare: () => statement, batch } as unknown as D1Database, all, batch };
}

describe('per-invocation D1 metrics', () => {
  it('classifies network and operation without recording IDs or private query parameters', () => {
    expect(publicOperation(new Request('https://worker.test/commerce-jobs/97/123?buyer=private')))
      .toEqual({ operation: 'jobs.detail', chainId: 97 });
    expect(publicOperation(new Request('https://worker.test/job-agent-identities?chainId=97&jobIds=123')))
      .toEqual({ operation: 'jobs.identities', chainId: 97 });
    expect(publicOperation(new Request('https://worker.test/health'))).toEqual({ operation: 'health', chainId: null });
    expect(publicOperation(new Request('https://worker.test/private-path'))).toBeNull();
  });
  it('counts each physical first, raw, run and batch once without adding writes', async () => {
    const source = fixture();
    const meter = measureD1Invocation(source.db);
    expect(await meter.db.prepare('private SQL').first()).toEqual({ value: 7 });
    expect(await meter.db.prepare('private SQL').raw!()).toEqual([[7]]);
    await meter.db.prepare('private SQL').run();
    await meter.db.batch!([meter.db.prepare('private SQL'), meter.db.prepare('private SQL')]);
    expect(meter.snapshot()).toMatchObject({ queries: 5, rowsRead: 15, rowsWritten: 10, complete: true, unmeasuredQueries: 0 });
    expect(source.all).toHaveBeenCalledTimes(3);
    expect(source.batch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(meter.snapshot())).not.toContain('private SQL');
  });
  it('distinguishes absent metadata from zero consumption', async () => {
    const meter = measureD1Invocation(fixture({}).db);
    await meter.db.prepare('SELECT 1').all();
    expect(meter.snapshot()).toMatchObject({ queries: 1, rowsRead: null, rowsWritten: null, complete: false, unmeasuredQueries: 1 });
  });
  it('records failed calls as unknown and leaves an unused cache-hit meter at zero', async () => {
    const source = fixture();
    source.all.mockRejectedValueOnce(new Error('private error'));
    const meter = measureD1Invocation(source.db);
    expect(meter.snapshot()).toMatchObject({ queries: 0, rowsRead: 0, rowsWritten: 0, complete: true });
    await expect(meter.db.prepare('SELECT 1').all()).rejects.toThrow();
    expect(meter.snapshot()).toMatchObject({ queries: 1, rowsRead: null, rowsWritten: null, complete: false });
  });
});
