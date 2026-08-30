import { and, count, desc, eq, getTableColumns, inArray, isNull, max, min, or } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import type { D1DatabaseLike } from "./client";
import { funnelSnapshots, probeObservations, probeTargets, runtimeState, schedulerAttempts, schema } from "./schema";

/**
 * Runtime Drizzle boundary. Schema-derived row types make schema drift fail at
 * compile time instead of inside a hand-written SQL string in production. The
 * scheduler lease and binding-level budget wrapper remain raw because their
 * exact atomic SQL and D1 meta accounting are deliberate.
 */
export type Database = DrizzleD1Database<typeof schema>;

export type ProbeTargetRow = typeof schema.probeTargets.$inferSelect;
export type ProbeObservationRow = typeof schema.probeObservations.$inferSelect;
export type FunnelSnapshotRow = typeof schema.funnelSnapshots.$inferSelect;
export type HireEventRow = typeof schema.hireEvents.$inferSelect;
export type RuntimeStateRow = typeof schema.runtimeState.$inferSelect;
export type SchedulerAttemptRow = typeof schema.schedulerAttempts.$inferSelect;

export interface ObservationFeedRows {
  readonly funnel: FunnelSnapshotRow | null;
  readonly targets: ProbeTargetRow[];
  readonly latestByTargetCategory: ProbeObservationRow[];
  readonly quoteVerifiedAtByTargetCategory: Array<{
    agentId: string;
    chainId: number;
    transport: string;
    endpoint: string;
    probeCategory: string | null;
    probedAt: number | null;
  }>;
  readonly attemptStatsByTarget: Array<{
    agentId: string;
    chainId: number;
    transport: string;
    endpoint: string;
    attemptCount: number;
    firstProbedAt: number | null;
    lastProbedAt: number | null;
  }>;
  readonly lastSchedulerAttempt: SchedulerAttemptRow | null;
}

export function createDatabase(d1: D1DatabaseLike): Database {
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

export async function readProbeTargetsByAgentIds(
  db: Database,
  agentIds: readonly string[],
) {
  if (agentIds.length === 0) return [];
  return db.select().from(probeTargets).where(and(
    eq(probeTargets.chainId, 56),
    inArray(probeTargets.agentId, [...agentIds]),
  ));
}

export async function readObservationFeed(
  db: Database,
  agentIds: readonly string[] = [],
): Promise<ObservationFeedRows> {
  const scopedAgents = agentIds.length === 0
    ? undefined
    : inArray(probeObservations.agentId, [...agentIds]);
  const latestObservationTimes = db
    .select({
      chainId: probeObservations.chainId,
      agentId: probeObservations.agentId,
      transport: probeObservations.transport,
      endpoint: probeObservations.endpoint,
      probeCategory: probeObservations.probeCategory,
      probedAt: max(probeObservations.probedAt).as("probed_at"),
    })
    .from(probeObservations)
    .where(scopedAgents)
    .groupBy(
      probeObservations.chainId,
      probeObservations.agentId,
      probeObservations.transport,
      probeObservations.endpoint,
      probeObservations.probeCategory,
    ).as("latest_observation_times");

  const [
    funnelRows,
    targets,
    latestByTargetCategory,
    quoteVerifiedAtByTargetCategory,
    attemptStatsByTarget,
    lastSchedulerAttempts,
  ] = await Promise.all([
    db.select().from(funnelSnapshots)
      .orderBy(desc(funnelSnapshots.measuredAt), desc(funnelSnapshots.id))
      .limit(1),
    db.select().from(probeTargets)
      .where(agentIds.length === 0 ? undefined : inArray(probeTargets.agentId, [...agentIds]))
      .orderBy(probeTargets.agentId, probeTargets.transport, probeTargets.endpoint),
    db.select({ ...getTableColumns(probeObservations) }).from(probeObservations)
      .innerJoin(latestObservationTimes, and(
        eq(probeObservations.chainId, latestObservationTimes.chainId),
        eq(probeObservations.agentId, latestObservationTimes.agentId),
        eq(probeObservations.transport, latestObservationTimes.transport),
        eq(probeObservations.endpoint, latestObservationTimes.endpoint),
        or(
          eq(probeObservations.probeCategory, latestObservationTimes.probeCategory),
          and(isNull(probeObservations.probeCategory), isNull(latestObservationTimes.probeCategory)),
        ),
        eq(probeObservations.probedAt, latestObservationTimes.probedAt),
      ))
      .orderBy(desc(probeObservations.probedAt), probeObservations.id),
    db.select({
      agentId: probeObservations.agentId,
      chainId: probeObservations.chainId,
      transport: probeObservations.transport,
      endpoint: probeObservations.endpoint,
      probeCategory: probeObservations.probeCategory,
      probedAt: max(probeObservations.probedAt),
    }).from(probeObservations)
      .where(and(eq(probeObservations.outcome, "quote_verified"), scopedAgents))
      .groupBy(
        probeObservations.chainId,
        probeObservations.agentId,
        probeObservations.transport,
        probeObservations.endpoint,
        probeObservations.probeCategory,
      ),
    db.select({
      agentId: probeObservations.agentId,
      chainId: probeObservations.chainId,
      transport: probeObservations.transport,
      endpoint: probeObservations.endpoint,
      attemptCount: count(),
      firstProbedAt: min(probeObservations.probedAt),
      lastProbedAt: max(probeObservations.probedAt),
    }).from(probeObservations)
      .where(scopedAgents)
      .groupBy(
        probeObservations.chainId,
        probeObservations.agentId,
        probeObservations.transport,
        probeObservations.endpoint,
      ),
    db.select().from(schedulerAttempts)
      .orderBy(desc(schedulerAttempts.finishedAt), desc(schedulerAttempts.id))
      .limit(1),
  ]);

  return {
    funnel: funnelRows[0] ?? null,
    targets,
    latestByTargetCategory,
    quoteVerifiedAtByTargetCategory,
    attemptStatsByTarget,
    lastSchedulerAttempt: lastSchedulerAttempts[0] ?? null,
  };
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
