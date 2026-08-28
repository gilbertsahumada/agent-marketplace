export type CloudflareWorkersPlan = "free" | "paid";
export type ObservationSchedulerMode = "single_phase" | "pipeline";

type WorkerEnvironment = Readonly<Record<string, string | undefined>>;

interface PlatformLimits {
  cpuMsPerInvocation: number;
  queueConsumerCpuMs: number;
  wallTimeMsPerInvocation: number;
  externalSubrequestsPerInvocation: number;
  internalSubrequestsPerInvocation: number;
  d1QueriesPerInvocation: number;
  d1RowsReadPerDay: number | null;
  d1RowsWrittenPerDay: number | null;
}

interface ProjectedDailyBudget {
  invocations: number;
  maxAttemptsPerInvocation: number;
  maxAttempts: number;
  d1RowsReadNominal: number;
  d1RowsWrittenNominal: number;
  d1RowsRead: number;
  d1RowsWritten: number;
  queueOperations: number;
  freeReadCeiling: number;
  freeWriteCeiling: number;
  freeQueueOperationsCeiling: number;
}

export interface ObservationWorkerConfig {
  plan: CloudflareWorkersPlan;
  killSwitch: boolean;
  schedulerMode: ObservationSchedulerMode;
  cronIntervalMinutes: number;
  headerLimit: number;
  sweepLimit: number;
  sweepPagesPerRun: number;
  probeBatchSize: number;
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
  platformLimits: PlatformLimits;
  projectedDailyBudget: ProjectedDailyBudget | null;
}

type WorkerBudgetValues = Omit<ObservationWorkerConfig,
  | "plan"
  | "killSwitch"
  | "schedulerMode"
  | "probeAgentAllowlist"
  | "probeEndpointAllowlist"
  | "platformLimits"
  | "projectedDailyBudget">;

interface PlanProfile {
  schedulerMode: ObservationSchedulerMode;
  defaults: WorkerBudgetValues;
  maximums: WorkerBudgetValues;
}

const FREE_D1_READS_PER_DAY = 5_000_000;
const FREE_D1_WRITES_PER_DAY = 100_000;
const FREE_QUEUE_OPERATIONS_PER_DAY = 10_000;
const FREE_D1_RESERVE_RATIO = 0.2;
const QUEUE_MAX_RETRIES = 3;
const QUEUE_OPERATIONS_PER_MESSAGE = 3 + QUEUE_MAX_RETRIES;
const WP3_AGENT_ID = "303779";
const WP3_ENDPOINT = "https://bnb-agent-marketplace-ruby.vercel.app/grid";

const FREE_PROFILE: PlanProfile = {
  schedulerMode: "single_phase",
  defaults: {
    cronIntervalMinutes: 5,
    headerLimit: 25,
    sweepLimit: 4,
    sweepPagesPerRun: 1,
    probeBatchSize: 1,
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
    headerLimit: 50,
    sweepLimit: 40,
    sweepPagesPerRun: 1,
    probeBatchSize: 1,
    trust8004RequestsPerRun: 40,
    externalSubrequestsPerRun: 40,
    d1QueriesPerRun: 40,
    d1RowsReadPerRun: 4_000_000,
    d1RowsWrittenPerRun: 80_000,
    probeTimeoutMs: 10_000,
    maxCatalogResponseBytes: 16 * 1_024 * 1_024,
    maxSellerResponseBytes: 65_536,
  },
};

const PAID_PROFILE: PlanProfile = {
  schedulerMode: "pipeline",
  defaults: {
    cronIntervalMinutes: 1,
    headerLimit: 200,
    sweepLimit: 2_000,
    sweepPagesPerRun: 2,
    probeBatchSize: 10,
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
    trust8004RequestsPerRun: 55,
    externalSubrequestsPerRun: 1_000,
    d1QueriesPerRun: 800,
    d1RowsReadPerRun: 25_000_000,
    d1RowsWrittenPerRun: 1_000_000,
    probeTimeoutMs: 30_000,
    maxCatalogResponseBytes: 16 * 1_024 * 1_024,
    maxSellerResponseBytes: 65_536,
  },
};

const ENV_FIELDS = {
  CRON_INTERVAL_MINUTES: "cronIntervalMinutes",
  HEADER_LIMIT: "headerLimit",
  SWEEP_LIMIT: "sweepLimit",
  SWEEP_PAGES_PER_RUN: "sweepPagesPerRun",
  PROBE_BATCH_SIZE: "probeBatchSize",
  TRUST8004_REQUESTS_PER_RUN: "trust8004RequestsPerRun",
  EXTERNAL_SUBREQUESTS_PER_RUN: "externalSubrequestsPerRun",
  D1_QUERIES_PER_RUN: "d1QueriesPerRun",
  D1_ROWS_READ_PER_RUN: "d1RowsReadPerRun",
  D1_ROWS_WRITTEN_PER_RUN: "d1RowsWrittenPerRun",
  PROBE_TIMEOUT_MS: "probeTimeoutMs",
  MAX_CATALOG_RESPONSE_BYTES: "maxCatalogResponseBytes",
  MAX_SELLER_RESPONSE_BYTES: "maxSellerResponseBytes",
} as const;

export class ObservationWorkerConfigError extends Error {
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ObservationWorkerConfigError";
  }
}

function parsePlan(value: string | undefined): CloudflareWorkersPlan {
  if (value === undefined || value === "free") return "free";
  if (value === "paid") return "paid";
  throw new ObservationWorkerConfigError(
    "CLOUDFLARE_WORKERS_PLAN",
    "must be either free or paid",
  );
}

function parseKillSwitch(value: string | undefined): boolean {
  if (value === undefined || value === "1") return true;
  if (value === "0") return false;
  throw new ObservationWorkerConfigError("KILL_SWITCH", "must be 0 or 1");
}

function parseCsv(field: string, raw: string): readonly string[] {
  const values = raw.split(",").map((value) => value.trim());
  if (values.length === 0 || values.some((value) => value.length === 0)) {
    throw new ObservationWorkerConfigError(field, "must contain at least one non-empty entry");
  }
  if (new Set(values).size !== values.length) {
    throw new ObservationWorkerConfigError(field, "must not contain duplicate entries");
  }
  return values;
}

function parseAgentAllowlist(
  raw: string | undefined,
  plan: CloudflareWorkersPlan,
): readonly string[] {
  const values = parseCsv("PROBE_AGENT_ALLOWLIST", raw ?? WP3_AGENT_ID);
  if (plan === "free" && (values.length !== 1 || values[0] !== WP3_AGENT_ID)) {
    throw new ObservationWorkerConfigError(
      "PROBE_AGENT_ALLOWLIST",
      `Free must contain only ${WP3_AGENT_ID}`,
    );
  }
  if (values.length > (plan === "free" ? 1 : 100)) {
    throw new ObservationWorkerConfigError(
      "PROBE_AGENT_ALLOWLIST",
      "contains too many entries for the plan",
    );
  }
  for (const value of values) {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new ObservationWorkerConfigError(
        "PROBE_AGENT_ALLOWLIST",
        "must contain positive decimal agent IDs",
      );
    }
  }
  return values;
}

function parseEndpointAllowlist(
  raw: string | undefined,
  plan: CloudflareWorkersPlan,
): readonly string[] {
  const values = parseCsv("PROBE_ENDPOINT_ALLOWLIST", raw ?? WP3_ENDPOINT);
  if (values.length > (plan === "free" ? 1 : 100)) {
    throw new ObservationWorkerConfigError(
      "PROBE_ENDPOINT_ALLOWLIST",
      "contains too many entries for the plan",
    );
  }
  const normalized = values.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ObservationWorkerConfigError(
        "PROBE_ENDPOINT_ALLOWLIST",
        "must contain valid URLs",
      );
    }
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || url.search !== ""
      || url.hash !== ""
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
    ) {
      throw new ObservationWorkerConfigError(
        "PROBE_ENDPOINT_ALLOWLIST",
        "must contain public HTTPS URLs without credentials, query or fragment",
      );
    }
    return url.toString();
  });
  if (plan === "free" && (normalized.length !== 1 || normalized[0] !== WP3_ENDPOINT)) {
    throw new ObservationWorkerConfigError(
      "PROBE_ENDPOINT_ALLOWLIST",
      `Free must contain only ${WP3_ENDPOINT}`,
    );
  }
  return normalized;
}

function parseInteger(
  env: WorkerEnvironment,
  field: keyof typeof ENV_FIELDS,
  fallback: number,
  maximum: number,
): number {
  const raw = env[field];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new ObservationWorkerConfigError(field, "must be a non-negative integer");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new ObservationWorkerConfigError(field, "must be a safe integer");
  }
  if ([
    "CRON_INTERVAL_MINUTES",
    "HEADER_LIMIT",
    "SWEEP_LIMIT",
    "SWEEP_PAGES_PER_RUN",
    "PROBE_BATCH_SIZE",
    "TRUST8004_REQUESTS_PER_RUN",
    "EXTERNAL_SUBREQUESTS_PER_RUN",
    "D1_ROWS_READ_PER_RUN",
    "D1_ROWS_WRITTEN_PER_RUN",
    "PROBE_TIMEOUT_MS",
    "MAX_SELLER_RESPONSE_BYTES",
  ].includes(field) && value === 0) {
    throw new ObservationWorkerConfigError(field, "must be at least 1");
  }
  if (field === "D1_QUERIES_PER_RUN" && value < 12) {
    throw new ObservationWorkerConfigError(
      field,
      "must cover the minimum Queue SWEEP plus error, lease cleanup, and daily ledger reserves",
    );
  }
  if (field === "MAX_CATALOG_RESPONSE_BYTES" && value === 0) {
    throw new ObservationWorkerConfigError(field, "must be at least 1");
  }
  if (value > maximum) {
    throw new ObservationWorkerConfigError(field, `must not exceed ${maximum}`);
  }
  return value;
}

function platformLimits(plan: CloudflareWorkersPlan, cronIntervalMinutes: number): PlatformLimits {
  if (plan === "free") {
    return {
      cpuMsPerInvocation: 10,
      queueConsumerCpuMs: 30_000,
      wallTimeMsPerInvocation: 15 * 60_000,
      externalSubrequestsPerInvocation: 50,
      internalSubrequestsPerInvocation: 1_000,
      d1QueriesPerInvocation: 50,
      d1RowsReadPerDay: FREE_D1_READS_PER_DAY,
      d1RowsWrittenPerDay: FREE_D1_WRITES_PER_DAY,
    };
  }
  return {
    cpuMsPerInvocation: cronIntervalMinutes < 60 ? 30_000 : 15 * 60_000,
    queueConsumerCpuMs: 30_000,
    wallTimeMsPerInvocation: 15 * 60_000,
    externalSubrequestsPerInvocation: 10_000,
    internalSubrequestsPerInvocation: 10_000,
    d1QueriesPerInvocation: 1_000,
    d1RowsReadPerDay: null,
    d1RowsWrittenPerDay: null,
  };
}

function projectedFreeDailyBudget(
  cronIntervalMinutes: number,
  d1RowsReadPerRun: number,
  d1RowsWrittenPerRun: number,
): ProjectedDailyBudget {
  const invocations = Math.ceil(1_440 / cronIntervalMinutes);
  const maxAttemptsPerInvocation = QUEUE_MAX_RETRIES + 1;
  const maxAttempts = invocations * maxAttemptsPerInvocation;
  return {
    invocations,
    maxAttemptsPerInvocation,
    maxAttempts,
    d1RowsReadNominal: invocations * d1RowsReadPerRun,
    d1RowsWrittenNominal: invocations * d1RowsWrittenPerRun,
    d1RowsRead: maxAttempts * d1RowsReadPerRun,
    d1RowsWritten: maxAttempts * d1RowsWrittenPerRun,
    queueOperations: invocations * QUEUE_OPERATIONS_PER_MESSAGE,
    freeReadCeiling: FREE_D1_READS_PER_DAY * (1 - FREE_D1_RESERVE_RATIO),
    freeWriteCeiling: FREE_D1_WRITES_PER_DAY * (1 - FREE_D1_RESERVE_RATIO),
    freeQueueOperationsCeiling: FREE_QUEUE_OPERATIONS_PER_DAY * (1 - FREE_D1_RESERVE_RATIO),
  };
}

export function loadObservationWorkerConfig(env: WorkerEnvironment): ObservationWorkerConfig {
  const plan = parsePlan(env.CLOUDFLARE_WORKERS_PLAN);
  const profile = plan === "free" ? FREE_PROFILE : PAID_PROFILE;
  const values = { ...profile.defaults };

  for (const [field, property] of Object.entries(ENV_FIELDS) as Array<
    [keyof typeof ENV_FIELDS, keyof typeof values]
  >) {
    values[property] = parseInteger(env, field, values[property], profile.maximums[property]);
  }

  if (values.trust8004RequestsPerRun > values.externalSubrequestsPerRun) {
    throw new ObservationWorkerConfigError(
      "TRUST8004_REQUESTS_PER_RUN",
      "must not exceed EXTERNAL_SUBREQUESTS_PER_RUN",
    );
  }
  if (plan === "free" && values.sweepLimit > values.trust8004RequestsPerRun) {
    throw new ObservationWorkerConfigError(
      "SWEEP_LIMIT",
      "must not exceed TRUST8004_REQUESTS_PER_RUN on Free",
    );
  }

  const projectedDailyBudget = plan === "free"
    ? projectedFreeDailyBudget(
      values.cronIntervalMinutes,
      values.d1RowsReadPerRun,
      values.d1RowsWrittenPerRun,
    )
    : null;

  if (projectedDailyBudget !== null) {
    if (projectedDailyBudget.d1RowsWritten > projectedDailyBudget.freeWriteCeiling) {
      throw new ObservationWorkerConfigError(
        "D1_ROWS_WRITTEN_PER_RUN",
        `projects ${projectedDailyBudget.d1RowsWritten} rows/day; Free safety ceiling is ${projectedDailyBudget.freeWriteCeiling}`,
      );
    }
    if (projectedDailyBudget.d1RowsRead > projectedDailyBudget.freeReadCeiling) {
      throw new ObservationWorkerConfigError(
        "D1_ROWS_READ_PER_RUN",
        `projects ${projectedDailyBudget.d1RowsRead} rows/day; Free safety ceiling is ${projectedDailyBudget.freeReadCeiling}`,
      );
    }
    if (projectedDailyBudget.queueOperations > projectedDailyBudget.freeQueueOperationsCeiling) {
      throw new ObservationWorkerConfigError(
        "CRON_INTERVAL_MINUTES",
        `projects ${projectedDailyBudget.queueOperations} Queue operations/day; Free safety ceiling is ${projectedDailyBudget.freeQueueOperationsCeiling}`,
      );
    }
  }

  return {
    plan,
    killSwitch: parseKillSwitch(env.KILL_SWITCH),
    schedulerMode: profile.schedulerMode,
    probeAgentAllowlist: parseAgentAllowlist(env.PROBE_AGENT_ALLOWLIST, plan),
    probeEndpointAllowlist: parseEndpointAllowlist(env.PROBE_ENDPOINT_ALLOWLIST, plan),
    ...values,
    platformLimits: platformLimits(plan, values.cronIntervalMinutes),
    projectedDailyBudget,
  };
}
