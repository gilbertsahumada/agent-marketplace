import { and, eq, sql } from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase, readProbeTargetsByAgentIds, readRuntimeStates } from "../db/orm";
import { probeTargets, runtimeState } from "../db/schema";

const MAX_BOUND_PARAMETERS = 100;
const MAX_TARGET_IDS_PER_QUERY = MAX_BOUND_PARAMETERS - 1;
const LAST_SEEN_REFRESH_MS = 60 * 60_000;

export type SweepTransport = "a2a" | "erc8183_http";
export type SweepDeclarationState = "current" | "removed" | "metadata_unavailable";

export interface SweepTargetCandidate {
  readonly transport: SweepTransport;
  readonly endpoint: string;
  readonly categoriesJson: string;
  readonly categoryProvenance: "derived:marketplace-inventory" | null;
}

export type SweepAgentResult =
  | {
      readonly status: "ok";
      readonly agentId: string;
      readonly name: string | null;
      readonly metadataUpdatedAt: number | null;
      readonly targets: readonly SweepTargetCandidate[];
    }
  | {
      readonly status: "metadata_unavailable";
      readonly agentId: string;
    };

export interface SweepLiveAgentPage {
  readonly agentIds: readonly string[];
  readonly nextOffset: number;
  readonly complete: boolean;
}

export interface SweepFetchRequest {
  readonly agentIds: readonly string[];
}

export interface SweepPhaseDependencies {
  readonly listLiveAgentPage: (input: {
    readonly offset: number;
    readonly limit: number;
  }) => Promise<SweepLiveAgentPage>;
  /** Resolves exactly one trust8004 detail request per requested agent ID. */
  readonly fetchAgents: (request: SweepFetchRequest) => Promise<readonly SweepAgentResult[]>;
}

export interface SweepQueryBudget {
  readonly remaining: number;
  readonly used?: number;
}

export interface SweepRequestBudget {
  readonly remaining: number;
}

export interface SweepPhaseInput {
  readonly db: D1DatabaseLike;
  readonly limit: number;
  readonly nowMs: number;
  readonly queryBudget: SweepQueryBudget;
  readonly requestBudget: SweepRequestBudget;
  readonly startedAtMs?: number;
  readonly invocationQueriesAfterCommit?: number;
  readonly completedQueueScheduledTime?: number;
  readonly now?: () => number;
}

export interface SweepPhaseSummary {
  readonly phase: "sweep";
  readonly status: "ok";
  readonly processedAgents: number;
  readonly candidatesRead: number;
  readonly changedTargets: number;
  readonly removedTargets: number;
  readonly metadataUnavailableTargets: number;
  readonly previousOffset: number;
  readonly nextOffset: number;
  readonly sweepRound: number;
  readonly complete: boolean;
  readonly requests: number;
  readonly d1Queries: number;
  readonly batchQueries: number;
  readonly wallTimeMs: number;
}

export class SweepQueryBudgetExceededError extends Error {
  constructor(
    readonly remaining: number,
    readonly required: number,
  ) {
    super(`SWEEP requires ${required} D1 queries but only ${remaining} remain`);
    this.name = "SweepQueryBudgetExceededError";
  }
}

export class SweepRequestBudgetExceededError extends Error {
  constructor(
    readonly remaining: number,
    readonly required: number,
  ) {
    super(`SWEEP requires ${required} trust8004 requests but only ${remaining} remain`);
    this.name = "SweepRequestBudgetExceededError";
  }
}

interface ExistingTarget {
  readonly agentId: string;
  readonly transport: SweepTransport;
  readonly endpoint: string;
  readonly name: string | null;
  readonly categoriesJson: string;
  readonly categoryProvenance: "derived:marketplace-inventory" | null;
  readonly declarationState: SweepDeclarationState;
  readonly currentMetadataUpdatedAt: number | null;
  readonly lastMetadataCheckedAt: number;
  readonly firstSeenAt: number;
  readonly lastChangedAt: number;
  readonly lastSeenAt: number;
  readonly priority: number;
}

export function createD1LiveAgentPageReader(
  db: D1DatabaseLike,
  curatedAgentIds: readonly string[],
): SweepPhaseDependencies["listLiveAgentPage"] {
  const curated = [...new Set(curatedAgentIds.map(normalizeAgentId))];
  const fixedParameterCount = 2;
  if (curated.length + fixedParameterCount > MAX_BOUND_PARAMETERS) {
    throw new Error("SWEEP live page query exceeds the 100-parameter limit");
  }

  return async ({ offset, limit }) => {
    assertNonNegativeSafeInteger(offset, "SWEEP offset");
    assertPositiveSafeInteger(limit, "SWEEP limit");

    const curatedSelect = curated.length === 0
      ? sql`SELECT NULL AS agentId WHERE 0`
      : sql`SELECT column1 AS agentId FROM (VALUES ${sql.join(
          curated.map((agentId) => sql`(${agentId})`), sql`, `,
        )})`;
    const rows = await createDatabase(db).all<{ agentId: string }>(sql`
      WITH live_agent_ids AS (
        SELECT DISTINCT agentId
        FROM ${probeTargets}
        WHERE ${probeTargets.chainId} = 56
        UNION
        ${curatedSelect}
      )
      SELECT agentId
      FROM live_agent_ids
      ORDER BY length(agentId) ASC, agentId ASC
      LIMIT ${limit + 1} OFFSET ${offset}
    `);

    const agentIds = rows.slice(0, limit).map((row) => normalizeAgentId(row.agentId));
    return {
      agentIds,
      nextOffset: offset + agentIds.length,
      complete: rows.length <= limit,
    };
  };
}

export async function runSweepPhase(
  input: SweepPhaseInput,
  dependencies: SweepPhaseDependencies,
): Promise<SweepPhaseSummary> {
  assertPositiveSafeInteger(input.limit, "SWEEP limit");
  assertNonNegativeSafeInteger(input.nowMs, "SWEEP nowMs");

  const orm = createDatabase(input.db);
  const stateRows = await readRuntimeStates(orm, ["sweep_offset", "sweep_round"]);

  const state = new Map(stateRows.map((row) => [row.key, row.integerValue]));
  const previousOffset = runtimeInteger(state.get("sweep_offset"), "sweep_offset");
  const previousRound = runtimeInteger(state.get("sweep_round"), "sweep_round");
  const page = await dependencies.listLiveAgentPage({
    offset: previousOffset,
    limit: input.limit,
  });
  validatePage(page, previousOffset, input.limit);
  if (page.agentIds.length > input.requestBudget.remaining) {
    throw new SweepRequestBudgetExceededError(
      input.requestBudget.remaining,
      page.agentIds.length,
    );
  }

  const results = page.agentIds.length === 0
    ? []
    : await dependencies.fetchAgents({ agentIds: page.agentIds });
  validateFetchCoverage(page.agentIds, results);

  const existing = await readExistingTargets(input.db, page.agentIds);
  const existingByAgent = groupExistingTargets(existing);
  const statements: unknown[] = [];
  let changedTargets = 0;
  let removedTargets = 0;
  let metadataUnavailableTargets = 0;

  for (const result of results) {
    const previousTargets = existingByAgent.get(result.agentId) ?? [];
    if (result.status === "metadata_unavailable") {
      for (const target of previousTargets) {
        if (target.declarationState !== "current") continue;
        statements.push(prepareUnavailable(orm, target, input.nowMs));
        metadataUnavailableTargets += 1;
      }
      continue;
    }

    const candidates = deduplicateCandidates(result.targets);
    const declaredKeys = new Set(candidates.map(targetKey));
    for (const candidate of candidates) {
      const previous = previousTargets.find((target) => targetKey(target) === targetKey(candidate));
      if (previous === undefined || targetChanged(previous, result, candidate)) {
        statements.push(prepareUpsert(orm, result, candidate, previous, input.nowMs));
        changedTargets += 1;
      } else if (input.nowMs - previous.lastSeenAt >= LAST_SEEN_REFRESH_MS) {
        statements.push(prepareSeenRefresh(orm, previous, input.nowMs));
      }
    }

    for (const previous of previousTargets) {
      if (previous.declarationState === "removed" || declaredKeys.has(targetKey(previous))) continue;
      statements.push(prepareRemoved(orm, previous, input.nowMs));
      removedTargets += 1;
    }
  }

  const complete = page.complete;
  const nextOffset = complete ? 0 : page.nextOffset;
  const sweepRound = complete ? previousRound + 1 : previousRound;
  const stateStatementCount = (complete ? 4 : 3)
    + (input.completedQueueScheduledTime === undefined ? 0 : 1);
  const batchQueries = statements.length + stateStatementCount;
  if (batchQueries > input.queryBudget.remaining) {
    throw new SweepQueryBudgetExceededError(input.queryBudget.remaining, batchQueries);
  }

  const summary: SweepPhaseSummary = {
    phase: "sweep",
    status: "ok",
    processedAgents: results.length,
    candidatesRead: existing.length,
    changedTargets,
    removedTargets,
    metadataUnavailableTargets,
    previousOffset,
    nextOffset,
    sweepRound,
    complete,
    requests: page.agentIds.length,
    d1Queries: input.queryBudget.used === undefined
      ? 2 + Math.ceil(page.agentIds.length / MAX_BOUND_PARAMETERS) + batchQueries
      : input.queryBudget.used + batchQueries + (input.invocationQueriesAfterCommit ?? 0),
    batchQueries,
    wallTimeMs: Math.max(0, (input.now?.() ?? input.nowMs) - (input.startedAtMs ?? input.nowMs)),
  };

  statements.push(prepareRuntimeInteger(orm, "sweep_offset", nextOffset, input.nowMs));
  if (complete) {
    statements.push(prepareRuntimeInteger(orm, "sweep_round", sweepRound, input.nowMs));
  }
  statements.push(prepareRuntimeText(
    orm,
    "last_sweep_summary",
    JSON.stringify(summary),
    input.nowMs,
  ));
  statements.push(prepareRuntimeText(orm, "next_scheduler_phase", "probe", input.nowMs));
  if (input.completedQueueScheduledTime !== undefined) {
    statements.push(prepareRuntimeInteger(
      orm, "last_queue_scheduled_time", input.completedQueueScheduledTime, input.nowMs,
    ));
  }

  await orm.batch(statements as unknown as Parameters<typeof orm.batch>[0]);
  return summary;
}

async function readExistingTargets(
  db: D1DatabaseLike,
  agentIds: readonly string[],
): Promise<readonly ExistingTarget[]> {
  if (agentIds.length === 0) return [];
  const targets: ExistingTarget[] = [];
  for (let offset = 0; offset < agentIds.length; offset += MAX_TARGET_IDS_PER_QUERY) {
    const chunk = agentIds.slice(offset, offset + MAX_TARGET_IDS_PER_QUERY);
    targets.push(...await readProbeTargetsByAgentIds(
      createDatabase(db), chunk,
    ) as ExistingTarget[]);
  }
  return targets;
}

function prepareUpsert(
  db: ReturnType<typeof createDatabase>,
  agent: Extract<SweepAgentResult, { status: "ok" }>,
  candidate: SweepTargetCandidate,
  previous: ExistingTarget | undefined,
  nowMs: number,
 ) {
  return db.insert(probeTargets).values({
    agentId: agent.agentId, chainId: 56, transport: candidate.transport,
    endpoint: candidate.endpoint, name: agent.name, categoriesJson: candidate.categoriesJson,
    categoryProvenance: candidate.categoryProvenance, declarationState: "current",
    currentMetadataUpdatedAt: agent.metadataUpdatedAt, lastMetadataCheckedAt: nowMs,
    firstSeenAt: previous?.firstSeenAt ?? nowMs, lastChangedAt: nowMs,
    lastSeenAt: nowMs, priority: 1,
  }).onConflictDoUpdate({
    target: [probeTargets.chainId, probeTargets.agentId, probeTargets.transport, probeTargets.endpoint],
    set: {
      name: agent.name, categoriesJson: candidate.categoriesJson,
      categoryProvenance: candidate.categoryProvenance, declarationState: "current",
      currentMetadataUpdatedAt: agent.metadataUpdatedAt, lastMetadataCheckedAt: nowMs,
      lastChangedAt: nowMs, lastSeenAt: nowMs, priority: 1,
    },
  });
}

function prepareSeenRefresh(
  db: ReturnType<typeof createDatabase>,
  target: ExistingTarget,
  nowMs: number,
 ) {
  return db.update(probeTargets).set({ lastMetadataCheckedAt: nowMs, lastSeenAt: nowMs })
    .where(targetPredicate(target));
}

function prepareRemoved(
  db: ReturnType<typeof createDatabase>,
  target: ExistingTarget,
  nowMs: number,
 ) {
  return db.update(probeTargets).set({
    declarationState: "removed", lastMetadataCheckedAt: nowMs, lastChangedAt: nowMs,
  }).where(targetPredicate(target));
}

function prepareUnavailable(
  db: ReturnType<typeof createDatabase>,
  target: ExistingTarget,
  nowMs: number,
 ) {
  return db.update(probeTargets).set({
    declarationState: "metadata_unavailable", lastMetadataCheckedAt: nowMs, lastChangedAt: nowMs,
  }).where(targetPredicate(target));
}

function prepareRuntimeInteger(
  db: ReturnType<typeof createDatabase>,
  key: string,
  value: number,
  nowMs: number,
 ) {
  return db.insert(runtimeState).values({ key, textValue: null, integerValue: value, updatedAt: nowMs })
    .onConflictDoUpdate({ target: runtimeState.key, set: { textValue: null, integerValue: value, updatedAt: nowMs } });
}

function prepareRuntimeText(
  db: ReturnType<typeof createDatabase>,
  key: string,
  value: string,
  nowMs: number,
 ) {
  return db.insert(runtimeState).values({ key, textValue: value, integerValue: null, updatedAt: nowMs })
    .onConflictDoUpdate({ target: runtimeState.key, set: { textValue: value, integerValue: null, updatedAt: nowMs } });
}

function targetPredicate(target: ExistingTarget) {
  return and(
    eq(probeTargets.chainId, 56), eq(probeTargets.agentId, target.agentId),
    eq(probeTargets.transport, target.transport), eq(probeTargets.endpoint, target.endpoint),
  );
}

function targetChanged(
  previous: ExistingTarget,
  agent: Extract<SweepAgentResult, { status: "ok" }>,
  candidate: SweepTargetCandidate,
): boolean {
  return previous.name !== agent.name
    || previous.categoriesJson !== candidate.categoriesJson
    || previous.categoryProvenance !== candidate.categoryProvenance
    || previous.declarationState !== "current"
    || previous.currentMetadataUpdatedAt !== agent.metadataUpdatedAt;
}

function groupExistingTargets(
  targets: readonly ExistingTarget[],
): ReadonlyMap<string, readonly ExistingTarget[]> {
  const grouped = new Map<string, ExistingTarget[]>();
  for (const target of targets) {
    const values = grouped.get(target.agentId) ?? [];
    values.push(target);
    grouped.set(target.agentId, values);
  }
  return grouped;
}

function deduplicateCandidates(
  candidates: readonly SweepTargetCandidate[],
): readonly SweepTargetCandidate[] {
  const unique = new Map<string, SweepTargetCandidate>();
  for (const candidate of candidates) unique.set(targetKey(candidate), candidate);
  return [...unique.values()];
}

function targetKey(target: Pick<SweepTargetCandidate, "transport" | "endpoint">): string {
  return `${target.transport}\u0000${target.endpoint}`;
}

function validatePage(page: SweepLiveAgentPage, offset: number, limit: number): void {
  assertNonNegativeSafeInteger(page.nextOffset, "SWEEP nextOffset");
  if (page.agentIds.length > limit) throw new Error("SWEEP live page exceeds its limit");
  if (page.nextOffset !== offset + page.agentIds.length) {
    throw new Error("SWEEP live page returned a discontinuous cursor");
  }
  if (!page.complete && page.nextOffset <= offset) {
    throw new Error("SWEEP live page must advance a non-final cursor");
  }
  const normalized = page.agentIds.map(normalizeAgentId);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("SWEEP live page contains duplicate agent IDs");
  }
}

function validateFetchCoverage(
  requestedAgentIds: readonly string[],
  results: readonly SweepAgentResult[],
): void {
  const requested = new Set(requestedAgentIds);
  const returned = new Set<string>();
  for (const result of results) {
    const agentId = normalizeAgentId(result.agentId);
    if (!requested.has(agentId) || returned.has(agentId)) {
      throw new Error("SWEEP response does not match the requested live page");
    }
    returned.add(agentId);
  }
  if (returned.size !== requested.size) {
    throw new Error("SWEEP response is incomplete; cursor was not advanced");
  }
}

function normalizeAgentId(agentId: string): string {
  if (!/^(0|[1-9]\d*)$/.test(agentId)) throw new Error(`Invalid SWEEP agent ID: ${agentId}`);
  return agentId;
}

function runtimeInteger(value: number | null | undefined, key: string): number {
  if (value === null || value === undefined) return 0;
  assertNonNegativeSafeInteger(value, key);
  return value;
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive`);
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}
