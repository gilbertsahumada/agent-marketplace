import type { WorkerConfig } from "./config";
import { executeBatch, prepareStatement, type D1DatabaseLike } from "./db/client";
import {
  createBudgetedD1Database,
  D1QueryBudgetExceededError,
  type D1QueryBudget,
} from "./db/query-budget";
import type {
  HeaderAgent,
} from "./phases/header";
import type {
  SweepAgentResult,
  SweepTargetCandidate,
} from "./phases/sweep";
import { acquireSchedulerLease, releaseSchedulerLease } from "./lib/scheduler-lease";
import { CURATED_INVENTORY, CURATED_INVENTORY_CATEGORIES } from "./manifest/curated-inventory";
import { selectLiveTargets } from "./trust8004/candidates";
import {
  CatalogBodyLimitError,
  CatalogHttpError,
  CatalogInvalidJsonError,
  CatalogRedirectError,
  CatalogTimeoutError,
  Trust8004CatalogClient,
} from "./trust8004/client";
import type { CatalogAgent } from "./trust8004/types";
import type { Env, ExecutionContext, ScheduledController } from "./types";

const FREE_LEASE_MS = 4 * 60_000;
const PAID_LEASE_MS = 14 * 60_000;
const CURATED_IDS = CURATED_INVENTORY.entries.map(({ agentId }) => agentId);
const CURATED_ID_SET = new Set(CURATED_IDS);

export type SchedulerPhase = "header" | "sweep" | "probe";
export type ScheduledRunResult = "completed" | "duplicate" | "locked";

interface PhaseStateRow {
  readonly key: string;
  readonly textValue: string | null;
  readonly integerValue: number | null;
}

interface PhaseExecution {
  readonly phase: SchedulerPhase;
  readonly db: D1DatabaseLike;
  readonly queryBudget: D1QueryBudget;
  readonly env: Env;
  readonly config: WorkerConfig;
  readonly nowMs: number;
  readonly startedAtMs: number;
  readonly now: () => number;
  readonly headerHighWater: string | null;
  readonly completedQueueScheduledTime?: number;
}

export interface ScheduledRuntimeDependencies {
  now?: () => number;
  randomUUID?: () => string;
  fetch?: typeof fetch;
  executePhase?: (input: PhaseExecution) => Promise<void>;
}

export function createWp2ScheduledRunner(dependencies: ScheduledRuntimeDependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const randomUUID = dependencies.randomUUID ?? crypto.randomUUID.bind(crypto);
  const fetchImpl = dependencies.fetch ?? globalThis.fetch.bind(globalThis);

  return async function runWp2Scheduled(
    controller: ScheduledController,
    env: Env,
    _context: ExecutionContext,
    config: WorkerConfig,
  ): Promise<ScheduledRunResult> {
    const startedAt = now();
    const runId = randomUUID();
    const leaseMs = config.plan === "free" ? FREE_LEASE_MS : PAID_LEASE_MS;
    const rawDb = env.DB as unknown as D1DatabaseLike;
    let upstreamRequests = 0;
    const countedFetch: typeof fetch = (...args) => {
      upstreamRequests += 1;
      return fetchImpl(...args);
    };
    const executePhase = dependencies.executePhase
      ?? ((input: PhaseExecution) => executeWp2Phase(input, countedFetch));
    // Reserve raw queries for a sanitized error summary and an owner-checked
    // lease release before the platform hard limit.
    const { db, budget } = createBudgetedD1Database(rawDb, config.d1QueriesPerRun - 2);
    const acquired = await acquireSchedulerLease(db, {
      runId,
      nowMs: startedAt,
      expiresAtMs: startedAt + leaseMs,
    });

    if (!acquired) {
      const finishedAt = now();
      await db.prepare(
        `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
         VALUES ('last_scheduler_summary', ?, NULL, ?)
         ON CONFLICT(key) DO UPDATE SET
           textValue = excluded.textValue,
           integerValue = NULL,
           updatedAt = excluded.updatedAt`,
      ).bind(JSON.stringify({
        status: "skipped_locked",
        requests: 0,
        wallTimeMs: Math.max(0, finishedAt - startedAt),
      }), finishedAt).run();
      return "locked";
    }

    let phase: SchedulerPhase = "header";
    try {
      const stateResult = await db.prepare(
        `SELECT key, textValue, integerValue
         FROM runtime_state
         WHERE key IN ('next_scheduler_phase', 'header_high_water', 'last_queue_scheduled_time')`,
      ).all<PhaseStateRow>();
      if (!stateResult.success) throw new Error("Could not read scheduler phase state");
      const state = new Map((stateResult.results ?? []).map((row) => [row.key, row]));
      const completedQueueScheduledTime = state.get("last_queue_scheduled_time")?.integerValue;
      if (controller.cron === "queue"
        && completedQueueScheduledTime !== undefined
        && completedQueueScheduledTime !== null
        && completedQueueScheduledTime >= controller.scheduledTime) return "duplicate";
      phase = parsePhase(state.get("next_scheduler_phase")?.textValue);
      await executePhase({
        phase,
        db,
        queryBudget: budget,
        env,
        config,
        nowMs: now(),
        startedAtMs: startedAt,
        now,
        headerHighWater: state.get("header_high_water")?.textValue ?? null,
        ...(controller.cron === "queue"
          ? { completedQueueScheduledTime: controller.scheduledTime }
          : {}),
      });
      return "completed";
    } catch (error) {
      const finishedAt = now();
      try {
        await persistPhaseFailure(rawDb, {
          phase,
          errorCode: phaseErrorCode(error),
          requests: upstreamRequests,
          d1Queries: budget.used + 2,
          wallTimeMs: Math.max(0, finishedAt - startedAt),
          finishedAt,
        });
      } catch {
        // Preserve the original failure. The owner-checked lease release below
        // still runs even if D1 cannot record the sanitized error summary.
      }
      throw error;
    } finally {
      await releaseSchedulerLease(rawDb, runId, now());
    }
  };
}

async function executeWp2Phase(input: PhaseExecution, fetchImpl: typeof fetch): Promise<void> {
  if (input.config.plan !== "free") throw new Error("WP2_PAID_PIPELINE_NOT_VALIDATED");
  const catalog = new Trust8004CatalogClient({
    baseUrl: input.env.TRUST8004_BASE_URL ?? "https://trust8004.xyz/api/app",
    timeoutMs: input.config.probeTimeoutMs,
    maxResponseBytes: input.config.maxCatalogResponseBytes,
    fetch: fetchImpl,
  });
  if (input.phase === "header") {
    const { createD1HeaderPersistence, runHeader } = await import("./phases/header");
    await runHeader({
      fetchNewestPage: async (limit) => {
        const page = await catalog.listHeader(limit);
        const items = page.items.filter((agent) => agent.registeredAt !== null);
        return {
          items,
          received: page.items.length + page.invalidItems.length,
          invalidItems: page.invalidItems.length + page.items.length - items.length,
        };
      },
      parseAgent: (value) => toHeaderAgent(value as CatalogAgent, CURATED_ID_SET),
      persistence: createD1HeaderPersistence(input.db),
      queryBudget: input.queryBudget,
      now: input.now,
    }, {
      limit: input.config.headerLimit,
      previousHighWater: input.headerHighWater,
      reserveQueriesAfterCommit: 0,
      invocationQueriesAfterCommit: 1,
      startedAtMs: input.startedAtMs,
      ...(input.completedQueueScheduledTime === undefined
        ? {}
        : { completedQueueScheduledTime: input.completedQueueScheduledTime }),
    });
    return;
  }

  if (input.phase === "sweep") {
    const { createD1LiveAgentPageReader, runSweepPhase } = await import("./phases/sweep");
    await runSweepPhase({
      db: input.db,
      limit: input.config.sweepLimit,
      nowMs: input.nowMs,
      queryBudget: input.queryBudget,
      requestBudget: { remaining: input.config.trust8004RequestsPerRun },
      invocationQueriesAfterCommit: 1,
      startedAtMs: input.startedAtMs,
      ...(input.completedQueueScheduledTime === undefined
        ? {}
        : { completedQueueScheduledTime: input.completedQueueScheduledTime }),
      now: input.now,
    }, {
      listLiveAgentPage: createD1LiveAgentPageReader(input.db, CURATED_IDS),
      fetchAgents: async ({ agentIds }) => {
        const results: SweepAgentResult[] = [];
        for (const agentId of agentIds) {
          results.push(toSweepResult(await catalog.getAgent(agentId), CURATED_ID_SET));
        }
        return results;
      },
    });
    return;
  }

  // WP2 keeps the state machine moving but never contacts a seller. WP3
  // replaces this explicit pending phase with the allowlisted probe.
  const finishedAt = input.now();
  const completionStatements = input.completedQueueScheduledTime === undefined
    ? []
    : [prepareStatement(input.db,
        `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
         VALUES ('last_queue_scheduled_time', NULL, ?, ?)
         ON CONFLICT(key) DO UPDATE SET textValue=NULL,
           integerValue=excluded.integerValue, updatedAt=excluded.updatedAt`,
        [input.completedQueueScheduledTime, finishedAt])];
  const probeBatchQueries = 2 + completionStatements.length;
  await executeBatch(input.db, [
    prepareStatement(input.db,
      `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
       VALUES ('last_probe_summary', ?, NULL, ?)
       ON CONFLICT(key) DO UPDATE SET textValue=excluded.textValue,
         integerValue=NULL, updatedAt=excluded.updatedAt`,
      [JSON.stringify({
        phase: "probe",
        status: "pending_wp3",
        requests: 0,
        d1Queries: input.queryBudget.used + probeBatchQueries + 1,
        wallTimeMs: Math.max(0, finishedAt - input.startedAtMs),
      }), finishedAt]),
    prepareStatement(input.db,
      `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
       VALUES ('next_scheduler_phase', 'header', NULL, ?)
       ON CONFLICT(key) DO UPDATE SET textValue='header',
         integerValue=NULL, updatedAt=excluded.updatedAt`,
      [finishedAt]),
    ...completionStatements,
  ]);
}

function toHeaderAgent(agent: CatalogAgent, curatedIds: ReadonlySet<string>): HeaderAgent {
  if (agent.registeredAt === null) throw new Error("HEADER_MISSING_REGISTERED_AT");
  return {
    chainId: 56,
    agentId: agent.agentId,
    registeredAt: agent.registeredAt,
    name: agent.name,
    metadataUpdatedAt: agent.metadataUpdatedAt,
    declaresErc8183: agent.declarations.erc8183,
    targets: selectLiveTargets(agent, { curatedAgentIds: curatedIds }),
  };
}

function toSweepResult(agent: CatalogAgent, curatedIds: ReadonlySet<string>): SweepAgentResult {
  if (!agent.metadataAvailable) {
    return { status: "metadata_unavailable", agentId: agent.agentId };
  }
  const categories = curatedCategories(agent.agentId);
  const targets: SweepTargetCandidate[] = selectLiveTargets(agent, {
    curatedAgentIds: curatedIds,
  }).map(({ transport, endpoint }) => ({
    transport,
    endpoint,
    categoriesJson: JSON.stringify(categories),
    categoryProvenance: categories.length > 0 ? "derived:marketplace-inventory" : null,
  }));
  return {
    status: "ok",
    agentId: agent.agentId,
    name: agent.name,
    metadataUpdatedAt: agent.metadataUpdatedAt,
    targets,
  };
}

function curatedCategories(agentId: string): string[] {
  const entry = CURATED_INVENTORY.entries.find((candidate) => candidate.agentId === agentId);
  const assigned = new Set(entry?.categories.map(({ category }) => category) ?? []);
  return CURATED_INVENTORY_CATEGORIES.filter((category) => assigned.has(category));
}

function parsePhase(value: string | null | undefined): SchedulerPhase {
  return value === "sweep" || value === "probe" ? value : "header";
}

async function persistPhaseFailure(db: D1DatabaseLike, input: {
  readonly phase: SchedulerPhase;
  readonly errorCode: string;
  readonly requests: number;
  readonly d1Queries: number;
  readonly wallTimeMs: number;
  readonly finishedAt: number;
}): Promise<void> {
  const result = await db.prepare(
    `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
     VALUES (?, ?, NULL, ?)
     ON CONFLICT(key) DO UPDATE SET
       textValue = excluded.textValue,
       integerValue = NULL,
       updatedAt = excluded.updatedAt`,
  ).bind(
    `last_${input.phase}_summary`,
    JSON.stringify({
      phase: input.phase,
      status: "error",
      requests: input.requests,
      d1Queries: input.d1Queries,
      wallTimeMs: input.wallTimeMs,
      errorCode: input.errorCode,
    }),
    input.finishedAt,
  ).run();
  if (!result.success) throw new Error("Could not persist phase failure summary");
}

function phaseErrorCode(error: unknown): string {
  if (error instanceof CatalogTimeoutError) return "TRUST8004_TIMEOUT";
  if (error instanceof CatalogBodyLimitError) return "TRUST8004_RESPONSE_TOO_LARGE";
  if (error instanceof CatalogRedirectError) return "TRUST8004_REDIRECT";
  if (error instanceof CatalogInvalidJsonError) return "TRUST8004_INVALID_JSON";
  if (error instanceof CatalogHttpError) return error.status === 429
    ? "TRUST8004_HTTP_429"
    : "TRUST8004_HTTP_ERROR";
  if (error instanceof D1QueryBudgetExceededError
    || hasErrorName(error, "HeaderQueryBudgetExceededError", "SweepQueryBudgetExceededError")) {
    return "D1_QUERY_BUDGET";
  }
  if (hasErrorName(error, "SweepRequestBudgetExceededError")) return "TRUST8004_REQUEST_BUDGET";
  return "PHASE_FAILED";
}

function hasErrorName(error: unknown, ...names: readonly string[]): boolean {
  return error instanceof Error && names.includes(error.name);
}

export const runWp2Scheduled = createWp2ScheduledRunner();
