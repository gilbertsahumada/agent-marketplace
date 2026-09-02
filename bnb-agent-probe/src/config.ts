import type { Env } from "./types";
import { isSyntacticallyPublicHttpsUrl } from "./trust8004/safe-url";

export type WorkersPlan = "free" | "paid";
export type SchedulerMode = "single_phase" | "pipeline";

export interface WorkerConfig {
  plan: WorkersPlan;
  killSwitch: boolean;
  producerKillSwitch: boolean;
  schedulerMode: SchedulerMode;
  cronIntervalMinutes: number;
  headerLimit: number;
  sweepLimit: number;
  sweepPagesPerRun: number;
  probeBatchSize: number;
  catalogProbeEnabled: boolean;
  catalogV2ReadsEnabled: boolean;
  catalogV2WritesEnabled: boolean;
  catalogResponseCacheSeconds: number;
  catalogProbeBatchSize: number;
  catalogProbeConcurrency: number;
  catalogValidationRequestsPerDay: number;
  catalogValidationRequestsPerCallerDay: number;
  catalogDiscoveryPageSize: number;
  catalogIngestTasksPerRun: number;
  catalogDeclarationsPerTask: number;
  catalogA2aTimeoutMs: number;
  catalogMcpTimeoutMs: number;
  catalogErc8183TimeoutMs: number;
  catalogPriorityRefreshMinutes: number;
  catalogA2aRefreshMinutes: number;
  catalogMcpRefreshMinutes: number;
  catalogErc8183RefreshMinutes: number;
  catalogFailureBackoffMinutes: readonly number[];
  probeAgentAllowlist: readonly string[];
  probeEndpointAllowlist: readonly string[];
  trust8004RequestsPerRun: number;
  externalSubrequestsPerRun: number;
  d1QueriesPerRun: number;
  d1RowsReadPerRun: number;
  d1RowsWrittenPerRun: number;
  probeTimeoutMs: number;
  maxCatalogResponseBytes: number;
  maxSellerResponseBytes: number;
  platformLimits: {
    cpuMsPerInvocation: number;
    queueConsumerCpuMs: number;
    wallTimeMsPerInvocation: number;
    externalSubrequestsPerInvocation: number;
    internalSubrequestsPerInvocation: number;
    d1QueriesPerInvocation: number;
    d1RowsReadPerDay: number | null;
    d1RowsWrittenPerDay: number | null;
  };
  projectedDailyBudget: {
    invocations: number;
    maxAttemptsPerInvocation: number;
    maxAttempts: number;
    d1RowsReadNominal: number;
    d1RowsWrittenNominal: number;
    d1RowsRead: number;
    d1RowsWritten: number;
    queueOperations: number;
    scheduledQueueOperations: number;
    onDemandQueueOperations: number;
    freeReadCeiling: number;
    freeWriteCeiling: number;
    freeQueueOperationsCeiling: number;
  } | null;
}

type NumericConfig = Omit<
  WorkerConfig,
  | "plan"
  | "killSwitch"
  | "producerKillSwitch"
  | "schedulerMode"
  | "probeAgentAllowlist"
  | "probeEndpointAllowlist"
  | "catalogProbeEnabled"
  | "catalogV2ReadsEnabled"
  | "catalogV2WritesEnabled"
  | "catalogResponseCacheSeconds"
  | "catalogFailureBackoffMinutes"
  | "platformLimits"
  | "projectedDailyBudget"
>;

interface Profile {
  schedulerMode: SchedulerMode;
  defaults: NumericConfig;
  maximums: NumericConfig;
  failureBackoffMinutes: readonly number[];
  maxFailureBackoffMinutes: number;
}

const FREE_D1_READS_PER_DAY = 5_000_000;
const FREE_D1_WRITES_PER_DAY = 100_000;
const FREE_QUEUE_OPERATIONS_PER_DAY = 10_000;
const FREE_SAFETY_RATIO = 0.8;
const QUEUE_MAX_RETRIES = 3;
const QUEUE_OPERATIONS_PER_MESSAGE = 3 + QUEUE_MAX_RETRIES;
const D1_TELEMETRY_WRITES_PER_ATTEMPT = 2;
const FREE_MIN_D1_QUERIES_PER_RUN = 38;
const GENERAL_PROBE_SCOPE = "*";
const SAFE_PROBE_AGENT = "303779";
const SAFE_PROBE_ENDPOINT = "https://bnb-agent-marketplace-ruby.vercel.app/grid";

const FREE_PROFILE: Profile = {
  schedulerMode: "single_phase",
  defaults: {
    cronIntervalMinutes: 5,
    headerLimit: 25,
    sweepLimit: 4,
    sweepPagesPerRun: 1,
    probeBatchSize: 1,
    catalogProbeBatchSize: 1,
    catalogProbeConcurrency: 2,
    catalogValidationRequestsPerDay: 100,
    catalogValidationRequestsPerCallerDay: 10,
    // A full all-new page of twelve identities exceeds the 60-row Free
    // invocation budget once the resumable ingest work is admitted. Keep the
    // default at the largest measured safe page and let Paid scale it up.
    catalogDiscoveryPageSize: 2,
    catalogIngestTasksPerRun: 1,
    catalogDeclarationsPerTask: 1,
    catalogA2aTimeoutMs: 5_000,
    catalogMcpTimeoutMs: 5_000,
    catalogErc8183TimeoutMs: 5_000,
    catalogPriorityRefreshMinutes: 15,
    catalogA2aRefreshMinutes: 720,
    catalogMcpRefreshMinutes: 1_440,
    catalogErc8183RefreshMinutes: 360,
    trust8004RequestsPerRun: 4,
    externalSubrequestsPerRun: 12,
    d1QueriesPerRun: 40,
    d1RowsReadPerRun: 3_000,
    d1RowsWrittenPerRun: 60,
    probeTimeoutMs: 5_000,
    maxCatalogResponseBytes: 16 * 1_024 * 1_024,
    maxSellerResponseBytes: 32_768,
  },
  maximums: {
    cronIntervalMinutes: 1_440,
    headerLimit: 100,
    sweepLimit: 4,
    sweepPagesPerRun: 1,
    probeBatchSize: 1,
    catalogProbeBatchSize: 4,
    catalogProbeConcurrency: 2,
    catalogValidationRequestsPerDay: 500,
    catalogValidationRequestsPerCallerDay: 500,
    catalogDiscoveryPageSize: 2,
    catalogIngestTasksPerRun: 1,
    catalogDeclarationsPerTask: 1,
    catalogA2aTimeoutMs: 10_000,
    catalogMcpTimeoutMs: 10_000,
    catalogErc8183TimeoutMs: 10_000,
    catalogPriorityRefreshMinutes: 60,
    catalogA2aRefreshMinutes: 10_080,
    catalogMcpRefreshMinutes: 10_080,
    catalogErc8183RefreshMinutes: 10_080,
    trust8004RequestsPerRun: 40,
    externalSubrequestsPerRun: 40,
    d1QueriesPerRun: 40,
    d1RowsReadPerRun: 4_000_000,
    d1RowsWrittenPerRun: 80_000,
    probeTimeoutMs: 10_000,
    maxCatalogResponseBytes: 16 * 1_024 * 1_024,
    maxSellerResponseBytes: 65_536,
  },
  failureBackoffMinutes: [60, 360, 1_440, 10_080],
  maxFailureBackoffMinutes: 10_080,
};

const PAID_PROFILE: Profile = {
  schedulerMode: "pipeline",
  defaults: {
    cronIntervalMinutes: 1,
    headerLimit: 200,
    sweepLimit: 2_000,
    sweepPagesPerRun: 2,
    probeBatchSize: 10,
    catalogProbeBatchSize: 10,
    catalogProbeConcurrency: 4,
    catalogValidationRequestsPerDay: 1_000,
    catalogValidationRequestsPerCallerDay: 100,
    catalogDiscoveryPageSize: 200,
    catalogIngestTasksPerRun: 10,
    catalogDeclarationsPerTask: 20,
    catalogA2aTimeoutMs: 10_000,
    catalogMcpTimeoutMs: 10_000,
    catalogErc8183TimeoutMs: 10_000,
    catalogPriorityRefreshMinutes: 15,
    catalogA2aRefreshMinutes: 720,
    catalogMcpRefreshMinutes: 1_440,
    catalogErc8183RefreshMinutes: 360,
    trust8004RequestsPerRun: 20,
    externalSubrequestsPerRun: 55,
    d1QueriesPerRun: 800,
    d1RowsReadPerRun: 100_000,
    d1RowsWrittenPerRun: 10_000,
    probeTimeoutMs: 10_000,
    maxCatalogResponseBytes: 16 * 1_024 * 1_024,
    maxSellerResponseBytes: 65_536,
  },
  maximums: {
    cronIntervalMinutes: 1_440,
    headerLimit: 2_000,
    sweepLimit: 2_000,
    sweepPagesPerRun: 20,
    probeBatchSize: 100,
    catalogProbeBatchSize: 100,
    catalogProbeConcurrency: 4,
    catalogValidationRequestsPerDay: 10_000,
    catalogValidationRequestsPerCallerDay: 1_000,
    catalogDiscoveryPageSize: 2_000,
    catalogIngestTasksPerRun: 50,
    catalogDeclarationsPerTask: 24,
    catalogA2aTimeoutMs: 30_000,
    catalogMcpTimeoutMs: 30_000,
    catalogErc8183TimeoutMs: 30_000,
    catalogPriorityRefreshMinutes: 60,
    catalogA2aRefreshMinutes: 43_200,
    catalogMcpRefreshMinutes: 43_200,
    catalogErc8183RefreshMinutes: 43_200,
    trust8004RequestsPerRun: 55,
    externalSubrequestsPerRun: 1_000,
    d1QueriesPerRun: 800,
    d1RowsReadPerRun: 25_000_000,
    d1RowsWrittenPerRun: 1_000_000,
    probeTimeoutMs: 30_000,
    maxCatalogResponseBytes: 16 * 1_024 * 1_024,
    maxSellerResponseBytes: 65_536,
  },
  failureBackoffMinutes: [60, 360, 1_440, 10_080],
  maxFailureBackoffMinutes: 43_200,
};

const NUMERIC_FIELDS = {
  CRON_INTERVAL_MINUTES: "cronIntervalMinutes",
  HEADER_LIMIT: "headerLimit",
  SWEEP_LIMIT: "sweepLimit",
  SWEEP_PAGES_PER_RUN: "sweepPagesPerRun",
  PROBE_BATCH_SIZE: "probeBatchSize",
  CATALOG_PROBE_BATCH_SIZE: "catalogProbeBatchSize",
  CATALOG_PROBE_CONCURRENCY: "catalogProbeConcurrency",
  CATALOG_VALIDATION_REQUESTS_PER_DAY: "catalogValidationRequestsPerDay",
  CATALOG_VALIDATION_REQUESTS_PER_CALLER_DAY: "catalogValidationRequestsPerCallerDay",
  CATALOG_DISCOVERY_PAGE_SIZE: "catalogDiscoveryPageSize",
  CATALOG_INGEST_TASKS_PER_RUN: "catalogIngestTasksPerRun",
  CATALOG_DECLARATIONS_PER_TASK: "catalogDeclarationsPerTask",
  CATALOG_A2A_TIMEOUT_MS: "catalogA2aTimeoutMs",
  CATALOG_MCP_TIMEOUT_MS: "catalogMcpTimeoutMs",
  CATALOG_ERC8183_TIMEOUT_MS: "catalogErc8183TimeoutMs",
  CATALOG_PRIORITY_REFRESH_MINUTES: "catalogPriorityRefreshMinutes",
  CATALOG_A2A_REFRESH_MINUTES: "catalogA2aRefreshMinutes",
  CATALOG_MCP_REFRESH_MINUTES: "catalogMcpRefreshMinutes",
  CATALOG_ERC8183_REFRESH_MINUTES: "catalogErc8183RefreshMinutes",
  TRUST8004_REQUESTS_PER_RUN: "trust8004RequestsPerRun",
  EXTERNAL_SUBREQUESTS_PER_RUN: "externalSubrequestsPerRun",
  D1_QUERIES_PER_RUN: "d1QueriesPerRun",
  D1_ROWS_READ_PER_RUN: "d1RowsReadPerRun",
  D1_ROWS_WRITTEN_PER_RUN: "d1RowsWrittenPerRun",
  PROBE_TIMEOUT_MS: "probeTimeoutMs",
  MAX_CATALOG_RESPONSE_BYTES: "maxCatalogResponseBytes",
  MAX_SELLER_RESPONSE_BYTES: "maxSellerResponseBytes",
} as const;

export class ConfigError extends Error {
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ConfigError";
  }
}

function parsePlan(value: string | undefined): WorkersPlan {
  if (value === undefined || value === "free") return "free";
  if (value === "paid") return "paid";
  throw new ConfigError("CLOUDFLARE_WORKERS_PLAN", "must be free or paid");
}

function parseKillSwitch(value: string | undefined): boolean {
  if (value === undefined || value === "1") return true;
  if (value === "0") return false;
  throw new ConfigError("KILL_SWITCH", "must be 0 or 1");
}

function parseProducerKillSwitch(value: string | undefined, killSwitch: boolean): boolean {
  if (value === undefined) return killSwitch;
  if (value === "1") return true;
  if (value === "0") return false;
  throw new ConfigError("PRODUCER_KILL_SWITCH", "must be 0 or 1");
}

function parseInteger(field: keyof typeof NUMERIC_FIELDS, raw: string, maximum: number): number {
  if (!/^\d+$/.test(raw)) {
    throw new ConfigError(field, "must be a non-negative integer");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new ConfigError(field, "must be a safe integer");
  if ([
    "CRON_INTERVAL_MINUTES",
    "HEADER_LIMIT",
    "SWEEP_LIMIT",
    "SWEEP_PAGES_PER_RUN",
    "PROBE_BATCH_SIZE",
    "CATALOG_PROBE_BATCH_SIZE",
    "CATALOG_PROBE_CONCURRENCY",
    "CATALOG_VALIDATION_REQUESTS_PER_DAY",
    "CATALOG_VALIDATION_REQUESTS_PER_CALLER_DAY",
    "CATALOG_DISCOVERY_PAGE_SIZE",
    "CATALOG_INGEST_TASKS_PER_RUN",
    "CATALOG_DECLARATIONS_PER_TASK",
    "CATALOG_A2A_TIMEOUT_MS",
    "CATALOG_MCP_TIMEOUT_MS",
    "CATALOG_ERC8183_TIMEOUT_MS",
    "CATALOG_PRIORITY_REFRESH_MINUTES",
    "CATALOG_A2A_REFRESH_MINUTES",
    "CATALOG_MCP_REFRESH_MINUTES",
    "CATALOG_ERC8183_REFRESH_MINUTES",
    "TRUST8004_REQUESTS_PER_RUN",
    "EXTERNAL_SUBREQUESTS_PER_RUN",
    "D1_ROWS_READ_PER_RUN",
    "D1_ROWS_WRITTEN_PER_RUN",
    "PROBE_TIMEOUT_MS",
    "MAX_SELLER_RESPONSE_BYTES",
  ].includes(field) && value === 0) {
    throw new ConfigError(field, "must be at least 1");
  }
  if (field === "D1_QUERIES_PER_RUN" && value < FREE_MIN_D1_QUERIES_PER_RUN) {
    throw new ConfigError(
      field,
      "must cover a four-agent Queue SWEEP plus error, lease cleanup, attempt and daily ledger reserves",
    );
  }
  if (field === "CRON_INTERVAL_MINUTES" && (value > 60 || 60 % value !== 0)) {
    throw new ConfigError(field, "must be a divisor of 60 between 1 and 60");
  }
  if (field === "MAX_CATALOG_RESPONSE_BYTES" && value === 0) {
    throw new ConfigError(field, "must be at least 1");
  }
  if (value > maximum) throw new ConfigError(field, `must not exceed ${maximum}`);
  return value;
}

function configEnvironment(env: Partial<Env>): Record<string, string | undefined> {
  return env as Record<string, string | undefined>;
}

function parseAgentAllowlist(raw: string | undefined, plan: WorkersPlan, generalApproved: boolean): readonly string[] {
  const configured = raw ?? SAFE_PROBE_AGENT;
  if (configured.trim() === GENERAL_PROBE_SCOPE) {
    if (!generalApproved) throw new ConfigError("PROBE_AGENT_ALLOWLIST", "wildcard requires the WP4 general-egress gate");
    return [];
  }
  const values = parseCsv("PROBE_AGENT_ALLOWLIST", configured);
  if (values.length > (plan === "free" ? 1 : 100)) {
    throw new ConfigError("PROBE_AGENT_ALLOWLIST", "contains too many entries for the plan");
  }
  for (const value of values) {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new ConfigError("PROBE_AGENT_ALLOWLIST", "must contain positive decimal agent IDs");
    }
  }
  return values;
}

function parseEndpointAllowlist(raw: string | undefined, plan: WorkersPlan, generalApproved: boolean): readonly string[] {
  const configured = raw ?? SAFE_PROBE_ENDPOINT;
  if (configured.trim() === GENERAL_PROBE_SCOPE) {
    if (!generalApproved) throw new ConfigError("PROBE_ENDPOINT_ALLOWLIST", "wildcard requires the WP4 general-egress gate");
    return [];
  }
  const values = parseCsv("PROBE_ENDPOINT_ALLOWLIST", configured);
  if (values.length > (plan === "free" ? 1 : 100)) {
    throw new ConfigError("PROBE_ENDPOINT_ALLOWLIST", "contains too many entries for the plan");
  }
  const normalized = values.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ConfigError("PROBE_ENDPOINT_ALLOWLIST", "must contain valid URLs");
    }
    if (
      !isSyntacticallyPublicHttpsUrl(value)
    ) {
      throw new ConfigError(
        "PROBE_ENDPOINT_ALLOWLIST",
        "must contain public HTTPS URLs without credentials, query or fragment",
      );
    }
    return url.toString();
  });
  return normalized;
}

function parseCsv(field: string, raw: string): readonly string[] {
  const values = raw.split(",").map((value) => value.trim());
  if (values.length === 0 || values.some((value) => value.length === 0)) {
    throw new ConfigError(field, "must contain at least one non-empty entry");
  }
  if (new Set(values).size !== values.length) {
    throw new ConfigError(field, "must not contain duplicate entries");
  }
  return values;
}

function parseFailureBackoff(raw: string | undefined, profile: Profile): readonly number[] {
  if (raw === undefined) return profile.failureBackoffMinutes;
  const values = raw.split(",");
  if (values.length < 2 || values.length > 8) {
    throw new ConfigError("CATALOG_FAILURE_BACKOFF_MINUTES", "must contain between 2 and 8 entries");
  }
  const parsed = values.map((value) => {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new ConfigError("CATALOG_FAILURE_BACKOFF_MINUTES", "must contain positive integer minutes");
    }
    const minutes = Number(value);
    if (!Number.isSafeInteger(minutes) || minutes > profile.maxFailureBackoffMinutes) {
      throw new ConfigError(
        "CATALOG_FAILURE_BACKOFF_MINUTES",
        `entries must not exceed ${profile.maxFailureBackoffMinutes}`,
      );
    }
    return minutes;
  });
  if (parsed.some((value, index) => index > 0 && value <= parsed[index - 1]!)) {
    throw new ConfigError("CATALOG_FAILURE_BACKOFF_MINUTES", "entries must be strictly increasing");
  }
  return parsed;
}

export function loadConfig(env: Partial<Env>): WorkerConfig {
  const source = configEnvironment(env);
  const plan = parsePlan(source.CLOUDFLARE_WORKERS_PLAN);
  const profile = plan === "free" ? FREE_PROFILE : PAID_PROFILE;
  const values = { ...profile.defaults };
  const generalEgressApproved = source.PROBE_GENERAL_EGRESS_APPROVED === "1";
  if (source.PROBE_GENERAL_EGRESS_APPROVED !== undefined
    && source.PROBE_GENERAL_EGRESS_APPROVED !== "0"
    && source.PROBE_GENERAL_EGRESS_APPROVED !== "1") {
    throw new ConfigError("PROBE_GENERAL_EGRESS_APPROVED", "must be 0 or 1");
  }
  const catalogProbeEnabled = source.CATALOG_PROBE_ENABLED === "1";
  if (source.CATALOG_PROBE_ENABLED !== undefined
    && source.CATALOG_PROBE_ENABLED !== "0"
    && source.CATALOG_PROBE_ENABLED !== "1") {
    throw new ConfigError("CATALOG_PROBE_ENABLED", "must be 0 or 1");
  }
  if (catalogProbeEnabled && !generalEgressApproved) {
    throw new ConfigError("CATALOG_PROBE_ENABLED", "requires the WP4 general-egress gate");
  }
  const catalogV2WritesEnabled = source.CATALOG_V2_WRITES_ENABLED === "1";
  if (source.CATALOG_V2_WRITES_ENABLED !== undefined
    && source.CATALOG_V2_WRITES_ENABLED !== "0"
    && source.CATALOG_V2_WRITES_ENABLED !== "1") {
    throw new ConfigError("CATALOG_V2_WRITES_ENABLED", "must be 0 or 1");
  }
  const catalogV2ReadsEnabled = source.CATALOG_V2_READS_ENABLED === "1";
  if (source.CATALOG_V2_READS_ENABLED !== undefined
    && source.CATALOG_V2_READS_ENABLED !== "0"
    && source.CATALOG_V2_READS_ENABLED !== "1") {
    throw new ConfigError("CATALOG_V2_READS_ENABLED", "must be 0 or 1");
  }
  // Public catalogue responses may be served from the Workers Cache for this
  // long. 0 keeps every read live; staging enables it because each uncached
  // list request costs O(agents) D1 rows against the account-wide Free quota.
  const rawCacheSeconds = source.CATALOG_RESPONSE_CACHE_SECONDS;
  if (rawCacheSeconds !== undefined && (!/^\d{1,4}$/.test(rawCacheSeconds) || Number(rawCacheSeconds) > 3_600)) {
    throw new ConfigError("CATALOG_RESPONSE_CACHE_SECONDS", "must be an integer between 0 and 3600");
  }
  const catalogResponseCacheSeconds = rawCacheSeconds === undefined ? 0 : Number(rawCacheSeconds);

  for (const [field, property] of Object.entries(NUMERIC_FIELDS) as Array<
    [keyof typeof NUMERIC_FIELDS, keyof NumericConfig]
  >) {
    const raw = source[field];
    if (raw !== undefined) values[property] = parseInteger(field, raw, profile.maximums[property]);
  }

  if (source.CATALOG_VALIDATION_REQUESTS_PER_CALLER_DAY === undefined) {
    values.catalogValidationRequestsPerCallerDay = Math.min(
      values.catalogValidationRequestsPerCallerDay,
      values.catalogValidationRequestsPerDay,
    );
  }

  if (values.trust8004RequestsPerRun > values.externalSubrequestsPerRun) {
    throw new ConfigError(
      "TRUST8004_REQUESTS_PER_RUN",
      "must not exceed EXTERNAL_SUBREQUESTS_PER_RUN",
    );
  }

  if (plan === "free" && values.sweepLimit > values.trust8004RequestsPerRun) {
    throw new ConfigError(
      "SWEEP_LIMIT",
      "must not exceed TRUST8004_REQUESTS_PER_RUN on Free",
    );
  }

  if (values.catalogValidationRequestsPerCallerDay > values.catalogValidationRequestsPerDay) {
    throw new ConfigError(
      "CATALOG_VALIDATION_REQUESTS_PER_CALLER_DAY",
      "must not exceed CATALOG_VALIDATION_REQUESTS_PER_DAY",
    );
  }

  const discoveryRequestsPerSweep = 2;
  if (discoveryRequestsPerSweep + values.catalogIngestTasksPerRun > values.trust8004RequestsPerRun) {
    throw new ConfigError(
      "CATALOG_INGEST_TASKS_PER_RUN",
      "discovery plus ingest tasks must fit TRUST8004_REQUESTS_PER_RUN",
    );
  }

  const worstCaseCatalogExternalRequests = Math.max(
    discoveryRequestsPerSweep + values.catalogIngestTasksPerRun,
    1 + values.catalogIngestTasksPerRun + (3 * values.catalogProbeBatchSize),
  );
  if (worstCaseCatalogExternalRequests > values.externalSubrequestsPerRun) {
    throw new ConfigError(
      "CATALOG_PROBE_BATCH_SIZE",
      `v2 discovery, ingest and an all-MCP batch require up to ${worstCaseCatalogExternalRequests} external subrequests; lower the batch or raise EXTERNAL_SUBREQUESTS_PER_RUN`,
    );
  }

  const catalogPhaseQueryLimit = values.d1QueriesPerRun - 4;
  const worstCaseDiscoverySweepQueries = 9 + 2 * (
    Math.ceil(values.catalogDiscoveryPageSize / 2)
    + Math.ceil(values.catalogDiscoveryPageSize / 3)
  );
  if (worstCaseDiscoverySweepQueries > catalogPhaseQueryLimit) {
    throw new ConfigError(
      "CATALOG_DISCOVERY_PAGE_SIZE",
      `an all-new header+sweep discovery can require ${worstCaseDiscoverySweepQueries} phase queries; lower the page size or raise D1_QUERIES_PER_RUN`,
    );
  }

  if (plan === "free") {
    const worstCaseSweepQueries = 6 * values.sweepLimit + 14;
    if (worstCaseSweepQueries > values.d1QueriesPerRun) {
      throw new ConfigError(
        "SWEEP_LIMIT",
        `requires up to ${worstCaseSweepQueries} D1 queries including cleanup; lower SWEEP_LIMIT or raise D1_QUERIES_PER_RUN`,
      );
    }
  }

  const invocations = Math.ceil(1_440 / values.cronIntervalMinutes);
  const maxAttemptsPerInvocation = QUEUE_MAX_RETRIES + 1;
  const maxAttempts = invocations * maxAttemptsPerInvocation;
  const projectedDailyBudget = plan === "free"
    ? {
        invocations,
        maxAttemptsPerInvocation,
        maxAttempts,
        d1RowsReadNominal: invocations * values.d1RowsReadPerRun,
        d1RowsWrittenNominal: invocations
          * (values.d1RowsWrittenPerRun + D1_TELEMETRY_WRITES_PER_ATTEMPT),
        d1RowsRead: maxAttempts * values.d1RowsReadPerRun,
        d1RowsWritten: maxAttempts
          * (values.d1RowsWrittenPerRun + D1_TELEMETRY_WRITES_PER_ATTEMPT),
        scheduledQueueOperations: invocations * QUEUE_OPERATIONS_PER_MESSAGE,
        onDemandQueueOperations: values.catalogValidationRequestsPerDay * QUEUE_OPERATIONS_PER_MESSAGE,
        queueOperations: (invocations + values.catalogValidationRequestsPerDay) * QUEUE_OPERATIONS_PER_MESSAGE,
        freeReadCeiling: FREE_D1_READS_PER_DAY * FREE_SAFETY_RATIO,
        freeWriteCeiling: FREE_D1_WRITES_PER_DAY * FREE_SAFETY_RATIO,
        freeQueueOperationsCeiling: FREE_QUEUE_OPERATIONS_PER_DAY * FREE_SAFETY_RATIO,
      }
    : null;

  if (projectedDailyBudget !== null) {
    if (projectedDailyBudget.d1RowsRead > projectedDailyBudget.freeReadCeiling) {
      throw new ConfigError(
        "D1_ROWS_READ_PER_RUN",
        "projected daily reads exceed Free safety ceiling",
      );
    }
    if (projectedDailyBudget.d1RowsWritten > projectedDailyBudget.freeWriteCeiling) {
      throw new ConfigError(
        "D1_ROWS_WRITTEN_PER_RUN",
        "projected daily writes exceed Free safety ceiling",
      );
    }
    if (projectedDailyBudget.queueOperations > projectedDailyBudget.freeQueueOperationsCeiling) {
      throw new ConfigError(
        "CRON_INTERVAL_MINUTES",
        "projected daily Queue operations exceed Free safety ceiling",
      );
    }
  }

  const killSwitch = parseKillSwitch(source.KILL_SWITCH);
  return {
    plan,
    killSwitch,
    producerKillSwitch: parseProducerKillSwitch(source.PRODUCER_KILL_SWITCH, killSwitch),
    schedulerMode: profile.schedulerMode,
    catalogProbeEnabled,
    catalogV2ReadsEnabled,
    catalogResponseCacheSeconds,
    catalogV2WritesEnabled,
    catalogFailureBackoffMinutes: parseFailureBackoff(source.CATALOG_FAILURE_BACKOFF_MINUTES, profile),
    probeAgentAllowlist: parseAgentAllowlist(source.PROBE_AGENT_ALLOWLIST, plan, generalEgressApproved),
    probeEndpointAllowlist: parseEndpointAllowlist(source.PROBE_ENDPOINT_ALLOWLIST, plan, generalEgressApproved),
    ...values,
    platformLimits: plan === "free"
      ? {
          cpuMsPerInvocation: 10,
          queueConsumerCpuMs: 30_000,
          wallTimeMsPerInvocation: 15 * 60_000,
          externalSubrequestsPerInvocation: 50,
          internalSubrequestsPerInvocation: 1_000,
          d1QueriesPerInvocation: 50,
          d1RowsReadPerDay: FREE_D1_READS_PER_DAY,
          d1RowsWrittenPerDay: FREE_D1_WRITES_PER_DAY,
        }
      : {
          cpuMsPerInvocation: values.cronIntervalMinutes < 60 ? 30_000 : 15 * 60_000,
          queueConsumerCpuMs: 30_000,
          wallTimeMsPerInvocation: 15 * 60_000,
          externalSubrequestsPerInvocation: 10_000,
          internalSubrequestsPerInvocation: 10_000,
          d1QueriesPerInvocation: 1_000,
          d1RowsReadPerDay: null,
          d1RowsWrittenPerDay: null,
        },
    projectedDailyBudget,
  };
}
