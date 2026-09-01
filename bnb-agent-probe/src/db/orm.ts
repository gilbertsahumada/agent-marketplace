import { and, count, desc, eq, getTableColumns, inArray, isNull, max, min, or, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import type { D1DatabaseLike } from "./client";
import {
  catalogAgents,
  catalogAgentAdmission,
  catalogAgentEndpoints,
  catalogEndpoints,
  catalogIngestTasks,
  catalogObservations,
  catalogValidationRequests,
  funnelSnapshots,
  probeObservations,
  probeTargets,
  runtimeState,
  schedulerAttempts,
  schema,
} from "./schema";

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
export type CatalogAgentRow = typeof schema.catalogAgents.$inferSelect;
export type CatalogAgentEndpointRow = typeof schema.catalogAgentEndpoints.$inferSelect;
export type CatalogEndpointRow = typeof schema.catalogEndpoints.$inferSelect;
export type CatalogObservationRow = typeof schema.catalogObservations.$inferSelect;
export type CatalogAgentAdmissionRow = typeof schema.catalogAgentAdmission.$inferSelect;
export type CatalogIngestTaskRow = typeof schema.catalogIngestTasks.$inferSelect;

export interface CatalogAgentEvidenceRows {
  readonly agent: CatalogAgentRow | null;
  readonly declarations: CatalogAgentEndpointRow[];
  readonly endpoints: CatalogEndpointRow[];
  readonly observations: CatalogObservationRow[];
  readonly admission: CatalogAgentAdmissionRow | null;
  readonly platformAttemptCount: number;
  readonly ingestTask: CatalogIngestTaskRow | null;
  readonly platformAttemptCountByEndpoint: ReadonlyMap<string, number>;
}

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

export interface CatalogOperationsRows {
  readonly validationRequests: Record<string, number>;
  readonly endpoints: {
    due: number;
    leased: number;
    failed: number;
    oldestDueAt: number | null;
  };
  readonly ingestTasks: Record<string, number>;
  readonly maximumVisibilityLagMs: number;
  readonly observations: Record<string, number>;
  readonly declarations: {
    external: number;
    invalid: number;
    unsafe: number;
    unsupported: number;
  };
  readonly scheduler: {
    attempts: number;
    retries: number;
    queueMessages: number;
    averageD1Queries: number;
    maximumD1Queries: number;
    rowsRead: number;
    rowsWritten: number;
  };
}

export function createDatabase(d1: D1DatabaseLike): Database {
  return drizzle(d1 as Parameters<typeof drizzle>[0], { schema });
}

export async function readCatalogOperations(
  db: Database,
  nowMs: number,
): Promise<CatalogOperationsRows> {
  const dayStart = nowMs - 24 * 60 * 60 * 1_000;
  const [requests, endpointRows, ingest, visibilityRows, observations, declarations, schedulerRows] = await Promise.all([
    db.select({ key: catalogValidationRequests.status, total: count() })
      .from(catalogValidationRequests).groupBy(catalogValidationRequests.status),
    db.select({
      due: sql<number>`COALESCE(SUM(CASE WHEN ${catalogEndpoints.role}='operational'
        AND ${catalogEndpoints.eligibility}='eligible' AND ${catalogEndpoints.nextProbeAt} IS NOT NULL
        AND ${catalogEndpoints.nextProbeAt} <= ${nowMs} THEN 1 ELSE 0 END), 0)`,
      leased: sql<number>`COALESCE(SUM(CASE WHEN ${catalogEndpoints.leaseOwner} IS NOT NULL
        AND ${catalogEndpoints.leaseExpiresAt} > ${nowMs} THEN 1 ELSE 0 END), 0)`,
      failed: sql<number>`COALESCE(SUM(CASE WHEN ${catalogEndpoints.consecutiveFailures} > 0 THEN 1 ELSE 0 END), 0)`,
      oldestDueAt: sql<number | null>`MIN(CASE WHEN ${catalogEndpoints.role}='operational'
        AND ${catalogEndpoints.eligibility}='eligible' AND ${catalogEndpoints.nextProbeAt} IS NOT NULL
        AND ${catalogEndpoints.nextProbeAt} <= ${nowMs} THEN ${catalogEndpoints.nextProbeAt} END)`,
    }).from(catalogEndpoints),
    db.select({ key: catalogIngestTasks.status, total: count() })
      .from(catalogIngestTasks).groupBy(catalogIngestTasks.status),
    db.select({
      maximum: sql<number>`COALESCE(MAX(${catalogIngestTasks.generationStartedAt}
        - ${catalogIngestTasks.upstreamObservedAt}), 0)`,
    }).from(catalogIngestTasks).where(sql`${catalogIngestTasks.upstreamObservedAt} IS NOT NULL`),
    db.select({
      protocol: catalogObservations.protocol,
      outcome: catalogObservations.outcome,
      total: count(),
    }).from(catalogObservations).where(and(
      inArray(catalogObservations.source, ["worker_probe", "buyer_refresh", "chain_read", "migration"]),
      sql`${catalogObservations.observedAt} >= ${dayStart}`,
    )).groupBy(catalogObservations.protocol, catalogObservations.outcome),
    db.select({
      external: sql<number>`COALESCE(SUM(CASE WHEN ${catalogEndpoints.role}='external' THEN 1 ELSE 0 END), 0)`,
      invalid: sql<number>`COALESCE(SUM(CASE WHEN ${catalogEndpoints.eligibility}='invalid_declaration' THEN 1 ELSE 0 END), 0)`,
      unsafe: sql<number>`COALESCE(SUM(CASE WHEN ${catalogEndpoints.eligibility}='unsafe' THEN 1 ELSE 0 END), 0)`,
      unsupported: sql<number>`COALESCE(SUM(CASE WHEN ${catalogEndpoints.eligibility}='unsupported' THEN 1 ELSE 0 END), 0)`,
    }).from(catalogAgentEndpoints).innerJoin(
      catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey),
    ).where(eq(catalogAgentEndpoints.declarationState, "current")),
    db.select({
      attempts: count(),
      retries: sql<number>`COALESCE(SUM(CASE WHEN ${schedulerAttempts.attempt} > 1 THEN 1 ELSE 0 END), 0)`,
      queueMessages: sql<number>`COUNT(DISTINCT ${schedulerAttempts.messageId})`,
      averageD1Queries: sql<number>`COALESCE(AVG(${schedulerAttempts.d1Queries}), 0)`,
      maximumD1Queries: sql<number>`COALESCE(MAX(${schedulerAttempts.d1Queries}), 0)`,
      rowsRead: sql<number>`COALESCE(SUM(${schedulerAttempts.rowsReadObservedBeforeLedger}), 0)`,
      rowsWritten: sql<number>`COALESCE(SUM(${schedulerAttempts.rowsWrittenObservedBeforeLedger}), 0)`,
    }).from(schedulerAttempts).where(sql`${schedulerAttempts.startedAt} >= ${dayStart}`),
  ]);
  const countRecord = (rows: Array<{ key: string; total: number }>) =>
    Object.fromEntries(rows.map((row) => [row.key, Number(row.total)]));
  const endpoint = endpointRows[0];
  const declaration = declarations[0];
  const scheduler = schedulerRows[0];
  return {
    validationRequests: countRecord(requests),
    endpoints: {
      due: Number(endpoint?.due ?? 0),
      leased: Number(endpoint?.leased ?? 0),
      failed: Number(endpoint?.failed ?? 0),
      oldestDueAt: endpoint?.oldestDueAt ?? null,
    },
    ingestTasks: countRecord(ingest),
    maximumVisibilityLagMs: Number(visibilityRows[0]?.maximum ?? 0),
    observations: Object.fromEntries(observations.map((row) => [
      `${row.protocol}:${row.outcome}`, Number(row.total),
    ])),
    declarations: {
      external: Number(declaration?.external ?? 0),
      invalid: Number(declaration?.invalid ?? 0),
      unsafe: Number(declaration?.unsafe ?? 0),
      unsupported: Number(declaration?.unsupported ?? 0),
    },
    scheduler: {
      attempts: Number(scheduler?.attempts ?? 0),
      retries: Number(scheduler?.retries ?? 0),
      queueMessages: Number(scheduler?.queueMessages ?? 0),
      averageD1Queries: Number(scheduler?.averageD1Queries ?? 0),
      maximumD1Queries: Number(scheduler?.maximumD1Queries ?? 0),
      rowsRead: Number(scheduler?.rowsRead ?? 0),
      rowsWritten: Number(scheduler?.rowsWritten ?? 0),
    },
  };
}

export async function readCatalogAgentEvidence(
  db: Database,
  agentId: string,
  observationLimit = 50,
): Promise<CatalogAgentEvidenceRows> {
  const agentKey = `eip155:56:${agentId}`;
  const [agents, declarations, admissions, ingestTasks] = await Promise.all([
    db.select().from(catalogAgents).where(eq(catalogAgents.agentKey, agentKey)).limit(1),
    db.select().from(catalogAgentEndpoints)
      .where(and(
        eq(catalogAgentEndpoints.agentKey, agentKey),
        eq(catalogAgentEndpoints.declarationState, "current"),
      ))
      .orderBy(desc(catalogAgentEndpoints.priority), catalogAgentEndpoints.endpointKey),
    db.select().from(catalogAgentAdmission)
      .where(eq(catalogAgentAdmission.agentKey, agentKey))
      .limit(1),
    db.select().from(catalogIngestTasks)
      .where(eq(catalogIngestTasks.agentKey, agentKey))
      .limit(1),
  ]);
  const endpointKeys = declarations.map((entry) => entry.endpointKey);
  const observationCondition = eq(catalogObservations.agentKey, agentKey);
  const [endpoints, recentObservations, effectiveEndpointObservations, effectiveAgentObservations,
    platformAttemptTotals, platformAttemptsByEndpoint] = await Promise.all([
    endpointKeys.length === 0
      ? Promise.resolve([])
      : db.select().from(catalogEndpoints)
        .where(inArray(catalogEndpoints.endpointKey, endpointKeys))
        .orderBy(catalogEndpoints.protocol, catalogEndpoints.endpointKey),
    db.select().from(catalogObservations)
      .where(observationCondition)
      .orderBy(desc(catalogObservations.observedAt), desc(catalogObservations.id))
      .limit(observationLimit),
    readEffectiveCatalogObservations(db, agentKey, endpointKeys),
    readEffectiveAgentObservations(db, [agentKey]),
    db.select({ total: count() }).from(catalogObservations)
      .innerJoin(catalogAgentEndpoints, and(
        eq(catalogAgentEndpoints.agentKey, catalogObservations.agentKey),
        eq(catalogAgentEndpoints.endpointKey, catalogObservations.endpointKey),
        eq(catalogAgentEndpoints.declarationState, "current"),
      ))
      .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogObservations.endpointKey))
      .where(and(
      observationCondition,
      inArray(catalogObservations.source, ["worker_probe", "buyer_refresh", "migration"]),
      inArray(catalogObservations.validationKind, ["protocol", "reachability"]),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
    )),
    endpointKeys.length === 0 ? Promise.resolve([]) : db.select({
      endpointKey: catalogObservations.endpointKey,
      total: count(),
    }).from(catalogObservations)
      .innerJoin(catalogAgentEndpoints, and(
        eq(catalogAgentEndpoints.agentKey, catalogObservations.agentKey),
        eq(catalogAgentEndpoints.endpointKey, catalogObservations.endpointKey),
        eq(catalogAgentEndpoints.declarationState, "current"),
      ))
      .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogObservations.endpointKey))
      .where(and(
      observationCondition,
      inArray(catalogObservations.endpointKey, endpointKeys),
      inArray(catalogObservations.source, ["worker_probe", "buyer_refresh", "migration"]),
      inArray(catalogObservations.validationKind, ["protocol", "reachability"]),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
    )).groupBy(catalogObservations.endpointKey),
  ]);
  const observations = [...new Map([
    ...recentObservations,
    ...effectiveEndpointObservations,
    ...effectiveAgentObservations,
  ].map((observation) => [observation.id, observation])).values()]
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);
  return {
    agent: agents[0] ?? null,
    declarations,
    endpoints,
    observations,
    admission: admissions[0] ?? null,
    platformAttemptCount: platformAttemptTotals[0]?.total ?? 0,
    ingestTask: ingestTasks[0] ?? null,
    platformAttemptCountByEndpoint: new Map(platformAttemptsByEndpoint.flatMap((row) => row.endpointKey === null
      ? []
      : [[row.endpointKey, row.total] as const])),
  };
}

export async function appendCatalogObservation(
  db: Database,
  observation: typeof schema.catalogObservations.$inferInsert,
): Promise<number> {
  const inserted = await db.insert(catalogObservations).values(observation).returning({
    id: catalogObservations.id,
  });
  const id = inserted[0]?.id;
  if (id === undefined) throw new Error("CATALOG_OBSERVATION_INSERT_FAILED");
  return id;
}

export async function readCatalogProjectionMismatches(db: Database): Promise<Array<{
  endpointKey: string;
  projectedAttemptAt: number | null;
  ledgerAttemptAt: number | null;
  projectedAttemptOutcome: string | null;
  ledgerAttemptOutcome: string | null;
  projectedSuccessAt: number | null;
  ledgerSuccessAt: number | null;
}>> {
  // Shared endpoint columns are owned by the representative declaration. A
  // non-representative buyer refresh remains agent-scoped ledger evidence and
  // must not make the shared projection look inconsistent.
  return db.all(sql`WITH ranked AS (
    SELECT observation.endpointKey, observation.observedAt, observation.outcome,
      ROW_NUMBER() OVER (
        PARTITION BY observation.endpointKey
        ORDER BY observation.observedAt DESC, observation.id DESC
      ) AS position
    FROM catalog_observations observation
    INNER JOIN catalog_endpoints scope
      ON scope.endpointKey = observation.endpointKey
      AND (scope.representativeAgentKey IS NULL
        OR scope.representativeAgentKey = observation.agentKey)
    WHERE observation.endpointKey IS NOT NULL
      AND observation.source IN ('worker_probe', 'buyer_refresh', 'migration')
      AND observation.verificationLevel = 'platform_observed'
      AND observation.validationKind IN ('reachability', 'protocol')
  ), latest AS (
    SELECT endpointKey, observedAt, outcome FROM ranked WHERE position = 1
  ), successes AS (
    SELECT observation.endpointKey, MAX(observation.observedAt) AS observedAt
    FROM catalog_observations observation
    INNER JOIN catalog_endpoints scope
      ON scope.endpointKey = observation.endpointKey
      AND (scope.representativeAgentKey IS NULL
        OR scope.representativeAgentKey = observation.agentKey)
    WHERE observation.endpointKey IS NOT NULL
      AND observation.source IN ('worker_probe', 'buyer_refresh', 'migration')
      AND observation.verificationLevel = 'platform_observed'
      AND observation.outcome = 'protocol_valid'
      AND observation.validationKind IN ('reachability', 'protocol')
    GROUP BY observation.endpointKey
  )
  SELECT
    endpoint.endpointKey AS endpointKey,
    endpoint.lastAttemptAt AS projectedAttemptAt,
    latest.observedAt AS ledgerAttemptAt,
    endpoint.lastAttemptOutcome AS projectedAttemptOutcome,
    latest.outcome AS ledgerAttemptOutcome,
    endpoint.lastSuccessfulAt AS projectedSuccessAt,
    successes.observedAt AS ledgerSuccessAt
  FROM catalog_endpoints endpoint
  LEFT JOIN latest ON latest.endpointKey = endpoint.endpointKey
  LEFT JOIN successes ON successes.endpointKey = endpoint.endpointKey
  WHERE endpoint.role = 'operational'
    AND (
      endpoint.lastAttemptAt IS NOT latest.observedAt
      OR endpoint.lastAttemptOutcome IS NOT latest.outcome
      OR endpoint.lastSuccessfulAt IS NOT successes.observedAt
    )`);
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

export async function readEffectiveCatalogObservations(
  db: Database,
  agentKey: string,
  endpointKeys: readonly string[],
): Promise<CatalogObservationRow[]> {
  return readEffectiveCatalogObservationsForAgents(db, [agentKey], endpointKeys);
}

export async function readEffectiveCatalogObservationsForAgents(
  db: Database,
  agentKeys: readonly string[],
  endpointKeys: readonly string[],
): Promise<CatalogObservationRow[]> {
  const rows: CatalogObservationRow[] = [];
  const uniqueAgents = [...new Set(agentKeys)];
  const uniqueEndpoints = [...new Set(endpointKeys)];
  for (const agentChunk of chunks(uniqueAgents, 40)) {
    for (const endpointChunk of chunks(uniqueEndpoints, 40)) {
      if (agentChunk.length === 0 || endpointChunk.length === 0) continue;
      rows.push(...await db.all<CatalogObservationRow>(sql`SELECT
        id, agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt,
        httpStatus, errorCode, durationMs, detailsJson, attemptId, validationKind,
        verificationLevel, artifactHash
      FROM (
        SELECT observation.*,
          ROW_NUMBER() OVER (
            PARTITION BY agentKey, endpointKey ORDER BY observedAt DESC, id DESC
          ) AS attemptPosition,
          ROW_NUMBER() OVER (
            PARTITION BY agentKey, endpointKey, CASE WHEN outcome = 'protocol_valid' THEN 1 ELSE 0 END
            ORDER BY observedAt DESC, id DESC
          ) AS outcomePosition
        FROM catalog_observations observation
        WHERE agentKey IN (${sql.join(agentChunk.map((key) => sql`${key}`), sql`, `)})
          AND endpointKey IN (${sql.join(endpointChunk.map((key) => sql`${key}`), sql`, `)})
          AND source IN ('worker_probe', 'buyer_refresh', 'migration')
          AND verificationLevel = 'platform_observed'
          AND validationKind IN ('reachability', 'protocol')
      ) effective
      WHERE attemptPosition = 1 OR (outcome = 'protocol_valid' AND outcomePosition = 1)
      ORDER BY observedAt DESC, id DESC`));
    }
  }
  return rows;
}

export async function readEffectiveAgentObservations(
  db: Database,
  agentKeys: readonly string[],
): Promise<CatalogObservationRow[]> {
  const rows: CatalogObservationRow[] = [];
  for (const agentChunk of chunks([...new Set(agentKeys)], 40)) {
    if (agentChunk.length === 0) continue;
    rows.push(...await db.all<CatalogObservationRow>(sql`SELECT
      id, agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt,
      httpStatus, errorCode, durationMs, detailsJson, attemptId, validationKind,
      verificationLevel, artifactHash
    FROM (
      SELECT observation.*,
        ROW_NUMBER() OVER (
          PARTITION BY agentKey, validationKind, endpointKey ORDER BY observedAt DESC, id DESC
        ) AS evidencePosition
      FROM catalog_observations observation
      WHERE agentKey IN (${sql.join(agentChunk.map((key) => sql`${key}`), sql`, `)})
        AND (
          (validationKind = 'quote' AND verificationLevel = 'cryptographic')
          OR (validationKind = 'chain' AND verificationLevel = 'onchain')
        )
    ) effective
    WHERE evidencePosition = 1
    ORDER BY observedAt DESC, id DESC`));
  }
  return rows;
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
