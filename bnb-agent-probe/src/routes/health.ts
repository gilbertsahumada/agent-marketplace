import { sql } from "drizzle-orm";
import type { WorkerConfig } from "../config";
import type { D1Database } from "../types";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase, readRuntimeStates } from "../db/orm";

type RuntimeRow = {
  key: string;
  textValue: string | null;
  integerValue: number | null;
  updatedAt: number;
};

type SafeSummary = {
  phase?: "header" | "sweep" | "probe";
  status?: string;
  requests?: number;
  cpuMs?: number;
  wallTimeMs?: number;
  d1Queries?: number;
  d1RowsWritten?: number;
  errorCode?: string;
  headerWindowExhausted?: boolean;
  complete?: boolean;
  previousOffset?: number;
  nextOffset?: number;
  sweepRound?: number;
  processedAgents?: number;
  candidatesRead?: number;
  changedTargets?: number;
  removedTargets?: number;
  metadataUnavailableTargets?: number;
  materialWrites?: number;
  candidateTargets?: number;
  invalidItems?: number;
  processedTargets?: number;
  fromBlock?: number;
  toBlock?: number;
  window?: number;
  logs?: number;
  jobs?: number;
  jobsFailed?: number;
  httpStatus?: number;
  outcome?: string;
};

type HealthOptions = {
  readonly quoteQueueAvailable?: boolean;
  readonly rpcConfigured?: { readonly 56: boolean; readonly 97: boolean };
};

type DailyBudget = {
  schemaVersion: 1;
  utcDate: string;
  measurementScope: "worker_metered_before_daily_ledger";
  updatedAt: number;
  invocations: number;
  completed: number;
  failed: number;
  duplicate: number;
  locked: number;
  upstreamRequests: number;
  d1Queries: number;
  rowsReadObservedBeforeLedger: number;
  rowsWrittenObservedBeforeLedger: number;
};

const RUNTIME_KEYS = [
  "scheduler_lease",
  "sweep_offset",
  "header_high_water",
  "last_header_summary",
  "last_sweep_summary",
  "last_probe_summary",
  "last_scheduler_summary",
  "next_scheduler_phase",
  "sweep_round",
  "commerce_cursor_56",
  "commerce_cursor_97",
  "last_index_summary_56",
  "last_index_summary_97",
] as const;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function safeSummary(row: RuntimeRow | undefined): SafeSummary | null {
  if (!row?.textValue) return null;
  try {
    const parsed: unknown = JSON.parse(row.textValue);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const source = parsed as Record<string, unknown>;
    const result: SafeSummary = {};
    if (source.phase === "header" || source.phase === "sweep" || source.phase === "probe") {
      result.phase = source.phase;
    }
    if (typeof source.status === "string" && /^[a-z_]{1,32}$/.test(source.status)) {
      result.status = source.status;
    }
    const requests = finiteNonNegative(source.requests);
    const cpuMs = finiteNonNegative(source.cpuMs);
    const wallTimeMs = finiteNonNegative(source.wallTimeMs);
    if (requests !== undefined) result.requests = requests;
    if (cpuMs !== undefined) result.cpuMs = cpuMs;
    if (wallTimeMs !== undefined) result.wallTimeMs = wallTimeMs;
    const numericFields = [
      "d1Queries",
      "d1RowsWritten",
      "previousOffset",
      "nextOffset",
      "sweepRound",
      "processedAgents",
      "candidatesRead",
      "changedTargets",
      "removedTargets",
      "metadataUnavailableTargets",
      "materialWrites",
      "candidateTargets",
      "invalidItems",
      "processedTargets",
      "fromBlock",
      "toBlock",
      "window",
      "logs",
      "jobs",
      "jobsFailed",
      "httpStatus",
    ] as const;
    for (const field of numericFields) {
      const value = finiteNonNegative(source[field]);
      if (value !== undefined) result[field] = value;
    }
    if (typeof source.headerWindowExhausted === "boolean") {
      result.headerWindowExhausted = source.headerWindowExhausted;
    }
    if (typeof source.complete === "boolean") result.complete = source.complete;
    if (
      typeof source.outcome === "string"
      && [
        "quote_verified", "protocol_valid", "quote_rejected", "quote_invalid",
        "reachable", "unreachable", "unsafe_url", "error", "no_candidate",
        "metadata_unavailable", "removed",
      ].includes(source.outcome)
    ) result.outcome = source.outcome;
    if (typeof source.errorCode === "string" && /^[A-Z0-9_]{1,64}$/.test(source.errorCode)) {
      result.errorCode = source.errorCode;
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

function integer(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function headerHighWater(value: string | null | undefined): string | null {
  return typeof value === "string" && /^\d+:\d+$/.test(value) ? value : null;
}

function dailyBudget(row: RuntimeRow | undefined, utcDate: string): DailyBudget | null {
  if (!row?.textValue) return null;
  try {
    const parsed: unknown = JSON.parse(row.textValue);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const source = parsed as Record<string, unknown>;
    const numericFields = [
      "updatedAt",
      "invocations",
      "completed",
      "failed",
      "duplicate",
      "locked",
      "upstreamRequests",
      "d1Queries",
      "rowsReadObservedBeforeLedger",
      "rowsWrittenObservedBeforeLedger",
    ] as const;
    for (const field of numericFields) {
      if (!Number.isSafeInteger(source[field]) || (source[field] as number) < 0) return null;
    }
    if (
      source.schemaVersion !== 1
      || source.utcDate !== utcDate
      || source.measurementScope !== "worker_metered_before_daily_ledger"
      || source.completed as number
        + (source.failed as number)
        + (source.duplicate as number)
        + (source.locked as number) !== source.invocations
    ) return null;
    return {
      schemaVersion: 1,
      utcDate,
      measurementScope: "worker_metered_before_daily_ledger",
      updatedAt: source.updatedAt as number,
      invocations: source.invocations as number,
      completed: source.completed as number,
      failed: source.failed as number,
      duplicate: source.duplicate as number,
      locked: source.locked as number,
      upstreamRequests: source.upstreamRequests as number,
      d1Queries: source.d1Queries as number,
      rowsReadObservedBeforeLedger: source.rowsReadObservedBeforeLedger as number,
      rowsWrittenObservedBeforeLedger: source.rowsWrittenObservedBeforeLedger as number,
    };
  } catch {
    return null;
  }
}

export async function healthResponse(
  db: D1Database,
  config: WorkerConfig,
  now: number,
  options: HealthOptions = {},
): Promise<Response> {
  const rpcConfigured = options.rpcConfigured ?? { 56: false, 97: false };
  try {
    const utcDate = new Date(now).toISOString().slice(0, 10);
    const dailyBudgetKey = `daily_budget_${utcDate.replaceAll("-", "")}`;
    const runtimeKeys = [...RUNTIME_KEYS, dailyBudgetKey, "catalog_sweep_hour"];
    const rows = await readRuntimeStates(
      createDatabase(db as unknown as D1DatabaseLike), runtimeKeys,
    ) as RuntimeRow[];
    const quoteQueue = config.catalogV2WritesEnabled
      ? await (async () => {
        const quoteDb = createDatabase(db as unknown as D1DatabaseLike);
        const [counts, latest, compatibility] = await Promise.all([
          quoteDb.all<{ state: string; total: number }>(sql`SELECT state, COUNT(*) AS total FROM catalog_seller_capabilities GROUP BY state`),
          quoteDb.all<{ lastAttemptAt: number | null; nextProbeAt: number | null }>(sql`SELECT MAX(lastAttemptAt) AS lastAttemptAt, MIN(CASE WHEN state IN ('discovered','stale','failed') THEN nextProbeAt END) AS nextProbeAt FROM catalog_seller_capabilities`),
          quoteDb.all<{ state: string; endpoints: number; agents: number; lastCheckedAt: number | null }>(sql`SELECT compatibilityState AS state, COUNT(*) AS endpoints, COUNT(DISTINCT agentKey) AS agents, MAX(compatibilityCheckedAt) AS lastCheckedAt FROM catalog_seller_capabilities GROUP BY compatibilityState`),
        ]);
        const count = (state: string) => Number(counts.find((row) => row.state === state)?.total ?? 0);
        const row = latest[0];
        return {
          available: options.quoteQueueAvailable === true,
          sweep: (() => {
            const metrics = rows.find(entry => entry.key === "catalog_sweep_hour");
            if (!metrics?.textValue) return null;
            return { windowStart: metrics.integerValue, updatedAt: metrics.updatedAt, unit: "physical executions", counters: JSON.parse(metrics.textValue), note: "UTC-hour counters; not unique agents or a queue backlog. Compare enqueued/completed with queue wait and errors." };
          })(),
          pending: count("discovered") + count("stale") + count("failed"),
          ready: count("ready"),
          stale: count("stale"),
          failed: count("failed"),
          lastQuoteAttemptAt: row?.lastAttemptAt ?? null,
          lastProcessedAt: Math.max(row?.lastAttemptAt ?? 0, ...compatibility.map((entry) => entry.lastCheckedAt ?? 0)) || null,
          nextProbeAt: row?.nextProbeAt ?? null,
          compatibility: { unit: "endpoints", states: compatibility, note: "Pending is not incompatible; agent counts across states may overlap." },
        };
      })()
      : { available: options.quoteQueueAvailable === true, pending: 0, ready: 0, stale: 0, failed: 0, lastProcessedAt: null, nextProbeAt: null };
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const summaryRows = [
      byKey.get("last_header_summary"),
      byKey.get("last_sweep_summary"),
      byKey.get("last_probe_summary"),
    ].filter((row): row is RuntimeRow => row !== undefined);
    summaryRows.sort((left, right) => right.updatedAt - left.updatedAt);
    const latestPhaseRow = summaryRows[0];
    const lastPhase = safeSummary(latestPhaseRow);
    const lastHeader = safeSummary(byKey.get("last_header_summary"));
    const lastSchedulerRow = byKey.get("last_scheduler_summary");
    const lastScheduler = safeSummary(lastSchedulerRow);
    const leaseExpiresAt = integer(byKey.get("scheduler_lease")?.integerValue);

    const nextPhaseValue = byKey.get("next_scheduler_phase")?.textValue;
    const nextPhase = nextPhaseValue === "header" || nextPhaseValue === "sweep" || nextPhaseValue === "probe"
      ? nextPhaseValue
      : "header";
    const currentDailyBudget = dailyBudget(byKey.get(dailyBudgetKey), utcDate);
    const dailyBudgetMaxAgeMs = Math.max(15 * 60_000, config.cronIntervalMinutes * 3 * 60_000);
    const dailyBudgetFresh = currentDailyBudget !== null
      && currentDailyBudget.updatedAt <= now + 5 * 60_000
      && now - currentDailyBudget.updatedAt <= dailyBudgetMaxAgeMs;
    const schedulerDegraded = lastScheduler?.errorCode !== undefined
      && (latestPhaseRow === undefined || (lastSchedulerRow?.updatedAt ?? 0) > latestPhaseRow.updatedAt);
    const degraded = lastPhase?.errorCode !== undefined || (
      lastPhase?.status !== undefined
      && lastPhase.status !== "ok"
      && lastPhase.status !== "success"
    ) || schedulerDegraded || (!config.killSwitch && !dailyBudgetFresh);

    return json({
      status: degraded ? "degraded" : "ok",
      plan: config.plan,
      schedulerMode: config.schedulerMode,
      killSwitch: config.killSwitch,
      producerKillSwitch: config.producerKillSwitch,
      budgets: {
        cronIntervalMinutes: config.cronIntervalMinutes,
        headerLimit: config.headerLimit,
        sweepLimit: config.sweepLimit,
        sweepPagesPerRun: config.sweepPagesPerRun,
        probeBatchSize: config.probeBatchSize,
        catalogQuoteBatchSize: config.catalogQuoteBatchSize,
        catalogQuoteConcurrency: config.catalogQuoteConcurrency,
        trust8004RequestsPerRun: config.trust8004RequestsPerRun,
        externalSubrequestsPerRun: config.externalSubrequestsPerRun,
        d1QueriesPerRun: config.d1QueriesPerRun,
        d1RowsReadPerRun: config.d1RowsReadPerRun,
        d1RowsWrittenPerRun: config.d1RowsWrittenPerRun,
        probeTimeoutMs: config.probeTimeoutMs,
        maxCatalogResponseBytes: config.maxCatalogResponseBytes,
        maxSellerResponseBytes: config.maxSellerResponseBytes,
      },
      platformLimits: config.platformLimits,
      d1: { available: true },
      lease: {
        active: leaseExpiresAt !== null && leaseExpiresAt > now,
        expiresAt: leaseExpiresAt,
      },
      nextPhase,
      sweepOffset: integer(byKey.get("sweep_offset")?.integerValue) ?? 0,
      sweepRound: integer(byKey.get("sweep_round")?.integerValue) ?? 0,
      headerHighWater: headerHighWater(byKey.get("header_high_water")?.textValue),
      headerWindowExhausted: lastHeader?.headerWindowExhausted ?? false,
      targets: { available: false },
      dailyBudget: currentDailyBudget,
      lastPhase,
      lastScheduler,
      lastSchedulerUpdatedAt: lastSchedulerRow?.updatedAt ?? null,
      lastSchedulerErrorIsHistorical: lastScheduler?.errorCode !== undefined && !schedulerDegraded,
      // This summary is written on lease acquisition failure, before any
      // discovery phase. Do not mislabel it as a failed seller check.
      lastSchedulerErrorStage: lastScheduler?.errorCode !== undefined ? "acquire_lease" : null,
      lastPhaseUpdatedAt: latestPhaseRow?.updatedAt ?? null,
      commerceIndex: {
        enabled: config.commerceIndexEnabled,
        chains: {
          56: {
            rpcConfigured: rpcConfigured[56],
            cursor: integer(byKey.get("commerce_cursor_56")?.integerValue),
            lastRun: safeSummary(byKey.get("last_index_summary_56")),
          },
          97: {
            rpcConfigured: rpcConfigured[97],
            cursor: integer(byKey.get("commerce_cursor_97")?.integerValue),
            lastRun: safeSummary(byKey.get("last_index_summary_97")),
          },
        },
      },
      quoteQueue,
    }, 200);
  } catch {
    return json({ status: "unavailable", d1: { available: false } }, 503);
  }
}
