import type { D1Database, D1PreparedStatement, D1Result } from "../../src/types";

export interface ReadRecord { sql: string; rowsRead: number; rowsWritten: number; durationMs: number; values: unknown[] }

export function metered(db: D1Database, log: ReadRecord[]): D1Database {
  const record = (query: string, result: unknown, values: unknown[] = []): void => {
    const meta = (result as { meta?: { rows_read?: number; rows_written?: number; duration?: number } }).meta;
    log.push({ sql: query, rowsRead: meta?.rows_read ?? 0, rowsWritten: meta?.rows_written ?? 0, durationMs: meta?.duration ?? 0, values });
  };
  const wrap = (query: string, statement: D1PreparedStatement, values: unknown[] = []): D1PreparedStatement => ({
    bind: (...bound: unknown[]) => wrap(query, statement.bind(...bound), bound),
    async first<T = Record<string, unknown>>() {
      const result = await statement.all<T>();
      record(query, result, values);
      return result.results?.[0] ?? null;
    },
    async all<T = Record<string, unknown>>() {
      const result = await statement.all<T>();
      record(query, result, values);
      return result;
    },
    async run() {
      const result = await statement.run();
      record(query, result, values);
      return result;
    },
    ...(statement.raw ? {
      async raw<T extends unknown[]>(options?: { columnNames?: boolean }) {
        // raw() returns no meta: execute once through all() to read rows_read
        // and project the rows the way query-budget.ts does, so statements with
        // RETURNING clauses are never executed twice.
        const measured = await statement.all<Record<string, unknown>>();
        record(query, measured, values);
        const rows = measured.results ?? [];
        const projected = rows.map((row) => Object.values(row)) as T[];
        if (options?.columnNames && rows[0]) projected.unshift(Object.keys(rows[0]) as T);
        return projected;
      },
    } : {}),
    __query: query,
    __inner: statement,
  } as D1PreparedStatement & { __query: string; __inner: D1PreparedStatement });
  return {
    prepare: (query: string) => wrap(query, db.prepare(query)),
    ...(db.batch ? {
      async batch<T = unknown>(statements: D1PreparedStatement[]) {
        const results = await db.batch!<T>(statements.map((statement) => (statement as unknown as { __inner?: D1PreparedStatement }).__inner ?? statement));
        results.forEach((result: D1Result<T>, index) => record((statements[index] as unknown as { __query?: string }).__query ?? "batch", result));
        return results;
      },
    } : {}),
  };
}
