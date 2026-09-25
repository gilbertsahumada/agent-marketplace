import type { D1Database, D1PreparedStatement, D1Result } from '../types';

/** Request-local accounting only. Never persists SQL, parameters or telemetry. */
export function measureD1Invocation(source: D1Database) {
  let queries = 0;
  let rowsRead = 0;
  let rowsWritten = 0;
  let complete = true;
  let unmeasuredQueries = 0;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const record = (result: unknown) => {
    const meta = (result as { meta?: { rows_read?: unknown; rows_written?: unknown } })?.meta;
    if (!meta || !Number.isSafeInteger(meta.rows_read) || Number(meta.rows_read) < 0
      || !Number.isSafeInteger(meta.rows_written) || Number(meta.rows_written) < 0) {
      complete = false;
      unmeasuredQueries++;
      return;
    }
    rowsRead += Number(meta.rows_read);
    rowsWritten += Number(meta.rows_written);
  };
  const execute = async <T>(call: () => Promise<D1Result<T>>) => {
    queries++;
    try { const result = await call(); record(result); return result; }
    catch (error) { complete = false; unmeasuredQueries++; throw error; }
  };
  const wrap = (inner: D1PreparedStatement): D1PreparedStatement => {
    const statement: D1PreparedStatement = {
      bind: (...values) => wrap(inner.bind(...values)),
      async first<T>() { return (await execute(() => inner.all<T>())).results?.[0] ?? null; },
      all: <T>() => execute(() => inner.all<T>()),
      run: () => execute(() => inner.run()),
      async raw<T extends unknown[]>(options?: { columnNames?: boolean }) {
        if (inner.raw) {
          // Native raw preserves duplicate columns and ordering, but its public
          // API exposes no D1 meta. Do not replay it or invent zero consumption.
          queries++;
          complete = false;
          unmeasuredQueries++;
          return inner.raw<T>(options);
        }
        const result = await execute(() => inner.all<Record<string, unknown>>());
        const rows = result.results ?? [];
        const values = rows.map(row => Object.values(row)) as T[];
        if (options?.columnNames && rows[0]) values.unshift(Object.keys(rows[0]) as T);
        return values;
      },
    };
    originals.set(statement, inner);
    return statement;
  };
  const db: D1Database = {
    prepare: query => wrap(source.prepare(query)),
    ...(source.batch ? { async batch<T>(statements: D1PreparedStatement[]) {
      const inner = statements.map(statement => {
        const original = originals.get(statement);
        if (!original) throw new Error('D1_METRICS_FOREIGN_STATEMENT');
        return original;
      });
      if (!inner.length) return [];
      queries += inner.length;
      try {
        const results = await source.batch!<T>(inner);
        results.forEach(record);
        if (results.length !== inner.length) { complete = false; unmeasuredQueries += Math.max(0, inner.length - results.length); }
        return results;
      } catch (error) { complete = false; unmeasuredQueries += inner.length; throw error; }
    } } : {}),
  };
  return { db, snapshot: () => ({ queries, rowsRead: complete ? rowsRead : null,
    rowsWritten: complete ? rowsWritten : null, complete,
    knownRowsRead: rowsRead, knownRowsWritten: rowsWritten, unmeasuredQueries }) };
}

export type InvocationCacheOutcome = 'hit' | 'miss' | 'bypass' | 'not_applicable';
export const invocationCache = new WeakMap<Request, InvocationCacheOutcome>();

/** Closed vocabulary: never emit URL paths containing IDs or query text. */
export function publicOperation(request: Request): { operation: string; chainId: 56 | 97 | null } | null {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const operations: Record<string, string> = {
    '/health': 'health', '/catalog-agents': 'catalog.results', '/catalog-facets': 'catalog.facets',
    '/catalog-summary': 'catalog.summary', '/catalog-agent': 'catalog.detail',
    '/observations': 'observations', '/commerce-jobs': 'jobs.results',
    '/commerce-activity': 'jobs.activity', '/commerce-summary': 'jobs.summary',
    '/job-agent-identities': 'jobs.identities', '/hire-events': 'jobs.events',
  };
  const jobDetail = /^\/commerce-jobs\/(56|97)\/\d+$/.exec(url.pathname);
  const operation = operations[url.pathname] ?? (jobDetail ? 'jobs.detail'
    : /^\/catalog-agent\/[1-9]\d*$/.test(url.pathname) ? 'catalog.detail' : null);
  if (!operation) return null;
  const chain = jobDetail?.[1] ?? url.searchParams.get(operation.startsWith('jobs.') ? 'chainId' : 'chain');
  return { operation, chainId: operation === 'health' || operation === 'observations' ? null
    : chain === '97' ? 97 : chain === null || chain === '56' ? 56 : null };
}
