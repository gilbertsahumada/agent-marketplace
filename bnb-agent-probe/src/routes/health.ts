import type { WorkerConfig } from "../config";
import type { D1Database } from "../types";

type RuntimeRow = {
  key: string;
  textValue: string | null;
  integerValue: number | null;
  updatedAt: number;
};

type TargetCountRow = {
  declarationState: string;
  count: number;
};

type SafeSummary = {
  phase?: "header" | "sweep" | "probe";
  status?: string;
  requests?: number;
  cpuMs?: number;
  wallTimeMs?: number;
  errorCode?: string;
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

export async function healthResponse(
  db: D1Database,
  config: WorkerConfig,
  now: number,
): Promise<Response> {
  try {
    const [runtimeResult, targetsResult] = await Promise.all([
      db.prepare(
        `SELECT key, textValue, integerValue, updatedAt
         FROM runtime_state
         WHERE key IN (${RUNTIME_KEYS.map(() => "?").join(", ")})`,
      ).bind(...RUNTIME_KEYS).all<RuntimeRow>(),
      db.prepare(
        `SELECT declarationState, COUNT(*) AS count
         FROM probe_targets
         GROUP BY declarationState`,
      ).all<TargetCountRow>(),
    ]);

    if (!runtimeResult.success || !targetsResult.success) throw new Error("D1 read failed");

    const rows = runtimeResult.results ?? [];
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const summaryRows = [
      byKey.get("last_header_summary"),
      byKey.get("last_sweep_summary"),
      byKey.get("last_probe_summary"),
    ].filter((row): row is RuntimeRow => row !== undefined);
    summaryRows.sort((left, right) => right.updatedAt - left.updatedAt);
    const lastPhase = safeSummary(summaryRows[0]);
    const lastScheduler = safeSummary(byKey.get("last_scheduler_summary"));
    const leaseExpiresAt = integer(byKey.get("scheduler_lease")?.integerValue);

    const targets: Record<string, number> = {
      current: 0,
      removed: 0,
      metadata_unavailable: 0,
    };
    let targetTotal = 0;
    for (const row of targetsResult.results ?? []) {
      if (!(row.declarationState in targets)) continue;
      const count = integer(row.count) ?? 0;
      targets[row.declarationState] = count;
      targetTotal += count;
    }
    targets.total = targetTotal;

    const nextPhaseValue = byKey.get("next_scheduler_phase")?.textValue;
    const nextPhase = nextPhaseValue === "header" || nextPhaseValue === "sweep" || nextPhaseValue === "probe"
      ? nextPhaseValue
      : "header";
    const degraded = lastPhase?.errorCode !== undefined || (
      lastPhase?.status !== undefined
      && lastPhase.status !== "ok"
      && lastPhase.status !== "success"
    );

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
      targets,
      lastPhase,
      lastScheduler,
    }, 200);
  } catch {
    return json({ status: "unavailable", d1: { available: false } }, 503);
  }
}
