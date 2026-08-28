import type { WorkerConfig } from "../config";
import type { D1Database } from "../types";

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
    ] as const;
    for (const field of numericFields) {
      const value = finiteNonNegative(source[field]);
      if (value !== undefined) result[field] = value;
    }
    if (typeof source.headerWindowExhausted === "boolean") {
      result.headerWindowExhausted = source.headerWindowExhausted;
    }
    if (typeof source.complete === "boolean") result.complete = source.complete;
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
): Promise<Response> {
  try {
    const utcDate = new Date(now).toISOString().slice(0, 10);
    const dailyBudgetKey = `daily_budget_${utcDate.replaceAll("-", "")}`;
    const runtimeKeys = [...RUNTIME_KEYS, dailyBudgetKey];
    const runtimeResult = await db.prepare(
      `SELECT key, textValue, integerValue, updatedAt
       FROM runtime_state
       WHERE key IN (${runtimeKeys.map(() => "?").join(", ")})`,
    ).bind(...runtimeKeys).all<RuntimeRow>();

    if (!runtimeResult.success) throw new Error("D1 read failed");

    const rows = runtimeResult.results ?? [];
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const summaryRows = [
      byKey.get("last_header_summary"),
      byKey.get("last_sweep_summary"),
      byKey.get("last_probe_summary"),
    ].filter((row): row is RuntimeRow => row !== undefined);
    summaryRows.sort((left, right) => right.updatedAt - left.updatedAt);
    const lastPhase = safeSummary(summaryRows[0]);
    const lastHeader = safeSummary(byKey.get("last_header_summary"));
    const lastScheduler = safeSummary(byKey.get("last_scheduler_summary"));
    const leaseExpiresAt = integer(byKey.get("scheduler_lease")?.integerValue);

    const nextPhaseValue = byKey.get("next_scheduler_phase")?.textValue;
    const nextPhase = nextPhaseValue === "header" || nextPhaseValue === "sweep" || nextPhaseValue === "probe"
      ? nextPhaseValue
      : "header";
    const currentDailyBudget = dailyBudget(byKey.get(dailyBudgetKey), utcDate);
    const degraded = lastPhase?.errorCode !== undefined || (
      lastPhase?.status !== undefined
      && lastPhase.status !== "ok"
      && lastPhase.status !== "success"
    ) || (!config.killSwitch && currentDailyBudget === null);

    return json({
      status: degraded ? "degraded" : "ok",
      plan: config.plan,
      schedulerMode: config.schedulerMode,
      killSwitch: config.killSwitch,
      budgets: {
        cronIntervalMinutes: config.cronIntervalMinutes,
        headerLimit: config.headerLimit,
        sweepLimit: config.sweepLimit,
        sweepPagesPerRun: config.sweepPagesPerRun,
        probeBatchSize: config.probeBatchSize,
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
    }, 200);
  } catch {
    return json({ status: "unavailable", d1: { available: false } }, 503);
  }
}
