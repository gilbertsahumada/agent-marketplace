import type { Env } from "./types";

export type WorkersPlan = "free" | "paid";
export type SchedulerMode = "single_phase" | "pipeline";

export interface WorkerConfig {
  plan: WorkersPlan;
  killSwitch: boolean;
  schedulerMode: SchedulerMode;
  cronIntervalMinutes: number;
  headerLimit: number;
  sweepLimit: number;
  sweepPagesPerRun: number;
  probeBatchSize: number;
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
    freeReadCeiling: number;
    freeWriteCeiling: number;
    freeQueueOperationsCeiling: number;
  } | null;
}

type NumericConfig = Omit<
  WorkerConfig,
  "plan" | "killSwitch" | "schedulerMode" | "platformLimits" | "projectedDailyBudget"
>;

interface Profile {
  schedulerMode: SchedulerMode;
  defaults: NumericConfig;
  maximums: NumericConfig;
}

const FREE_D1_READS_PER_DAY = 5_000_000;
const FREE_D1_WRITES_PER_DAY = 100_000;
const FREE_QUEUE_OPERATIONS_PER_DAY = 10_000;
const FREE_SAFETY_RATIO = 0.8;
const QUEUE_MAX_RETRIES = 3;
const QUEUE_OPERATIONS_PER_MESSAGE = 3 + QUEUE_MAX_RETRIES;

const FREE_PROFILE: Profile = {
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

const PAID_PROFILE: Profile = {
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

const NUMERIC_FIELDS = {
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
    "TRUST8004_REQUESTS_PER_RUN",
    "EXTERNAL_SUBREQUESTS_PER_RUN",
  ].includes(field) && value === 0) {
    throw new ConfigError(field, "must be at least 1");
  }
  if (field === "D1_QUERIES_PER_RUN" && value < 12) {
    throw new ConfigError(field, "must cover the minimum Queue SWEEP plus error and lease cleanup reserves");
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

export function loadConfig(env: Partial<Env>): WorkerConfig {
  const source = configEnvironment(env);
  const plan = parsePlan(source.CLOUDFLARE_WORKERS_PLAN);
  const profile = plan === "free" ? FREE_PROFILE : PAID_PROFILE;
  const values = { ...profile.defaults };

  for (const [field, property] of Object.entries(NUMERIC_FIELDS) as Array<
    [keyof typeof NUMERIC_FIELDS, keyof NumericConfig]
  >) {
    const raw = source[field];
    if (raw !== undefined) values[property] = parseInteger(field, raw, profile.maximums[property]);
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

  const invocations = Math.ceil(1_440 / values.cronIntervalMinutes);
  const maxAttemptsPerInvocation = QUEUE_MAX_RETRIES + 1;
  const maxAttempts = invocations * maxAttemptsPerInvocation;
  const projectedDailyBudget = plan === "free"
    ? {
        invocations,
        maxAttemptsPerInvocation,
        maxAttempts,
        d1RowsReadNominal: invocations * values.d1RowsReadPerRun,
        d1RowsWrittenNominal: invocations * values.d1RowsWrittenPerRun,
        d1RowsRead: maxAttempts * values.d1RowsReadPerRun,
        d1RowsWritten: maxAttempts * values.d1RowsWrittenPerRun,
        queueOperations: invocations * QUEUE_OPERATIONS_PER_MESSAGE,
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

  return {
    plan,
    killSwitch: parseKillSwitch(source.KILL_SWITCH),
    schedulerMode: profile.schedulerMode,
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
