import { getTableColumns, type InferSelectModel, type SQLWrapper } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Database } from './orm';

/** Full single-table projections only. Named results retain D1 metadata;
 * schema decoders preserve the ORM's values without a second query. */
export function decodeTableRow<T extends SQLiteTable>(table: T, row: Record<string, unknown>): InferSelectModel<T> {
  return Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]) => {
    if (!Object.prototype.hasOwnProperty.call(row,column.name)) throw new Error('D1_INCOMPLETE_TABLE_PROJECTION');
    const value = row[column.name];
    return [key, value === null ? null : column.mapFromDriverValue(value)];
  })) as InferSelectModel<T>;
}

export async function measuredTableRead<T extends SQLiteTable>(
  db: Database, table: T, query: SQLWrapper,
): Promise<InferSelectModel<T>[]> {
  const rows = await db.all<Record<string, unknown>>(query.getSQL());
  return rows.map(row => decodeTableRow(table, row));
}

/** Flat primitive projections only: every expression must have a unique alias
 * matching its property key. No joins with duplicate names or custom decoders. */
export async function measuredFlatRead<Row>(db: Database, query: SQLWrapper & PromiseLike<Row[]>): Promise<Row[]> {
  return db.all<Row>(query.getSQL());
}
