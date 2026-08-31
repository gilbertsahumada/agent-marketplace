import type { WorkerConfig } from "./config";
import { sql } from "drizzle-orm";
import {
  catalogProbeFreshnessMs,
  catalogProbeSchedulePolicy,
  catalogProbeTimeoutMs,
} from "./catalog/probe-policy";
import type { D1DatabaseLike } from "./db/client";
import {
  createBudgetedD1Database,
  D1QueryBudgetExceededError,
  D1RowBudgetExceededError,
  type D1QueryBudget,
} from "./db/query-budget";
import { recordSchedulerAttempt } from "./db/scheduler-attempt-ledger";
import type {
  HeaderAgent,
} from "./phases/header";
import { recordDailyBudget, type DailyBudgetOutcome } from "./db/daily-budget";
import type {
  SweepAgentResult,
  SweepTargetCandidate,
} from "./phases/sweep";
import { acquireSchedulerLease, releaseSchedulerLease } from "./lib/scheduler-lease";
import { createDatabase, readRuntimeStates, writeRuntimeState } from "./db/orm";
import { runtimeState } from "./db/schema";
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
const GRID_AGENT_ID = "303779";
const GRID_ENDPOINT = "https://bnb-agent-marketplace-ruby.vercel.app/grid";
const GRID_MESSAGE_URL = "https://bnb-agent-marketplace-ruby.vercel.app/api/sellers/grid/a2a";

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
  logger?: Pick<Console, "info" | "error">;
}

export function createWp2ScheduledRunner(dependencies: ScheduledRuntimeDependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const randomUUID = dependencies.randomUUID ?? crypto.randomUUID.bind(crypto);
  const fetchImpl = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const logger = dependencies.logger ?? console;

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
    const deliveryAttempt = controller.attempt;
    const messageId = controller.messageId;
    if (deliveryAttempt !== undefined
      && (!Number.isSafeInteger(deliveryAttempt) || deliveryAttempt < 1 || deliveryAttempt > 4)) {
      throw new Error("WP2_QUEUE_ATTEMPT_INVALID");
    }
    if (deliveryAttempt !== undefined
      && (messageId === undefined || messageId.length < 1 || messageId.length > 256)) {
      throw new Error("WP2_QUEUE_MESSAGE_ID_INVALID");
    }
    let upstreamRequests = 0;
    const countedFetch: typeof fetch = (...args) => {
      if (upstreamRequests >= config.externalSubrequestsPerRun) {
        const error = new Error("external subrequest budget exhausted");
        error.name = "ProbeExternalSubrequestBudgetError";
        throw error;
      }
      upstreamRequests += 1;
      return fetchImpl(...args);
    };
    const executePhase = dependencies.executePhase
      ?? ((input: PhaseExecution) => executeWp2Phase(input, countedFetch));
    // Reserve queries for a sanitized error summary, owner-checked lease
    // release, append-only attempt ledger and raw daily ledger.
    const rowUsage = { rowsRead: 0, rowsWritten: 0 };
    const rowBudget = {
      rowsRead: config.d1RowsReadPerRun,
      rowsWritten: config.d1RowsWrittenPerRun,
    };
    const phaseStore = createBudgetedD1Database(
      rawDb,
      config.d1QueriesPerRun - 4,
      rowBudget,
      rowUsage,
    );
    // Cleanup remains executable after a phase crosses its observed row cap.
    // It shares the counter but not the post-query abort rule.
    const auxiliaryStore = createBudgetedD1Database(rawDb, 3, undefined, rowUsage);
    const { db, budget, usage } = phaseStore;
    const finalizeAttempt = async (input: {
      readonly finishedAt: number;
      readonly phase: SchedulerPhase | null;
      readonly outcome: DailyBudgetOutcome;
      readonly errorCode: string | null;
    }): Promise<void> => {
      const d1Queries = budget.used + auxiliaryStore.budget.used
        + (deliveryAttempt === undefined ? 1 : 2);
      const rowsReadObservedBeforeLedger = usage.rowsRead;
      const rowsWrittenObservedBeforeLedger = usage.rowsWritten;
      let attemptError: unknown;
      try {
        if (deliveryAttempt !== undefined) await recordSchedulerAttempt(auxiliaryStore.db, {
          messageId: messageId!,
          scheduledTime: controller.scheduledTime,
          attempt: deliveryAttempt,
          phase: input.phase,
          outcome: input.outcome,
          startedAt,
          finishedAt: input.finishedAt,
          upstreamRequests,
          d1Queries,
          rowsReadObservedBeforeLedger,
          rowsWrittenObservedBeforeLedger,
          errorCode: input.errorCode,
        });
      } catch (error) {
        attemptError = error;
      }
      await bestEffort(() => recordDailyBudget(rawDb, {
        startedAtMs: startedAt,
        finishedAtMs: input.finishedAt,
        outcome: input.outcome,
        upstreamRequests,
        d1Queries,
        rowsReadObservedBeforeLedger,
        rowsWrittenObservedBeforeLedger,
      }));
      logger.info("wp2.scheduler.attempt", {
        runId,
        messageId: messageId ?? null,
        deliveryAttempt: deliveryAttempt ?? null,
        scheduledTime: controller.scheduledTime,
        phase: input.phase,
        outcome: input.outcome,
        errorCode: input.errorCode,
        upstreamRequests,
        d1Queries,
        rowsRead: rowsReadObservedBeforeLedger,
        rowsWritten: rowsWrittenObservedBeforeLedger,
        wallTimeMs: Math.max(0, input.finishedAt - startedAt),
        budgetProfile: config.plan,
        configurationVersion: config.catalogV2WritesEnabled ? "catalog_v2" : "wp2_legacy",
      });
      if (attemptError !== undefined) throw attemptError;
    };
    let acquired: boolean;
    try {
      acquired = await acquireSchedulerLease(db, {
        runId,
        nowMs: startedAt,
        expiresAtMs: startedAt + leaseMs,
      });
    } catch (error) {
      const finishedAt = now();
      await bestEffort(() => writeRuntimeState(createDatabase(auxiliaryStore.db), {
        key: "last_scheduler_summary",
        textValue: JSON.stringify({
        status: "error",
        errorCode: phaseErrorCode(error),
        requests: 0,
        d1Queries: budget.used + 3,
        wallTimeMs: Math.max(0, finishedAt - startedAt),
        }),
        integerValue: null,
        updatedAt: finishedAt,
      }));
      await bestEffort(() => releaseSchedulerLease(auxiliaryStore.db, runId, finishedAt));
      await finalizeAttempt({
        finishedAt,
        phase: null,
        outcome: "failed",
        errorCode: phaseErrorCode(error),
      });
      throw error;
    }

    if (!acquired) {
      const finishedAt = now();
      await bestEffort(() => writeRuntimeState(createDatabase(auxiliaryStore.db), {
        key: "last_scheduler_summary",
        textValue: JSON.stringify({
        status: "skipped_locked",
        requests: 0,
        wallTimeMs: Math.max(0, finishedAt - startedAt),
        }),
        integerValue: null,
        updatedAt: finishedAt,
      }));
      await finalizeAttempt({ finishedAt, phase: null, outcome: "locked", errorCode: null });
      return "locked";
    }

    let phase: SchedulerPhase | null = null;
    let outcome: DailyBudgetOutcome = "failed";
    let attemptErrorCode: string | null = null;
    try {
      let stateRows: PhaseStateRow[];
      try {
        stateRows = await readRuntimeStates(createDatabase(db), [
          "next_scheduler_phase", "header_high_water", "last_queue_scheduled_time",
        ]) as PhaseStateRow[];
      } catch (error) {
        if (error instanceof Error
          && (error.cause instanceof D1QueryBudgetExceededError
            || error.cause instanceof D1RowBudgetExceededError)) throw error.cause;
        throw error;
      }
      const state = new Map(stateRows.map((row) => [row.key, row]));
      const completedQueueScheduledTime = state.get("last_queue_scheduled_time")?.integerValue;
      if (controller.cron === "queue"
        && completedQueueScheduledTime !== undefined
        && completedQueueScheduledTime !== null
        && completedQueueScheduledTime >= controller.scheduledTime) {
        outcome = "duplicate";
        return "duplicate";
      }
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
      outcome = "completed";
      return "completed";
    } catch (error) {
      const finishedAt = now();
      attemptErrorCode = phaseErrorCode(error);
      try {
        await persistPhaseFailure(auxiliaryStore.db, {
          phase: phase ?? "header",
          errorCode: attemptErrorCode,
          requests: upstreamRequests,
          d1Queries: budget.used + 3,
          wallTimeMs: Math.max(0, finishedAt - startedAt),
          finishedAt,
        });
      } catch {
        // Preserve the original failure. The owner-checked lease release below
        // still runs even if D1 cannot record the sanitized error summary.
      }
      throw error;
    } finally {
      const finishedAt = now();
      await bestEffort(() => releaseSchedulerLease(auxiliaryStore.db, runId, finishedAt));
      await finalizeAttempt({
        finishedAt,
        phase: outcome === "duplicate" ? null : phase,
        outcome,
        errorCode: attemptErrorCode,
      });
    }
  };
}

async function bestEffort(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch {
    // Completion markers protect phase correctness. Cleanup and reconciliation
    // must not turn completed work into a Queue retry or replace its root error.
  }
}

async function executeWp2Phase(input: PhaseExecution, fetchImpl: typeof fetch): Promise<void> {
  const catalog = new Trust8004CatalogClient({
    baseUrl: input.env.TRUST8004_BASE_URL ?? "https://trust8004.xyz/api/app",
    timeoutMs: input.config.probeTimeoutMs,
    maxResponseBytes: input.config.maxCatalogResponseBytes,
    fetch: fetchImpl,
  });
  if (input.config.catalogV2WritesEnabled) {
    await executeCatalogV2Phase(input, catalog, fetchImpl);
    return;
  }
  if (input.config.plan !== "free") throw new Error("WP2_PAID_PIPELINE_NOT_VALIDATED");
  if (input.phase === "header") {
    const { createD1HeaderPersistence, runHeader } = await import("./phases/header");
    let headerCatalogAgents: CatalogAgent[] = [];
    await runHeader({
      fetchNewestPage: async (limit) => {
        const page = await catalog.listHeader(limit);
        const items = page.items.filter((agent) => agent.registeredAt !== null);
        headerCatalogAgents = items;
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
      invocationQueriesAfterCommit: 2,
      startedAtMs: input.startedAtMs,
      ...(input.completedQueueScheduledTime === undefined
        ? {}
        : { completedQueueScheduledTime: input.completedQueueScheduledTime }),
    });
    try {
      const { syncCatalogHeaderCandidates } = await import("./phases/catalog-header-index");
      const catalogSummary = await syncCatalogHeaderCandidates(input.db, headerCatalogAgents, input.nowMs);
      console.info("catalog.header.completed", catalogSummary);
    } catch (error) {
      console.error("catalog.header.failed", { errorCode: catalogProbeErrorCode(error) });
    }
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
      rowWriteBudget: { remaining: input.config.d1RowsWrittenPerRun - 1 },
      invocationQueriesAfterCommit: 2,
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

  const [
    { createCountedBscClient, readProbeChainContext },
    { validateProbeQuote },
    { probeA2aSeller, probeErc8183HttpSeller, SellerProbeError },
    { buildReadinessProbeRequest },
    { createD1ProbePersistence },
    { runProbePhase },
  ] = await Promise.all([
    import("./lib/chain"),
    import("./lib/quote"),
    import("./lib/seller-client"),
    import("./lib/terms"),
    import("./phases/probe-d1"),
    import("./phases/probe"),
  ]);
  let phaseRequests = 0;
  const probeFetch: typeof fetch = (...args) => {
    if (phaseRequests >= input.config.externalSubrequestsPerRun) {
      const error = new Error("PROBE external subrequest budget exhausted");
      error.name = "ProbeExternalSubrequestBudgetError";
      throw error;
    }
    phaseRequests += 1;
    return fetchImpl(...args);
  };
  const deadlineMs = input.nowMs + input.config.probeTimeoutMs;
  let currentChain: Awaited<ReturnType<typeof readProbeChainContext>> | null = null;
  let publicClient: ReturnType<typeof createCountedBscClient> | null = null;
  const persistence = createD1ProbePersistence(input.db, {
    queryBudget: input.queryBudget,
    nowMs: input.nowMs,
    ...(input.completedQueueScheduledTime === undefined
      ? {}
      : { completedQueueScheduledTime: input.completedQueueScheduledTime }),
  });
  await runProbePhase({
    agentAllowlist: input.config.probeAgentAllowlist,
    endpointAllowlist: input.config.probeEndpointAllowlist,
    limit: input.config.probeBatchSize,
    nowMs: input.nowMs,
    startedAtMs: input.startedAtMs,
    now: input.now,
    requestCount: () => phaseRequests,
  }, {
    ...persistence,
    refreshTarget: async (target) => {
      const remainingMs = Math.floor(deadlineMs - input.now());
      if (remainingMs <= 0) return { status: "metadata_unavailable" };
      const probeCatalog = new Trust8004CatalogClient({
        baseUrl: input.env.TRUST8004_BASE_URL ?? "https://trust8004.xyz/api/app",
        timeoutMs: remainingMs,
        maxResponseBytes: input.config.maxCatalogResponseBytes,
        fetch: probeFetch,
      });
      let agent: CatalogAgent;
      try {
        agent = await probeCatalog.getAgent(target.agentId);
      } catch {
        return { status: "metadata_unavailable" };
      }
      if (!agent.metadataAvailable) return { status: "metadata_unavailable" };
      const current = selectLiveTargets(agent, { curatedAgentIds: CURATED_ID_SET })
        .some((candidate) => (
          candidate.transport === target.transport && candidate.endpoint === target.endpoint
        ));
      return current
        ? { status: "current", metadataUpdatedAt: agent.metadataUpdatedAt }
        : { status: "removed" };
    },
    readChainContext: async (target) => {
      if (!input.env.BSC_RPC_URL) throw new Error("BSC_RPC_URL_REQUIRED");
      publicClient = createCountedBscClient({
        rpcUrl: input.env.BSC_RPC_URL,
        fetch: probeFetch,
        deadlineMs,
        now: input.now,
      });
      currentChain = await readProbeChainContext(publicClient, {
        agentId: target.agentId,
        nowSeconds: Math.floor(input.now() / 1_000),
      });
      return currentChain;
    },
    probeSeller: async (target, chain, category) => {
      const remainingMs = Math.floor(deadlineMs - input.now());
      if (remainingMs <= 0) throw new SellerProbeError("SELLER_TIMEOUT");
      const probe = target.transport === "a2a" ? probeA2aSeller : probeErc8183HttpSeller;
      return probe({
        endpoint: target.endpoint,
        request: buildReadinessProbeRequest(category).request.toDict(),
        timeoutMs: remainingMs,
        maxResponseBytes: input.config.maxSellerResponseBytes,
        fetch: probeFetch,
        now: input.now,
        ...(target.transport === "a2a"
          && target.agentId === GRID_AGENT_ID
          && target.endpoint === GRID_ENDPOINT
          ? { expectedA2aMessageUrl: GRID_MESSAGE_URL }
          : {}),
        ...(target.transport === "erc8183_http" ? { expectedHttpStatus: {
          provider: chain.provider,
          commerce: chain.commerce!,
          router: chain.router!,
          policy: chain.policy!,
          currency: currentChain!.paymentToken,
          decimals: currentChain!.tokenDecimals,
        } } : {}),
      });
    },
    validateQuote: async (quote, _chain, category) => {
      if (!currentChain || !publicClient) throw new Error("BSC_CONTEXT_REQUIRED");
      if (input.now() >= deadlineMs) throw new SellerProbeError("SELLER_TIMEOUT");
      const verdict = await validateProbeQuote(quote, {
        ...currentChain,
        publicClient,
        nowSeconds: Math.floor(input.now() / 1_000),
        probeCategory: category,
      });
      if (input.now() >= deadlineMs) throw new SellerProbeError("SELLER_TIMEOUT");
      return verdict;
    },
  });
  if (input.config.catalogProbeEnabled) {
    try {
      const [
        { probeCatalogEndpoint, runCatalogProbePhase },
        { createD1CatalogProbePersistence },
      ] = await Promise.all([
        import("./phases/catalog-probe"),
        import("./phases/catalog-probe-d1"),
      ]);
      const catalogPersistence = createD1CatalogProbePersistence(
        input.db,
        catalogProbeSchedulePolicy(input.config),
      );
      const catalogSummary = await runCatalogProbePhase({
        limit: input.config.catalogProbeBatchSize,
        concurrency: input.config.catalogProbeConcurrency,
        nowMs: input.nowMs,
        timeoutMs: Math.min(5_000, input.config.probeTimeoutMs),
      }, {
        ...catalogPersistence,
        onAttempt: (attempt) => console.info("catalog.probe.attempt", attempt),
        probe: (target) => probeCatalogEndpoint(target, {
          fetchImpl: probeFetch,
          timeoutMs: catalogProbeTimeoutMs(input.config, target.protocol),
          freshnessMs: catalogProbeFreshnessMs(input.config, target),
          now: input.now,
        }),
      });
      console.info("catalog.probe.completed", {
        processedTargets: catalogSummary.processedTargets,
        outcomes: catalogSummary.outcomes,
      });
    } catch (error) {
      // The legacy seller probe remains the completion gate. Generic catalog
      // validation is best-effort and records its own attempt only on commit.
      console.error("catalog.probe.failed", {
        errorCode: catalogProbeErrorCode(error),
      });
    }
  }
}

async function executeCatalogV2Phase(
  input: PhaseExecution,
  catalog: Trust8004CatalogClient,
  fetchImpl: typeof fetch,
): Promise<void> {
  const [
    { catalogIngestTaskLimitForBudget, enqueueCatalogDiscoveryPage, processNextCatalogIngestTask },
    { probeCatalogEndpoint, runCatalogProbePhase },
    { createD1CatalogProbePersistence },
  ] = await Promise.all([
    import("./phases/catalog-ingest"),
    import("./phases/catalog-probe"),
    import("./phases/catalog-probe-d1"),
  ]);
  const pageSize = input.config.catalogDiscoveryPageSize;
  const newest = await catalog.listHeader(pageSize);
  const pageHighWater = catalogHeaderHighWater(newest.items);
  const headerHighWater = maximumCatalogHighWater(input.headerHighWater, pageHighWater);
  const discovery = [await enqueueCatalogDiscoveryPage(input.db, newest.items, {
    nowMs: input.nowMs,
    source: "header",
    ...(headerHighWater === null ? {} : { headerHighWater }),
  })];

  if (input.phase === "sweep") {
    const rows = await readRuntimeStates(createDatabase(input.db), ["catalog_sweep_offset"]);
    const offset = rows[0]?.integerValue ?? 0;
    const page = await catalog.listSweepPage(pageSize, offset);
    const nextOffset = offset + page.items.length >= page.total ? 0 : offset + page.items.length;
    discovery.push(await enqueueCatalogDiscoveryPage(input.db, page.items, {
      nowMs: input.nowMs,
      source: "sweep",
      cursor: nextOffset,
      cursorKey: "catalog_sweep_offset",
    }));
  }

  const discoveryWrites = discovery.reduce((total, summary) => total + summary.d1RowsWritten, 0);
  const ingestSummaries = [];
  const probeQueryReserve = input.phase === "probe" && input.config.catalogProbeEnabled
    ? 1 + (4 * input.config.catalogProbeBatchSize)
    : 0;
  const ingestTaskLimit = discoveryWrites <= 20
    ? catalogIngestTaskLimitForBudget({
        remainingQueries: input.queryBudget.remaining,
        maxDeclarations: input.config.catalogDeclarationsPerTask,
        requestedTasks: input.config.catalogIngestTasksPerRun,
        reserveQueries: 1 + probeQueryReserve,
      })
    : 0;
  if (discoveryWrites <= 20) {
    for (let index = 0; index < ingestTaskLimit; index += 1) {
      const summary = await processNextCatalogIngestTask(input.db, {
        nowMs: input.now(),
        maxDeclarations: input.config.catalogDeclarationsPerTask,
        fetchAgent: (agentId) => catalog.getAgent(agentId),
      });
      ingestSummaries.push(summary);
      if (summary.status === "idle") break;
    }
  }

  let probeSummary: Awaited<ReturnType<typeof runCatalogProbePhase>> | null = null;
  if (input.phase === "probe" && input.config.catalogProbeEnabled) {
    const persistence = createD1CatalogProbePersistence(
      input.db,
      catalogProbeSchedulePolicy(input.config),
    );
    probeSummary = await runCatalogProbePhase({
      limit: input.config.catalogProbeBatchSize,
      concurrency: input.config.catalogProbeConcurrency,
      nowMs: input.nowMs,
      timeoutMs: Math.min(5_000, input.config.probeTimeoutMs),
    }, {
      ...persistence,
      onAttempt: (attempt) => console.info("catalog.probe.attempt", attempt),
      probe: (target) => probeCatalogEndpoint(target, {
        fetchImpl,
        timeoutMs: catalogProbeTimeoutMs(input.config, target.protocol),
        freshnessMs: catalogProbeFreshnessMs(input.config, target),
        now: input.now,
      }),
    });
  }

  const nextPhase: SchedulerPhase = input.phase === "header" ? "sweep"
    : input.phase === "sweep" ? "probe" : "header";
  const finishedAt = input.now();
  const summary = {
    phase: input.phase,
    status: "ok",
    mode: "catalog_v2",
    discovery,
    ingest: ingestSummaries,
    ingestBudgetDeferred: ingestTaskLimit < input.config.catalogIngestTasksPerRun,
    probe: probeSummary,
    wallTimeMs: Math.max(0, finishedAt - input.startedAtMs),
  };
  const db = createDatabase(input.db);
  await db.insert(runtimeState).values([
    {
      key: `last_${input.phase}_summary`,
      textValue: JSON.stringify(summary),
      integerValue: null,
      updatedAt: finishedAt,
    },
    {
      key: "next_scheduler_phase",
      textValue: nextPhase,
      integerValue: null,
      updatedAt: finishedAt,
    },
    ...(input.completedQueueScheduledTime === undefined ? [] : [{
      key: "last_queue_scheduled_time",
      textValue: null,
      integerValue: input.completedQueueScheduledTime,
      updatedAt: finishedAt,
    }]),
  ]).onConflictDoUpdate({
    target: runtimeState.key,
    set: {
      textValue: sql.raw("excluded.textValue"),
      integerValue: sql.raw("excluded.integerValue"),
      updatedAt: sql.raw("excluded.updatedAt"),
    },
  });
  console.info("catalog.v2.phase.completed", summary);
}

function catalogHeaderHighWater(agents: readonly CatalogAgent[]): string | null {
  let highest: { registeredAt: number; agentId: string } | null = null;
  for (const agent of agents) {
    if (agent.registeredAt === null) continue;
    const current = { registeredAt: agent.registeredAt, agentId: agent.agentId };
    if (highest === null || compareCatalogHighWater(current, highest) > 0) highest = current;
  }
  return highest === null ? null : `${highest.registeredAt}:${highest.agentId}`;
}

function maximumCatalogHighWater(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return compareCatalogHighWater(parseCatalogHighWater(left), parseCatalogHighWater(right)) >= 0 ? left : right;
}

function parseCatalogHighWater(value: string): { registeredAt: number; agentId: string } {
  const separator = value.indexOf(":");
  if (separator < 1) throw new Error("CATALOG_STATE:header_high_water");
  const registeredAt = Number(value.slice(0, separator));
  const agentId = value.slice(separator + 1);
  if (!Number.isSafeInteger(registeredAt) || registeredAt < 0 || !/^\d+$/.test(agentId)) {
    throw new Error("CATALOG_STATE:header_high_water");
  }
  return { registeredAt, agentId };
}

function compareCatalogHighWater(
  left: { registeredAt: number; agentId: string },
  right: { registeredAt: number; agentId: string },
): number {
  if (left.registeredAt !== right.registeredAt) return left.registeredAt - right.registeredAt;
  const leftId = BigInt(left.agentId);
  const rightId = BigInt(right.agentId);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function catalogProbeErrorCode(error: unknown): string {
  if (error instanceof D1QueryBudgetExceededError) return "CATALOG_D1_QUERY_BUDGET";
  if (error instanceof D1RowBudgetExceededError) return "CATALOG_D1_ROW_BUDGET";
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)) return error.message;
  return "CATALOG_PROBE_FAILED";
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
  await writeRuntimeState(createDatabase(db), {
    key: `last_${input.phase}_summary`,
    textValue: JSON.stringify({
      phase: input.phase,
      status: "error",
      requests: input.requests,
      d1Queries: input.d1Queries,
      wallTimeMs: input.wallTimeMs,
      errorCode: input.errorCode,
    }),
    integerValue: null,
    updatedAt: input.finishedAt,
  });
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
    || hasErrorName(
      error,
      "HeaderQueryBudgetExceededError",
      "SweepQueryBudgetExceededError",
      "ProbeQueryBudgetExceededError",
    )) {
    return "D1_QUERY_BUDGET";
  }
  if (error instanceof D1RowBudgetExceededError) return "D1_ROW_BUDGET";
  if (hasErrorName(error, "SweepRequestBudgetExceededError")) return "TRUST8004_REQUEST_BUDGET";
  if (hasErrorName(error, "ProbeExternalSubrequestBudgetError")) {
    return "EXTERNAL_SUBREQUEST_BUDGET";
  }
  return "PHASE_FAILED";
}

function hasErrorName(error: unknown, ...names: readonly string[]): boolean {
  return error instanceof Error && names.includes(error.name);
}

export const runWp2Scheduled = createWp2ScheduledRunner();
