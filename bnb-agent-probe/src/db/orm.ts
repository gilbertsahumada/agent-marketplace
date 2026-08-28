import { count, eq, inArray } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { probeTargets, runtimeState, schema } from "./schema";
import type { D1Database } from "../types";

/**
 * Drizzle runtime layer over the D1 binding. Row types are derived from
 * src/db/schema.ts so a schema change breaks compilation here instead of
 * failing at runtime inside a hand-written SQL string. The scheduler lease in
 * lib/scheduler-lease.ts intentionally stays raw SQL: its
 * INSERT ... ON CONFLICT ... WHERE ... RETURNING contention semantics are the
 * one query whose exact SQL must be auditable at a glance.
 */
export type Database = DrizzleD1Database<typeof schema>;

export type ProbeTargetRow = typeof schema.probeTargets.$inferSelect;
export type ProbeObservationRow = typeof schema.probeObservations.$inferSelect;
export type FunnelSnapshotRow = typeof schema.funnelSnapshots.$inferSelect;
export type HireEventRow = typeof schema.hireEvents.$inferSelect;
export type RuntimeStateRow = typeof schema.runtimeState.$inferSelect;

export function createDatabase(d1: D1Database): Database {
  return drizzle(d1 as Parameters<typeof drizzle>[0], { schema });
}

export async function readRuntimeState(
  db: Database,
  key: string,
): Promise<RuntimeStateRow | null> {
  assertRuntimeStateKey(key);

  const rows = await db
    .select()
    .from(runtimeState)
    .where(eq(runtimeState.key, key))
    .limit(1);
  return rows[0] ?? null;
}

export async function readRuntimeStates(
  db: Database,
  keys: readonly string[],
): Promise<RuntimeStateRow[]> {
  for (const key of keys) assertRuntimeStateKey(key);
  if (keys.length === 0) return [];

  return db
    .select()
    .from(runtimeState)
    .where(inArray(runtimeState.key, [...keys]));
}

export async function writeRuntimeState(
  db: Database,
  state: RuntimeStateRow,
): Promise<void> {
  assertRuntimeStateKey(state.key);
  assertEpochMilliseconds(state.updatedAt, "updatedAt");
  if (state.integerValue !== null) {
    assertSafeInteger(state.integerValue, "integerValue");
  }

  await db
    .insert(runtimeState)
    .values(state)
    .onConflictDoUpdate({
      target: runtimeState.key,
      set: {
        textValue: state.textValue,
        integerValue: state.integerValue,
        updatedAt: state.updatedAt,
      },
    });
}

export async function countTargetsByDeclarationState(
  db: Database,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ declarationState: probeTargets.declarationState, total: count() })
    .from(probeTargets)
    .groupBy(probeTargets.declarationState);
  return Object.fromEntries(rows.map((row) => [row.declarationState, row.total]));
}

function assertRuntimeStateKey(key: string): void {
  if (key.trim().length === 0) {
    throw new Error("runtime_state key must not be empty");
  }
}

function assertEpochMilliseconds(value: number, label: string): void {
  assertSafeInteger(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative`);
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`);
  }
}
