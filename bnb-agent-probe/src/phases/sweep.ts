import type { D1DatabaseLike, D1PreparedStatementLike } from "../db/client";

const MAX_BOUND_PARAMETERS = 100;
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

interface RuntimeStateRow {
  readonly key: string;
  readonly integerValue: number | null;
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
      ? "SELECT NULL AS agentId WHERE 0"
      : `SELECT column1 AS agentId FROM (VALUES ${curated.map(() => "(?)").join(", ")})`;
    const result = await db
      .prepare(
        `WITH live_agent_ids AS (
           SELECT DISTINCT agentId
           FROM probe_targets
           WHERE chainId = 56
           UNION
           ${curatedSelect}
         )
         SELECT agentId
         FROM live_agent_ids
         ORDER BY length(agentId) ASC, agentId ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(...curated, limit + 1, offset)
      .all<{ agentId: string }>();

    if (!result.success) throw new Error("Could not read SWEEP live agent page");
    const rows = result.results ?? [];
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

  const stateRows = await input.db
    .prepare(
      `SELECT key, integerValue
       FROM runtime_state
       WHERE key IN ('sweep_offset', 'sweep_round')`,
    )
    .all<RuntimeStateRow>();
  if (!stateRows.success) throw new Error("Could not read SWEEP runtime state");

  const state = new Map((stateRows.results ?? []).map((row) => [row.key, row.integerValue]));
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
  const statements: D1PreparedStatementLike[] = [];
  let changedTargets = 0;
  let removedTargets = 0;
  let metadataUnavailableTargets = 0;

  for (const result of results) {
    const previousTargets = existingByAgent.get(result.agentId) ?? [];
    if (result.status === "metadata_unavailable") {
      for (const target of previousTargets) {
        if (target.declarationState !== "current") continue;
        statements.push(prepareUnavailable(input.db, target, input.nowMs));
        metadataUnavailableTargets += 1;
      }
      continue;
    }

    const candidates = deduplicateCandidates(result.targets);
    const declaredKeys = new Set(candidates.map(targetKey));
    for (const candidate of candidates) {
      const previous = previousTargets.find((target) => targetKey(target) === targetKey(candidate));
      if (previous === undefined || targetChanged(previous, result, candidate)) {
        statements.push(prepareUpsert(input.db, result, candidate, previous, input.nowMs));
        changedTargets += 1;
      } else if (input.nowMs - previous.lastSeenAt >= LAST_SEEN_REFRESH_MS) {
        statements.push(prepareSeenRefresh(input.db, previous, input.nowMs));
      }
    }

    for (const previous of previousTargets) {
      if (previous.declarationState === "removed" || declaredKeys.has(targetKey(previous))) continue;
      statements.push(prepareRemoved(input.db, previous, input.nowMs));
      removedTargets += 1;
    }
  }

  const complete = page.complete;
  const nextOffset = complete ? 0 : page.nextOffset;
  const sweepRound = complete ? previousRound + 1 : previousRound;
  const stateStatementCount = complete ? 4 : 3;
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

  statements.push(prepareRuntimeInteger(input.db, "sweep_offset", nextOffset, input.nowMs));
  if (complete) {
    statements.push(prepareRuntimeInteger(input.db, "sweep_round", sweepRound, input.nowMs));
  }
  statements.push(prepareRuntimeText(
    input.db,
    "last_sweep_summary",
    JSON.stringify(summary),
    input.nowMs,
  ));
  statements.push(prepareRuntimeText(input.db, "next_scheduler_phase", "probe", input.nowMs));

  const batchResults = await input.db.batch(statements);
  if (batchResults.length !== statements.length || batchResults.some((result) => !result.success)) {
    throw new Error("SWEEP batch did not complete successfully");
  }
  return summary;
}

async function readExistingTargets(
  db: D1DatabaseLike,
  agentIds: readonly string[],
): Promise<readonly ExistingTarget[]> {
  if (agentIds.length === 0) return [];
  const targets: ExistingTarget[] = [];
  for (let offset = 0; offset < agentIds.length; offset += MAX_BOUND_PARAMETERS) {
    const chunk = agentIds.slice(offset, offset + MAX_BOUND_PARAMETERS);
    const result = await db
      .prepare(
        `SELECT agentId, transport, endpoint, name, categoriesJson, categoryProvenance,
                declarationState, currentMetadataUpdatedAt, lastMetadataCheckedAt,
                firstSeenAt, lastChangedAt, lastSeenAt, priority
         FROM probe_targets
         WHERE chainId = 56
           AND agentId IN (${chunk.map(() => "?").join(", ")})`,
      )
      .bind(...chunk)
      .all<ExistingTarget>();
    if (!result.success) throw new Error("Could not read SWEEP candidates");
    targets.push(...(result.results ?? []));
  }
  return targets;
}

function prepareUpsert(
  db: D1DatabaseLike,
  agent: Extract<SweepAgentResult, { status: "ok" }>,
  candidate: SweepTargetCandidate,
  previous: ExistingTarget | undefined,
  nowMs: number,
): D1PreparedStatementLike {
  return db.prepare(
    `INSERT INTO probe_targets (
       agentId, chainId, transport, endpoint, name, categoriesJson,
       categoryProvenance, declarationState, currentMetadataUpdatedAt,
       lastMetadataCheckedAt, firstSeenAt, lastChangedAt, lastSeenAt, priority
     ) VALUES (?, 56, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?, ?, 1)
     ON CONFLICT(chainId, agentId, transport, endpoint) DO UPDATE SET
       name = excluded.name,
       categoriesJson = excluded.categoriesJson,
       categoryProvenance = excluded.categoryProvenance,
       declarationState = 'current',
       currentMetadataUpdatedAt = excluded.currentMetadataUpdatedAt,
       lastMetadataCheckedAt = excluded.lastMetadataCheckedAt,
       lastChangedAt = excluded.lastChangedAt,
       lastSeenAt = excluded.lastSeenAt,
       priority = 1`,
  ).bind(
    agent.agentId,
    candidate.transport,
    candidate.endpoint,
    agent.name,
    candidate.categoriesJson,
    candidate.categoryProvenance,
    agent.metadataUpdatedAt,
    nowMs,
    previous?.firstSeenAt ?? nowMs,
    nowMs,
    nowMs,
  );
}

function prepareSeenRefresh(
  db: D1DatabaseLike,
  target: ExistingTarget,
  nowMs: number,
): D1PreparedStatementLike {
  return db.prepare(
    `UPDATE probe_targets
     SET lastMetadataCheckedAt = ?, lastSeenAt = ?
     WHERE chainId = 56 AND agentId = ? AND transport = ? AND endpoint = ?`,
  ).bind(nowMs, nowMs, target.agentId, target.transport, target.endpoint);
}

function prepareRemoved(
  db: D1DatabaseLike,
  target: ExistingTarget,
  nowMs: number,
): D1PreparedStatementLike {
  return db.prepare(
    `UPDATE probe_targets
     SET declarationState = 'removed', lastMetadataCheckedAt = ?, lastChangedAt = ?
     WHERE chainId = 56 AND agentId = ? AND transport = ? AND endpoint = ?`,
  ).bind(nowMs, nowMs, target.agentId, target.transport, target.endpoint);
}

function prepareUnavailable(
  db: D1DatabaseLike,
  target: ExistingTarget,
  nowMs: number,
): D1PreparedStatementLike {
  return db.prepare(
    `UPDATE probe_targets
     SET declarationState = 'metadata_unavailable', lastMetadataCheckedAt = ?, lastChangedAt = ?
     WHERE chainId = 56 AND agentId = ? AND transport = ? AND endpoint = ?`,
  ).bind(nowMs, nowMs, target.agentId, target.transport, target.endpoint);
}

function prepareRuntimeInteger(
  db: D1DatabaseLike,
  key: string,
  value: number,
  nowMs: number,
): D1PreparedStatementLike {
  return db.prepare(
    `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
     VALUES (?, NULL, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       textValue = NULL, integerValue = excluded.integerValue, updatedAt = excluded.updatedAt`,
  ).bind(key, value, nowMs);
}

function prepareRuntimeText(
  db: D1DatabaseLike,
  key: string,
  value: string,
  nowMs: number,
): D1PreparedStatementLike {
  return db.prepare(
    `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
     VALUES (?, ?, NULL, ?)
     ON CONFLICT(key) DO UPDATE SET
       textValue = excluded.textValue, integerValue = NULL, updatedAt = excluded.updatedAt`,
  ).bind(key, value, nowMs);
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
