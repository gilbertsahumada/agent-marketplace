import { createHash } from "node:crypto";

import {
  WP2_ATTEMPT_COHORT_SQL,
  WP2_D1_ACCOUNT_ANALYTICS_QUERY,
  WP2_D1_DATABASE_ANALYTICS_QUERY,
  WP2_QUEUE_ACCOUNT_ANALYTICS_QUERY,
  WP2_QUEUE_ANALYTICS_QUERY,
  WP2_WORKERS_ANALYTICS_QUERY,
} from "./wp2-24h-queries";

const DAY_MS = 24 * 60 * 60 * 1_000;
const TICK_MS = 5 * 60 * 1_000;
const EXPECTED_TICKS = DAY_MS / TICK_MS;
const EXPECTED_PER_PHASE = EXPECTED_TICKS / 3;
const REQUIRED_RAW_ANALYTICS = [
  "evidence/raw/analytics/d1-database.json",
  "evidence/raw/analytics/d1-account.json",
  "evidence/raw/analytics/workers.json",
  "evidence/raw/analytics/queue.json",
  "evidence/raw/analytics/queue-account.json",
  "evidence/raw/deployment.json",
  "evidence/raw/preflight.json",
  "evidence/raw/activation.json",
  "evidence/raw/window-start.json",
  "evidence/raw/cleanup.json",
  "evidence/raw/scheduler-attempts.json",
  "evidence/raw/drain.json",
  "evidence/raw/analytics/analytics-manifest.json",
] as const;
const PHASES = ["header", "sweep", "probe"] as const;
const OUTCOMES = ["completed", "failed", "duplicate", "locked"] as const;
const VERDICT_KEYS = ["attribution", "cleanup", "d1Daily", "d1PerAttempt",
  "phaseRotation", "queueTerminality", "tickCompleteness", "workerResources"] as const;

type Phase = typeof PHASES[number];
type Outcome = typeof OUTCOMES[number];

interface ValidationDependencies {
  readonly readRawEvidence: (path: string) => Promise<string>;
}

interface LedgerEntry {
  readonly messageId: string;
  readonly scheduledTime: number;
  readonly attempt: number;
  readonly phase: Phase | null;
  readonly outcome: Outcome;
  readonly upstreamRequests: number;
  readonly d1Queries: number;
  readonly rowsReadObservedBeforeLedger: number;
  readonly rowsWrittenObservedBeforeLedger: number;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly errorCode: string | null;
}

interface RawMetrics {
  readonly d1DatabaseRowsRead: number;
  readonly d1DatabaseRowsWritten: number;
  readonly d1AccountRowsRead: number;
  readonly d1AccountRowsWritten: number;
  readonly maxConsumerCpuMs: number;
  readonly maxProducerCpuMs: number;
  readonly memoryUsageBytesP999: number;
  readonly quotaErrors: number;
  readonly http429: number;
  readonly exceededCpu: number;
  readonly memoryExceeded: number;
  readonly queueOperations: number;
  readonly stagingQueueOperations: number;
  readonly preflightBacklogCount: number;
  readonly finalBacklogCount: number;
  readonly preflightSchedules: readonly string[];
  readonly installedSchedules: readonly string[];
  readonly drainSchedules: readonly string[];
  readonly drainBacklogCount: number;
  readonly drainKillSwitch: boolean;
  readonly drainProducerKillSwitch: boolean;
  readonly drainStagingManualRun: boolean;
  readonly drainSharedSecretPresent: boolean;
  readonly finalSchedules: readonly string[];
  readonly finalKillSwitch: boolean;
  readonly finalProducerKillSwitch: boolean;
  readonly finalStagingManualRun: boolean;
  readonly finalSharedSecretPresent: boolean;
  readonly preflightCapturedAt: number;
  readonly activationCapturedAt: number;
  readonly drainCapturedAt: number;
  readonly cleanupCapturedAt: number;
  readonly lastQueueTerminalAt: number;
}

export interface Wp224hValidationSummary {
  readonly passed: true;
  readonly ticks: number;
  readonly phaseCompletions: Readonly<Record<Phase, number>>;
  readonly retries: number;
  readonly attempts: number;
  readonly maxD1QueriesPerAttempt: number;
  readonly rotationStart: Phase;
}

export interface Wp224hBuildOptions {
  readonly accountId: string;
  readonly databaseId: string;
  readonly queueId: string;
  readonly windowStart: string;
  readonly workerName: string;
}

export class Wp224hArtifactValidationError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "Wp224hArtifactValidationError";
  }
}

export async function buildWp224hArtifact(
  options: Wp224hBuildOptions,
  dependencies: ValidationDependencies,
): Promise<Readonly<Record<string, unknown>>> {
  const start = utcMidnight(options.windowStart);
  const end = start + DAY_MS;
  const rawAnalytics: Record<string, { path: string; sha256: string }> = {};
  const parsed = new Map<string, Record<string, unknown>>();
  for (const path of REQUIRED_RAW_ANALYTICS) {
    const contents = await dependencies.readRawEvidence(path);
    rawAnalytics[path] = {
      path,
      sha256: createHash("sha256").update(contents).digest("hex"),
    };
    parsed.set(path, record(JSON.parse(contents), "RAW_JSON", path));
  }

  const ledgerRaw = record(parsed.get(REQUIRED_RAW_ANALYTICS[10]), "RAW_LEDGER", "scheduler attempts raw");
  const ledgerResponse = record(ledgerRaw.response, "RAW_LEDGER", "scheduler attempts response");
  if (!Array.isArray(ledgerResponse.result) || ledgerResponse.result.length !== 1) {
    fail("RAW_LEDGER", "scheduler attempt D1 response must contain one result");
  }
  const ledgerResult = record(ledgerResponse.result[0], "RAW_LEDGER", "scheduler attempts result");
  if (!Array.isArray(ledgerResult.results)) fail("RAW_LEDGER", "scheduler attempt rows are missing");
  const cohort = ledgerResult.results.map((entry, index) => ledgerEntry(entry, index));
  const ledger = cohort.filter(({ scheduledTime }) => scheduledTime >= start && scheduledTime < end);
  const quotaLedger = cohort.filter(({ startedAt }) => startedAt >= start && startedAt < end);

  const deploymentRaw = record(parsed.get(REQUIRED_RAW_ANALYTICS[5]), "RAW_DEPLOYMENT", "deployment raw");
  const deploymentRequest = record(deploymentRaw.request, "RAW_DEPLOYMENT", "deployment request");
  const deploymentVersion = stringPattern(
    deploymentRequest.measuredVersionId,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    "RAW_DEPLOYMENT",
    "measuredVersionId",
  );
  const deploymentResponse = record(deploymentRaw.response, "RAW_DEPLOYMENT", "deployment response");
  const measured = record(deploymentResponse.measured, "RAW_DEPLOYMENT", "measured deployment");
  const annotations = record(measured.annotations, "RAW_DEPLOYMENT", "deployment annotations");
  const message = nonEmptyString(annotations["workers/message"], "RAW_DEPLOYMENT", "deployment message");
  const commitMatch = /^git_commit=([a-f0-9]{40})$/.exec(message);
  if (commitMatch === null) fail("RAW_DEPLOYMENT", "deployment message does not identify one commit");
  const commit = commitMatch[1]!;

  const limits = {
    expectedTicks: EXPECTED_TICKS,
    expectedPerPhase: EXPECTED_PER_PHASE,
    d1QueriesPerAttempt: 40,
    d1RowsRead: 4_000_000,
    d1RowsWritten: 80_000,
    consumerCpuMs: 30_000,
    memoryBytesP999: 100_663_296,
  };
  const ledgerSummary = validateLedger(ledger, start, end, limits.d1QueriesPerAttempt);
  const validatedQuotaLedger = validateQuotaLedger(
    quotaLedger,
    start,
    end,
    limits.d1QueriesPerAttempt,
    ledgerSummary.entries,
  );
  const raw = await validateRawAnalytics(rawAnalytics, dependencies, {
    commit,
    accountId: options.accountId,
    deploymentVersion,
    workerName: options.workerName,
    queueId: options.queueId,
    d1Id: options.databaseId,
    start,
    end,
    rotationStart: ledgerSummary.rotationStart,
    tickLedger: ledgerSummary.entries,
    quotaLedger: validatedQuotaLedger,
  });
  const durations = validatedQuotaLedger
    .map(({ startedAt, finishedAt }) => finishedAt - startedAt)
    .sort((left, right) => left - right);
  const preflight = controlRaw(parsed.get(REQUIRED_RAW_ANALYTICS[6]), "preflight", {
    accountId: options.accountId, d1Id: options.databaseId,
    queueId: options.queueId, workerName: options.workerName,
  });
  const activation = controlRaw(parsed.get(REQUIRED_RAW_ANALYTICS[7]), "activation", {
    accountId: options.accountId, d1Id: options.databaseId,
    queueId: options.queueId, workerName: options.workerName,
  });
  const cleanup = controlRaw(parsed.get(REQUIRED_RAW_ANALYTICS[9]), "cleanup", {
    accountId: options.accountId, d1Id: options.databaseId,
    queueId: options.queueId, workerName: options.workerName,
  });
  const drain = controlRaw(parsed.get(REQUIRED_RAW_ANALYTICS[11]), "drain", {
    accountId: options.accountId, d1Id: options.databaseId,
    queueId: options.queueId, workerName: options.workerName,
  });
  const artifact = {
    schemaVersion: 1,
    commit,
    deploymentVersion,
    worker: { name: options.workerName },
    cloudflare: { accountId: options.accountId },
    queue: { id: options.queueId },
    d1: { id: options.databaseId },
    window: { start: options.windowStart, end: new Date(end).toISOString() },
    limits,
    ledger,
    quotaLedger,
    totals: {
      ticks: ledgerSummary.ticks,
      headerCompleted: ledgerSummary.phaseCompletions.header,
      sweepCompleted: ledgerSummary.phaseCompletions.sweep,
      probeCompleted: ledgerSummary.phaseCompletions.probe,
      retries: ledgerSummary.retries,
      d1RowsRead: raw.d1AccountRowsRead,
      d1RowsWritten: raw.d1AccountRowsWritten,
      quotaErrors: raw.quotaErrors,
      http429: raw.http429,
      exceededCpu: raw.exceededCpu,
      memoryExceeded: raw.memoryExceeded,
      maxD1QueriesPerAttempt: ledgerSummary.maxD1Queries,
      maxConsumerCpuMs: raw.maxConsumerCpuMs,
      maxProducerCpuMs: raw.maxProducerCpuMs,
      wallTimeP95Ms: durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] ?? 0,
      memoryUsageBytesP999: raw.memoryUsageBytesP999,
      queueOperations: raw.queueOperations,
      quotaAttempts: validatedQuotaLedger.length,
      spillIn: validatedQuotaLedger.filter(({ scheduledTime }) => scheduledTime < start).length,
      spillOut: ledgerSummary.entries.filter(({ startedAt }) => startedAt >= end).length,
    },
    rawAnalytics,
    accountUsage: {
      attributable: true,
      unrelatedRowsRead: raw.d1AccountRowsRead - raw.d1DatabaseRowsRead,
      unrelatedRowsWritten: raw.d1AccountRowsWritten - raw.d1DatabaseRowsWritten,
      unrelatedQueueOperations: raw.queueOperations - raw.stagingQueueOperations,
    },
    cleanup: {
      preflightSchedules: preflight.schedules,
      preflightBacklogCount: preflight.backlogCount,
      installedSchedules: activation.schedules,
      drainSchedules: drain.schedules,
      drainBacklogCount: drain.backlogCount,
      drainKillSwitch: drain.killSwitch,
      drainProducerKillSwitch: drain.producerKillSwitch,
      finalSchedules: cleanup.schedules,
      finalBacklogCount: cleanup.backlogCount,
      killSwitch: cleanup.killSwitch,
      producerKillSwitch: cleanup.producerKillSwitch,
      stagingManualRun: cleanup.stagingManualRun,
      sharedSecretPresent: cleanup.sharedSecretPresent,
    },
    verdicts: Object.fromEntries(VERDICT_KEYS.map((key) => [key, "pass"])),
  };
  await validateWp224hArtifact(artifact, dependencies);
  return artifact;
}

export async function validateWp224hArtifact(
  value: unknown,
  dependencies: ValidationDependencies,
): Promise<Wp224hValidationSummary> {
  const artifact = record(value, "STRUCTURE", "artifact");
  integerEqual(artifact.schemaVersion, 1, "STRUCTURE", "schemaVersion");
  stringPattern(artifact.commit, /^[a-f0-9]{40}$/, "STRUCTURE", "commit");
  stringPattern(
    artifact.deploymentVersion,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    "STRUCTURE",
    "deploymentVersion",
  );

  const worker = record(artifact.worker, "STRUCTURE", "worker");
  const workerName = nonEmptyString(worker.name, "STRUCTURE", "worker.name");
  const cloudflare = record(artifact.cloudflare, "STRUCTURE", "cloudflare");
  const accountId = stringPattern(
    cloudflare.accountId,
    /^[a-f0-9]{32}$/,
    "STRUCTURE",
    "cloudflare.accountId",
  );
  const queue = record(artifact.queue, "STRUCTURE", "queue");
  const queueId = stringPattern(queue.id, /^[a-f0-9]{32}$/, "STRUCTURE", "queue.id");
  const d1 = record(artifact.d1, "STRUCTURE", "d1");
  const d1Id = stringPattern(
    d1.id,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    "STRUCTURE",
    "d1.id",
  );

  const window = record(artifact.window, "STRUCTURE", "window");
  const start = utcMidnight(window.start);
  const end = isoTimestamp(window.end, "WINDOW_DURATION", "window.end");
  if (end - start !== DAY_MS) {
    fail("WINDOW_DURATION", "window must be exactly one UTC day with an exclusive end");
  }

  const limits = validateLimits(artifact.limits);
  const ledger = validateLedger(artifact.ledger, start, end, limits.d1QueriesPerAttempt);
  const quotaLedger = validateQuotaLedger(
    artifact.quotaLedger,
    start,
    end,
    limits.d1QueriesPerAttempt,
    ledger.entries,
  );
  const raw = await validateRawAnalytics(artifact.rawAnalytics, dependencies, {
    commit: artifact.commit as string,
    accountId,
    deploymentVersion: artifact.deploymentVersion as string,
    workerName,
    queueId,
    d1Id,
    start,
    end,
    rotationStart: ledger.rotationStart,
    tickLedger: ledger.entries,
    quotaLedger,
  });
  const totals = validateTotals(artifact.totals, limits, ledger, quotaLedger, raw, start, end);
  validateAttribution(artifact.accountUsage, totals, raw);
  validateCleanup(artifact.cleanup, raw, end, ledger.entries);
  validateVerdicts(artifact.verdicts);

  return {
    passed: true,
    ticks: ledger.ticks,
    phaseCompletions: ledger.phaseCompletions,
    retries: ledger.retries,
    attempts: ledger.entries.length,
    maxD1QueriesPerAttempt: ledger.maxD1Queries,
    rotationStart: ledger.rotationStart,
  };
}

function validateVerdicts(value: unknown): void {
  const verdicts = record(value, "VERDICTS", "verdicts");
  if (Object.keys(verdicts).length !== VERDICT_KEYS.length
    || VERDICT_KEYS.some((key) => verdicts[key] !== "pass")) {
    fail("VERDICTS", "artifact must persist one passing verdict for every validated gate");
  }
}

function utcMidnight(value: unknown): number {
  const timestamp = isoTimestamp(value, "WINDOW_UTC", "window.start");
  const date = new Date(timestamp);
  if (
    date.getUTCHours() !== 0
    || date.getUTCMinutes() !== 0
    || date.getUTCSeconds() !== 0
    || date.getUTCMilliseconds() !== 0
    || date.toISOString() !== value
  ) {
    fail("WINDOW_UTC", "window.start must be a canonical UTC midnight");
  }
  return timestamp;
}

function isoTimestamp(value: unknown, code: string, label: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail(code, `${label} must be a canonical UTC ISO timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    fail(code, `${label} is invalid`);
  }
  return timestamp;
}

function analyticsTimestamp(value: unknown, code: string, label: string): number {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    fail(code, `${label} must be a UTC ISO timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail(code, `${label} is invalid`);
  return timestamp;
}

function validateLimits(value: unknown): {
  readonly d1QueriesPerAttempt: number;
  readonly d1RowsRead: number;
  readonly d1RowsWritten: number;
  readonly consumerCpuMs: number;
  readonly memoryBytesP999: number;
} {
  const limits = record(value, "LIMITS", "limits");
  integerEqual(limits.expectedTicks, EXPECTED_TICKS, "LIMITS", "limits.expectedTicks");
  integerEqual(limits.expectedPerPhase, EXPECTED_PER_PHASE, "LIMITS", "limits.expectedPerPhase");
  integerEqual(limits.d1QueriesPerAttempt, 40, "LIMITS", "limits.d1QueriesPerAttempt");
  integerEqual(limits.d1RowsRead, 4_000_000, "LIMITS", "limits.d1RowsRead");
  integerEqual(limits.d1RowsWritten, 80_000, "LIMITS", "limits.d1RowsWritten");
  integerEqual(limits.consumerCpuMs, 30_000, "LIMITS", "limits.consumerCpuMs");
  integerEqual(limits.memoryBytesP999, 100_663_296, "LIMITS", "limits.memoryBytesP999");
  return {
    d1QueriesPerAttempt: 40,
    d1RowsRead: 4_000_000,
    d1RowsWritten: 80_000,
    consumerCpuMs: 30_000,
    memoryBytesP999: 100_663_296,
  };
}

function validateLedger(
  value: unknown,
  start: number,
  end: number,
  d1QueryLimit: number,
): {
  readonly entries: readonly LedgerEntry[];
  readonly ticks: number;
  readonly retries: number;
  readonly phaseCompletions: Record<Phase, number>;
  readonly maxD1Queries: number;
  readonly rotationStart: Phase;
} {
  if (!Array.isArray(value)) fail("TICK_COUNT", "ledger must be an array");
  const entries = value.map((entry, index) => ledgerEntry(entry, index));
  const byTick = new Map<number, LedgerEntry[]>();
  let maxD1Queries = 0;
  const firstScheduledTime = Math.min(...entries.map(({ scheduledTime }) => scheduledTime));
  const tickOffset = firstScheduledTime - start;
  if (!Number.isSafeInteger(tickOffset) || tickOffset < 0 || tickOffset >= 60_000) {
    fail("TICK_ALIGNMENT", "first tick must occur within the first UTC minute");
  }

  for (const entry of entries) {
    if (entry.scheduledTime < start || entry.scheduledTime >= end
      || (entry.scheduledTime - start - tickOffset) % TICK_MS !== 0) {
      fail("TICK_ALIGNMENT", `unaligned scheduledTime ${entry.scheduledTime}`);
    }
    if (entry.d1Queries > d1QueryLimit) {
      fail("D1_QUERY_LIMIT", `attempt used ${entry.d1Queries} D1 queries`);
    }
    maxD1Queries = Math.max(maxD1Queries, entry.d1Queries);
    const attempts = byTick.get(entry.scheduledTime) ?? [];
    attempts.push(entry);
    byTick.set(entry.scheduledTime, attempts);
  }

  if (byTick.size !== EXPECTED_TICKS) {
    fail("TICK_COUNT", `expected ${EXPECTED_TICKS} distinct ticks, received ${byTick.size}`);
  }

  const phaseCompletions: Record<Phase, number> = { header: 0, sweep: 0, probe: 0 };
  let rotationStart: Phase | null = null;
  for (let index = 0; index < EXPECTED_TICKS; index += 1) {
    const scheduledTime = start + tickOffset + index * TICK_MS;
    const attempts = byTick.get(scheduledTime);
    if (attempts === undefined) fail("TICK_COUNT", `missing tick ${scheduledTime}`);
    const byMessage = new Map<string, LedgerEntry[]>();
    for (const attempt of attempts) {
      const deliveries = byMessage.get(attempt.messageId) ?? [];
      deliveries.push(attempt);
      byMessage.set(attempt.messageId, deliveries);
    }
    if (byMessage.size !== 1) {
      fail("MESSAGE_ID", `tick ${scheduledTime} must map to exactly one Queue message`);
    }
    for (const [messageId, deliveries] of byMessage) {
      deliveries.sort((left, right) => left.attempt - right.attempt);
      for (let attemptIndex = 0; attemptIndex < deliveries.length; attemptIndex += 1) {
        if (deliveries[attemptIndex]!.attempt !== attemptIndex + 1) {
          fail("RETRY_SEQUENCE", `message ${messageId} has a non-contiguous retry sequence`);
        }
      }
    }
    const completed = attempts.filter(({ outcome }) => outcome === "completed");
    if (completed.length !== 1) fail("RETRY_OUTCOME", `tick ${scheduledTime} must contain one completion`);
    const completedDeliveries = byMessage.get(completed[0]!.messageId)!;
    const completedIndex = completedDeliveries.indexOf(completed[0]!);
    if (completedDeliveries.slice(0, completedIndex)
      .some(({ outcome }) => outcome !== "failed" && outcome !== "locked")
      || completedDeliveries.slice(completedIndex + 1).some(({ outcome }) => outcome !== "duplicate")) {
      fail("RETRY_OUTCOME", `tick ${scheduledTime} has an invalid retry or duplicate sequence`);
    }
    const completedPhase = completed[0]!.phase;
    if (completedPhase === null) fail("PHASE_COUNT", `completed tick ${scheduledTime} has no phase`);
    rotationStart ??= completedPhase;
    const expectedPhase = PHASES[(PHASES.indexOf(rotationStart) + index) % PHASES.length];
    if (completedPhase !== expectedPhase) {
      fail("PHASE_SEQUENCE", `tick ${scheduledTime} does not follow header, sweep, probe`);
    }
    phaseCompletions[completedPhase] += 1;
  }

  if (PHASES.some((phase) => phaseCompletions[phase] !== EXPECTED_PER_PHASE)) {
    fail("PHASE_COUNT", `expected ${EXPECTED_PER_PHASE} completed ticks per phase`);
  }

  return {
    entries,
    ticks: byTick.size,
    retries: entries.length - byTick.size,
    phaseCompletions,
    maxD1Queries,
    rotationStart: rotationStart!,
  };
}

function ledgerEntry(value: unknown, index: number): LedgerEntry {
  const entry = record(value, "LEDGER", `ledger[${index}]`);
  const outcome = enumValue(entry.outcome, OUTCOMES, "LEDGER", `ledger[${index}].outcome`);
  const phase = entry.phase === null
    ? null
    : enumValue(entry.phase, PHASES, "LEDGER", `ledger[${index}].phase`);
  if (outcome === "completed" && phase === null) {
    fail("PHASE_COUNT", `ledger[${index}].phase is required for a completed attempt`);
  }
  const messageId = nonEmptyString(entry.messageId, "LEDGER", `ledger[${index}].messageId`);
  if (messageId.length > 256) fail("LEDGER", `ledger[${index}].messageId is too long`);
  const startedAt = nonNegativeInteger(entry.startedAt, "LEDGER", `ledger[${index}].startedAt`);
  const finishedAt = nonNegativeInteger(entry.finishedAt, "LEDGER", `ledger[${index}].finishedAt`);
  if (finishedAt < startedAt) fail("LEDGER", `ledger[${index}] finishes before it starts`);
  return {
    messageId,
    scheduledTime: nonNegativeInteger(entry.scheduledTime, "LEDGER", `ledger[${index}].scheduledTime`),
    attempt: positiveInteger(entry.attempt, "RETRY_SEQUENCE", `ledger[${index}].attempt`, 4),
    phase,
    outcome,
    upstreamRequests: nonNegativeInteger(entry.upstreamRequests, "LEDGER", `ledger[${index}].upstreamRequests`, 12),
    d1Queries: nonNegativeInteger(entry.d1Queries, "LEDGER", `ledger[${index}].d1Queries`),
    rowsReadObservedBeforeLedger: nonNegativeInteger(
      entry.rowsReadObservedBeforeLedger,
      "LEDGER",
      `ledger[${index}].rowsReadObservedBeforeLedger`,
    ),
    rowsWrittenObservedBeforeLedger: nonNegativeInteger(
      entry.rowsWrittenObservedBeforeLedger,
      "LEDGER",
      `ledger[${index}].rowsWrittenObservedBeforeLedger`,
    ),
    startedAt,
    finishedAt,
    errorCode: entry.errorCode === null
      ? null
      : nonEmptyString(entry.errorCode, "LEDGER", `ledger[${index}].errorCode`),
  };
}

function validateQuotaLedger(
  value: unknown,
  start: number,
  end: number,
  d1QueryLimit: number,
  tickEntries: readonly LedgerEntry[],
): readonly LedgerEntry[] {
  if (!Array.isArray(value)) fail("QUOTA_COHORT", "quotaLedger must be an array");
  const entries = value.map((entry, index) => ledgerEntry(entry, index));
  const quotaKeys = new Set<string>();
  for (const entry of entries) {
    if (entry.startedAt < start || entry.startedAt >= end) {
      fail("QUOTA_COHORT", "quotaLedger contains an attempt outside the UTC quota day");
    }
    if (entry.d1Queries > d1QueryLimit) fail("D1_QUERY_LIMIT", "quota attempt exceeded D1 query limit");
    const key = `${entry.messageId}:${entry.attempt}`;
    if (quotaKeys.has(key)) fail("QUOTA_COHORT", `duplicate quota attempt ${key}`);
    quotaKeys.add(key);
  }
  for (const entry of tickEntries) {
    const belongsToQuotaDay = entry.startedAt >= start && entry.startedAt < end;
    if (quotaKeys.has(`${entry.messageId}:${entry.attempt}`) !== belongsToQuotaDay) {
      fail("QUOTA_COHORT", "tick and quota cohorts do not reconcile");
    }
  }
  const tickKeys = new Set(tickEntries.map(({ messageId, attempt }) => `${messageId}:${attempt}`));
  for (const entry of entries) {
    if (tickKeys.has(`${entry.messageId}:${entry.attempt}`)) continue;
    if (entry.scheduledTime >= start || entry.scheduledTime >= end) {
      fail("QUOTA_COHORT", "quotaLedger contains an attempt omitted from the tick cohort");
    }
    const terminal = entry.outcome === "completed" || entry.outcome === "duplicate";
    if (!terminal) fail("QUOTA_COHORT", "spill-in Queue message is not terminal");
  }
  return entries;
}

function validateTotals(
  value: unknown,
  limits: ReturnType<typeof validateLimits>,
  ledger: ReturnType<typeof validateLedger>,
  quotaLedger: readonly LedgerEntry[],
  raw: RawMetrics,
  start: number,
  end: number,
): { readonly d1RowsRead: number; readonly d1RowsWritten: number } {
  const totals = record(value, "TOTALS", "totals");
  integerEqual(totals.ticks, ledger.ticks, "TOTALS", "totals.ticks");
  integerEqual(totals.headerCompleted, ledger.phaseCompletions.header, "PHASE_COUNT", "totals.headerCompleted");
  integerEqual(totals.sweepCompleted, ledger.phaseCompletions.sweep, "PHASE_COUNT", "totals.sweepCompleted");
  integerEqual(totals.probeCompleted, ledger.phaseCompletions.probe, "PHASE_COUNT", "totals.probeCompleted");
  integerEqual(totals.retries, ledger.retries, "RETRY_COUNT", "totals.retries");
  integerEqual(totals.quotaAttempts, quotaLedger.length, "QUOTA_COHORT", "totals.quotaAttempts");
  integerEqual(
    totals.spillIn,
    quotaLedger.filter(({ scheduledTime }) => scheduledTime < start).length,
    "QUOTA_COHORT",
    "totals.spillIn",
  );
  integerEqual(
    totals.spillOut,
    ledger.entries.filter(({ startedAt }) => startedAt >= end).length,
    "QUOTA_COHORT",
    "totals.spillOut",
  );
  integerEqual(
    totals.maxD1QueriesPerAttempt,
    ledger.maxD1Queries,
    "D1_QUERY_LIMIT",
    "totals.maxD1QueriesPerAttempt",
  );

  const d1RowsRead = nonNegativeInteger(totals.d1RowsRead, "D1_READ_LIMIT", "totals.d1RowsRead");
  if (d1RowsRead >= limits.d1RowsRead) fail("D1_READ_LIMIT", "D1 rows read did not retain the Free reserve");
  integerEqual(d1RowsRead, raw.d1AccountRowsRead, "RAW_D1", "totals.d1RowsRead");
  const d1RowsWritten = nonNegativeInteger(totals.d1RowsWritten, "D1_WRITE_LIMIT", "totals.d1RowsWritten");
  if (d1RowsWritten >= limits.d1RowsWritten) fail("D1_WRITE_LIMIT", "D1 rows written did not retain the Free reserve");
  integerEqual(d1RowsWritten, raw.d1AccountRowsWritten, "RAW_D1", "totals.d1RowsWritten");

  integerEqual(totals.quotaErrors, raw.quotaErrors, "RAW_WORKERS", "totals.quotaErrors");
  zero(totals.quotaErrors, "QUOTA_ERRORS", "totals.quotaErrors");
  integerEqual(totals.http429, raw.http429, "RAW_WORKERS", "totals.http429");
  zero(totals.http429, "HTTP_429", "totals.http429");
  integerEqual(totals.exceededCpu, raw.exceededCpu, "RAW_WORKERS", "totals.exceededCpu");
  zero(totals.exceededCpu, "CPU_LIMIT", "totals.exceededCpu");
  integerEqual(totals.memoryExceeded, raw.memoryExceeded, "RAW_WORKERS", "totals.memoryExceeded");
  zero(totals.memoryExceeded, "MEMORY_LIMIT", "totals.memoryExceeded");
  const maxConsumerCpuMs = nonNegativeNumber(totals.maxConsumerCpuMs, "CPU_LIMIT", "totals.maxConsumerCpuMs");
  numberEqual(maxConsumerCpuMs, raw.maxConsumerCpuMs, "RAW_WORKERS", "totals.maxConsumerCpuMs");
  if (maxConsumerCpuMs >= limits.consumerCpuMs) fail("CPU_LIMIT", "consumer CPU reached its limit");
  const maxProducerCpuMs = nonNegativeNumber(totals.maxProducerCpuMs, "CPU_LIMIT", "totals.maxProducerCpuMs");
  numberEqual(maxProducerCpuMs, raw.maxProducerCpuMs, "RAW_WORKERS", "totals.maxProducerCpuMs");
  if (maxProducerCpuMs >= 10) fail("CPU_LIMIT", "Cron producer CPU reached its Free limit");
  const durations = quotaLedger.map(({ startedAt, finishedAt }) => finishedAt - startedAt).sort((a, b) => a - b);
  const wallTimeP95Ms = durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] ?? 0;
  integerEqual(totals.wallTimeP95Ms, wallTimeP95Ms, "WALL_TIME", "totals.wallTimeP95Ms");
  if (wallTimeP95Ms >= 30_000) fail("WALL_TIME", "consumer wall-time P95 reached 30 seconds");
  const memoryUsageBytesP999 = nonNegativeNumber(
    totals.memoryUsageBytesP999,
    "MEMORY_LIMIT",
    "totals.memoryUsageBytesP999",
  );
  numberEqual(memoryUsageBytesP999, raw.memoryUsageBytesP999, "RAW_WORKERS", "totals.memoryUsageBytesP999");
  if (memoryUsageBytesP999 >= limits.memoryBytesP999) fail("MEMORY_LIMIT", "memory P999 reached its limit");
  integerEqual(totals.queueOperations, raw.queueOperations, "RAW_QUEUE", "totals.queueOperations");
  if (raw.queueOperations >= 8_000) fail("RAW_QUEUE", "Queue operations did not retain the Free reserve");
  return { d1RowsRead, d1RowsWritten };
}

async function validateRawAnalytics(
  value: unknown,
  dependencies: ValidationDependencies,
  context: {
    readonly commit: string;
    readonly accountId: string;
    readonly deploymentVersion: string;
    readonly workerName: string;
    readonly queueId: string;
    readonly d1Id: string;
    readonly start: number;
    readonly end: number;
    readonly rotationStart: Phase;
    readonly tickLedger: readonly LedgerEntry[];
    readonly quotaLedger: readonly LedgerEntry[];
  },
): Promise<RawMetrics> {
  if (typeof dependencies?.readRawEvidence !== "function") {
    fail("RAW_ANALYTICS", "readRawEvidence dependency is required");
  }
  const analytics = record(value, "RAW_ANALYTICS", "rawAnalytics");
  for (const requiredPath of REQUIRED_RAW_ANALYTICS) {
    if (!(requiredPath in analytics)) fail("RAW_ANALYTICS", `missing ${requiredPath}`);
  }

  const parsed = new Map<string, Record<string, unknown>>();
  for (const [key, unvalidatedEntry] of Object.entries(analytics)) {
    const entry = record(unvalidatedEntry, "RAW_ANALYTICS", `rawAnalytics.${key}`);
    if (entry.path !== key || typeof entry.path !== "string" || entry.path.length === 0) {
      fail("RAW_ANALYTICS", `raw path mismatch for ${key}`);
    }
    const expectedHash = stringPattern(entry.sha256, /^[a-f0-9]{64}$/, "RAW_HASH", `${key}.sha256`);
    let contents: string;
    try {
      contents = await dependencies.readRawEvidence(entry.path);
    } catch {
      fail("RAW_ANALYTICS", `could not read ${entry.path}`);
    }
    if (typeof contents !== "string") fail("RAW_ANALYTICS", `${entry.path} did not contain text`);
    const actualHash = createHash("sha256").update(contents).digest("hex");
    if (actualHash !== expectedHash) fail("RAW_HASH", `SHA-256 mismatch for ${entry.path}`);
    try {
      parsed.set(key, record(JSON.parse(contents), "RAW_JSON", key));
    } catch (error) {
      if (error instanceof Wp224hArtifactValidationError) throw error;
      fail("RAW_JSON", `${key} is not valid JSON`);
    }
  }
  const date = new Date(context.start).toISOString().slice(0, 10);
  const startIso = new Date(context.start).toISOString();
  const endInclusiveIso = new Date(context.end - 1).toISOString();
  const earliestCapture = context.end + 15 * 60_000;
  graphqlProvenance(parsed.get(REQUIRED_RAW_ANALYTICS[0]), {
    accountTag: context.accountId, date, databaseId: context.d1Id,
  }, WP2_D1_DATABASE_ANALYTICS_QUERY, context.accountId, earliestCapture, "RAW_D1");
  graphqlProvenance(parsed.get(REQUIRED_RAW_ANALYTICS[1]), {
    accountTag: context.accountId, date,
  }, WP2_D1_ACCOUNT_ANALYTICS_QUERY, context.accountId, earliestCapture, "RAW_D1");
  const database = d1Raw(parsed.get(REQUIRED_RAW_ANALYTICS[0]), "database", date, context.d1Id);
  const account = d1Raw(parsed.get(REQUIRED_RAW_ANALYTICS[1]), "account", date);
  validateRawLedger(parsed.get(REQUIRED_RAW_ANALYTICS[10]), context);
  const accountDatabase = account.groups.find(({ databaseId }) => databaseId === context.d1Id);
  if (accountDatabase === undefined
    || accountDatabase.rowsRead !== database.rowsRead
    || accountDatabase.rowsWritten !== database.rowsWritten) {
    fail("RAW_D1", "database and account Analytics disagree for staging D1");
  }

  const trustedWorkerVersions = deploymentVersionsRaw(parsed.get(REQUIRED_RAW_ANALYTICS[5]), {
    scriptName: context.workerName,
    measuredVersionId: context.deploymentVersion,
    commit: context.commit,
  });

  const workersRaw = record(parsed.get(REQUIRED_RAW_ANALYTICS[2]), "RAW_WORKERS", "workers raw");
  graphqlProvenance(workersRaw, {
    accountTag: context.accountId,
    scriptName: context.workerName,
    start: startIso,
    terminalityEndInclusive: record(workersRaw.request, "RAW_WORKERS", "Workers request")
      .terminalityEndInclusive,
  }, WP2_WORKERS_ANALYTICS_QUERY, context.accountId, earliestCapture, "RAW_WORKERS");
  const workersRequest = record(workersRaw.request, "RAW_WORKERS", "Workers request");
  validateWindowRequest(workersRaw.request, {
    scriptName: context.workerName,
    start: startIso,
    endInclusive: endInclusiveIso,
  }, "RAW_WORKERS");
  const workersTerminalityEnd = isoTimestamp(
    workersRequest.terminalityEndInclusive,
    "RAW_WORKERS",
    "Workers terminalityEndInclusive",
  );
  if (workersTerminalityEnd < context.end + 15 * 60_000) {
    fail("RAW_WORKERS", "Workers evidence ended before the terminality grace");
  }
  const workers = nestedGroups(workersRaw, "workersInvocationsAdaptive", "RAW_WORKERS");
  const workerSamples: {
    timestamp: number;
    cpuMs: number;
    requests: number;
    subrequests: number;
    scriptVersion: string;
  }[] = [];
  let memoryUsageBytesP999 = 0;
  let workerErrors = 0;
  let exceededCpu = 0;
  let memoryExceeded = 0;
  let measuredVersionGroups = 0;
  for (const [index, unvalidated] of workers.entries()) {
    const group = record(unvalidated, "RAW_WORKERS", `workers[${index}]`);
    const dimensions = record(group.dimensions, "RAW_WORKERS", `workers[${index}].dimensions`);
    if (dimensions.scriptName !== context.workerName) {
      fail("RAW_DEPLOYMENT", "Workers Analytics contains another script");
    }
    const scriptVersion = nonEmptyString(
      dimensions.scriptVersion,
      "RAW_WORKERS",
      `workers[${index}].scriptVersion`,
    );
    if (!trustedWorkerVersions.has(scriptVersion)) {
      fail("RAW_DEPLOYMENT", "Workers Analytics contains an unauthenticated deployment version");
    }
    if (scriptVersion === context.deploymentVersion) measuredVersionGroups += 1;
    const status = nonEmptyString(dimensions.status, "RAW_WORKERS", `workers[${index}].status`).toLowerCase();
    if (status.includes("cpu") && status.includes("exceed")) exceededCpu += 1;
    if (status.includes("memory") && status.includes("exceed")) memoryExceeded += 1;
    const quantiles = record(group.quantiles, "RAW_WORKERS", `workers[${index}].quantiles`);
    const sum = record(group.sum, "RAW_WORKERS", `workers[${index}].sum`);
    const timestamp = analyticsTimestamp(dimensions.datetime, "RAW_WORKERS", `workers[${index}].datetime`);
    if (timestamp < context.start || timestamp > workersTerminalityEnd) {
      fail("RAW_WORKERS", "Workers sample falls outside the requested evidence interval");
    }
    workerSamples.push({
      timestamp,
      cpuMs: nonNegativeNumber(quantiles.cpuTimeP99, "RAW_WORKERS", `workers[${index}].cpuTimeP99`) / 1_000,
      requests: positiveInteger(sum.requests, "RAW_WORKERS", `workers[${index}].requests`),
      subrequests: nonNegativeInteger(sum.subrequests, "RAW_WORKERS", `workers[${index}].subrequests`),
      scriptVersion,
    });
    memoryUsageBytesP999 = Math.max(memoryUsageBytesP999,
      nonNegativeNumber(quantiles.memoryUsageBytesP999, "RAW_WORKERS", `workers[${index}].memoryP999`));
    workerErrors += nonNegativeInteger(sum.errors, "RAW_WORKERS", `workers[${index}].errors`);
  }
  if (measuredVersionGroups === 0) {
    fail("RAW_DEPLOYMENT", "Workers Analytics does not contain the measured deployment version");
  }

  const queueRaw = record(parsed.get(REQUIRED_RAW_ANALYTICS[3]), "RAW_QUEUE", "queue raw");
  graphqlProvenance(queueRaw, {
    accountTag: context.accountId,
    queueId: context.queueId,
    start: startIso,
    endInclusive: endInclusiveIso,
    terminalityEndInclusive: record(queueRaw.request, "RAW_QUEUE", "Queue request")
      .terminalityEndInclusive,
  }, WP2_QUEUE_ANALYTICS_QUERY, context.accountId, earliestCapture, "RAW_QUEUE");
  const terminalityEnd = isoTimestamp(
    record(queueRaw.request, "RAW_QUEUE", "Queue request").terminalityEndInclusive,
    "RAW_QUEUE",
    "queue terminalityEndInclusive",
  );
  if (terminalityEnd < context.end + 15 * 60_000) {
    fail("QUEUE_TERMINALITY", "Queue terminality window ended before the 15-minute grace");
  }
  if (terminalityEnd !== workersTerminalityEnd) {
    fail("RAW_WORKERS", "Workers and Queue terminality cutoffs differ");
  }
  validateWindowRequest(queueRaw.request, {
    queueId: context.queueId,
    start: startIso,
    endInclusive: endInclusiveIso,
  }, "RAW_QUEUE");
  const queueDayGroups = nestedGroups(queueRaw, "queueDayOperations", "RAW_QUEUE");
  let queueOperations = 0;
  for (const [index, unvalidated] of queueDayGroups.entries()) {
    const group = record(unvalidated, "RAW_QUEUE", `queue day[${index}]`);
    const dimensions = record(group.dimensions, "RAW_QUEUE", `queue day[${index}].dimensions`);
    if (dimensions.queueId !== context.queueId) fail("RAW_QUEUE", "Queue Analytics contains another Queue");
    const sum = record(group.sum, "RAW_QUEUE", `queue day[${index}].sum`);
    queueOperations += nonNegativeInteger(sum.billableOperations, "RAW_QUEUE", `queue day[${index}].operations`);
  }
  const queueTerminalGroups = nestedGroups(queueRaw, "queueTerminalOperations", "RAW_QUEUE");
  let queueWrites = 0;
  let successfulDeletes = 0;
  let lastQueueTerminalAt = 0;
  const deleteSamples: { timestamp: number; remaining: number }[] = [];
  const producerTimestamps = new Set<number>();
  for (const [index, unvalidated] of queueTerminalGroups.entries()) {
    const group = record(unvalidated, "RAW_QUEUE", `queue terminal[${index}]`);
    const dimensions = record(group.dimensions, "RAW_QUEUE", `queue terminal[${index}].dimensions`);
    if (dimensions.queueId !== context.queueId) fail("RAW_QUEUE", "Queue Analytics contains another Queue");
    const count = nonNegativeInteger(group.count, "RAW_QUEUE", `queue[${index}].count`);
    const actionType = nonEmptyString(dimensions.actionType, "RAW_QUEUE", `queue[${index}].actionType`);
    const outcome = typeof dimensions.outcome === "string" ? dimensions.outcome.toLowerCase() : "";
    if (actionType === "WriteMessage") {
      queueWrites += count;
      producerTimestamps.add(analyticsTimestamp(
        dimensions.datetime,
        "RAW_QUEUE",
        `queue[${index}].datetime`,
      ));
    }
    if (actionType === "DeleteMessage") {
      if (outcome !== "success") fail("QUEUE_TERMINALITY", "Queue contains an unsuccessful delete");
      successfulDeletes += count;
      const timestamp = analyticsTimestamp(
        dimensions.datetime,
        "RAW_QUEUE",
        `queue[${index}].datetime`,
      );
      lastQueueTerminalAt = Math.max(lastQueueTerminalAt, timestamp);
      deleteSamples.push({ timestamp, remaining: count });
    }
    const retryCount = nonNegativeNumber(
      record(group.avg, "RAW_QUEUE", `queue[${index}].avg`).retryCount,
      "RAW_QUEUE",
      `queue[${index}].retryCount`,
    );
    if (retryCount > 3) fail("QUEUE_TERMINALITY", "Queue retry count exceeded the configured maximum");
  }
  const spillInMessages = new Set(context.quotaLedger
    .filter(({ scheduledTime }) => scheduledTime < context.start)
    .map(({ messageId }) => messageId)).size;
  if (queueWrites !== EXPECTED_TICKS || successfulDeletes !== EXPECTED_TICKS + spillInMessages) {
    fail("QUEUE_TERMINALITY", "Queue Analytics does not contain one write and successful delete per tick");
  }
  let maxProducerCpuMs = 0;
  let maxConsumerCpuMs = 0;
  let producerSamples = 0;
  let consumerSamples = 0;
  let producerRequests = 0;
  let consumerRequests = 0;
  for (const sample of workerSamples) {
    const nearWrite = [...producerTimestamps].some((timestamp) => Math.abs(timestamp - sample.timestamp) <= 1_000);
    if (nearWrite && sample.subrequests === 0) {
      producerSamples += 1;
      producerRequests += sample.requests;
      maxProducerCpuMs = Math.max(maxProducerCpuMs, sample.cpuMs);
    } else if (!nearWrite
      && sample.subrequests === 0
      && sample.scriptVersion !== context.deploymentVersion) {
      maxProducerCpuMs = Math.max(maxProducerCpuMs, sample.cpuMs);
    } else if (!nearWrite && sample.subrequests > 0) {
      consumerSamples += 1;
      consumerRequests += sample.requests;
      maxConsumerCpuMs = Math.max(maxConsumerCpuMs, sample.cpuMs);
    } else {
      fail("RAW_WORKERS", "Workers sample is ambiguous between Cron producer and Queue consumer");
    }
  }
  if (producerSamples === 0 || consumerSamples === 0 || producerRequests !== queueWrites) {
    fail("RAW_WORKERS", "Workers Analytics cannot separate Cron producer and Queue consumer CPU");
  }
  const consumerAttemptKeys = new Set([...context.tickLedger, ...context.quotaLedger]
    .filter(({ startedAt }) => startedAt >= context.start && startedAt <= workersTerminalityEnd)
    .map(({ messageId, attempt }) => `${messageId}:${attempt}`));
  if (consumerRequests !== consumerAttemptKeys.size) {
    fail("RAW_WORKERS", "Workers consumer requests do not match the durable attempt cohort");
  }
  const spillOutAttempts = context.tickLedger.filter(({ startedAt }) => startedAt >= context.end);
  const consumerCapacity = workerSamples.map((sample) => ({ sample, remaining: sample.requests }));
  deleteSamples.sort((left, right) => left.timestamp - right.timestamp);
  const orderedSpillOut = [...spillOutAttempts].sort((left, right) => left.startedAt - right.startedAt);
  for (const attempt of orderedSpillOut) {
    const workerMatch = consumerCapacity.find(({ sample, remaining }) =>
      remaining > 0 && sample.subrequests > 0 && Math.abs(sample.timestamp - attempt.startedAt) <= 1_000);
    if (workerMatch === undefined) {
      fail("RAW_WORKERS", "Workers Analytics is missing a spill-out consumer attempt");
    }
    workerMatch.remaining -= 1;
  }
  const terminalSpillOut = context.tickLedger
    .filter(({ outcome, finishedAt }) => outcome === "completed" && finishedAt >= context.end)
    .sort((left, right) => left.finishedAt - right.finishedAt);
  for (const attempt of terminalSpillOut) {
    const deleteMatch = deleteSamples.find(({ timestamp, remaining }) =>
      remaining > 0 && timestamp + 1_000 >= attempt.finishedAt);
    if (deleteMatch === undefined) {
      fail("QUEUE_TERMINALITY", "Queue Analytics is missing a causal spill-out delete");
    }
    deleteMatch.remaining -= 1;
  }
  const backlogGroups = nestedGroups(queueRaw, "queueBacklogAdaptiveGroups", "RAW_QUEUE");
  const terminalBacklog = backlogGroups
    .map((unvalidated, index) => {
      const group = record(unvalidated, "RAW_QUEUE", `queue backlog[${index}]`);
      const dimensions = record(group.dimensions, "RAW_QUEUE", `queue backlog[${index}].dimensions`);
      if (dimensions.queueId !== context.queueId) fail("RAW_QUEUE", "Queue backlog contains another Queue");
      return {
        timestamp: analyticsTimestamp(dimensions.datetime, "RAW_QUEUE", "Queue backlog datetime"),
        messages: nonNegativeNumber(record(group.avg, "RAW_QUEUE", "Queue backlog avg").messages,
          "RAW_QUEUE", "Queue backlog messages"),
      };
    })
    .sort((left, right) => left.timestamp - right.timestamp).at(-1);
  const lastScheduledTime = Math.max(...context.tickLedger.map(({ scheduledTime }) => scheduledTime));
  if (terminalBacklog === undefined
    || terminalBacklog.timestamp < lastScheduledTime
    || terminalBacklog.messages !== 0) {
    fail("QUEUE_TERMINALITY", "Queue Analytics does not prove zero backlog after the last tick");
  }

  const queueAccountRaw = record(parsed.get(REQUIRED_RAW_ANALYTICS[4]), "RAW_QUEUE", "account Queue raw");
  graphqlProvenance(queueAccountRaw, {
    accountTag: context.accountId, start: startIso, endInclusive: endInclusiveIso,
  }, WP2_QUEUE_ACCOUNT_ANALYTICS_QUERY, context.accountId, earliestCapture, "RAW_QUEUE");
  validateWindowRequest(queueAccountRaw.request, { start: startIso, endInclusive: endInclusiveIso }, "RAW_QUEUE");
  const queueAccountGroups = nestedGroups(
    queueAccountRaw,
    "queueMessageOperationsAdaptiveGroups",
    "RAW_QUEUE",
  );
  let accountQueueOperations = 0;
  let accountStagingOperations = 0;
  for (const [index, unvalidated] of queueAccountGroups.entries()) {
    const group = record(unvalidated, "RAW_QUEUE", `account queue[${index}]`);
    const dimensions = record(group.dimensions, "RAW_QUEUE", `account queue[${index}].dimensions`);
    const id = nonEmptyString(dimensions.queueId, "RAW_QUEUE", `account queue[${index}].queueId`);
    const operations = nonNegativeInteger(
      record(group.sum, "RAW_QUEUE", `account queue[${index}].sum`).billableOperations,
      "RAW_QUEUE",
      `account queue[${index}].operations`,
    );
    accountQueueOperations += operations;
    if (id === context.queueId) accountStagingOperations += operations;
  }
  if (accountStagingOperations !== queueOperations) {
    fail("RAW_QUEUE", "staging and account-wide Queue Analytics disagree");
  }

  const controlContext = { accountId: context.accountId, d1Id: context.d1Id,
    queueId: context.queueId, workerName: context.workerName };
  const preflight = controlRaw(parsed.get(REQUIRED_RAW_ANALYTICS[6]), "preflight", controlContext);
  const activation = controlRaw(parsed.get(REQUIRED_RAW_ANALYTICS[7]), "activation", controlContext);
  const windowStart = windowStartRaw(
    parsed.get(REQUIRED_RAW_ANALYTICS[8]),
    context.accountId,
    context.d1Id,
  );
  const firstScheduledTime = Math.min(...context.tickLedger.map(({ scheduledTime }) => scheduledTime));
  if (windowStart.startedAt < firstScheduledTime - TICK_MS
    || windowStart.completedAt >= firstScheduledTime
    || windowStart.completedAt < windowStart.startedAt
    || windowStart.lastQueueScheduledTime !== firstScheduledTime - TICK_MS) {
    fail("RAW_WINDOW_START", "window-start capture timing or final pre-window tick is invalid");
  }
  if (windowStart.nextPhase !== context.rotationStart) {
    fail("PHASE_SEQUENCE", "persisted phase immediately before the window does not match the first tick");
  }
  const cleanup = controlRaw(parsed.get(REQUIRED_RAW_ANALYTICS[9]), "cleanup", controlContext);
  const drain = controlRaw(parsed.get(REQUIRED_RAW_ANALYTICS[11]), "drain", controlContext);
  const http429 = context.quotaLedger.filter(({ errorCode }) => errorCode?.includes("429") === true).length;
  const quotaErrors = context.quotaLedger.filter(({ errorCode }) =>
    errorCode !== null && /quota|limit|exceeded/i.test(errorCode)).length;
  const workerErrorCohort = [...context.quotaLedger, ...spillOutAttempts];
  const workerHttp429 = workerErrorCohort.filter(({ errorCode }) => errorCode?.includes("429") === true).length;
  const workerQuotaErrors = workerErrorCohort.filter(({ errorCode }) =>
    errorCode !== null && /quota|limit|exceeded/i.test(errorCode)).length;
  if (workerErrors !== workerHttp429 + workerQuotaErrors + exceededCpu + memoryExceeded) {
    fail("RAW_WORKERS", "Workers error total is not explained by the durable ledger");
  }
  validateAnalyticsManifest(parsed, analytics);
  return {
    d1DatabaseRowsRead: database.rowsRead,
    d1DatabaseRowsWritten: database.rowsWritten,
    d1AccountRowsRead: account.rowsRead,
    d1AccountRowsWritten: account.rowsWritten,
    maxConsumerCpuMs,
    maxProducerCpuMs,
    memoryUsageBytesP999,
    quotaErrors,
    http429,
    exceededCpu,
    memoryExceeded,
    queueOperations: accountQueueOperations,
    stagingQueueOperations: queueOperations,
    preflightBacklogCount: preflight.backlogCount,
    finalBacklogCount: cleanup.backlogCount,
    preflightSchedules: preflight.schedules,
    installedSchedules: activation.schedules,
    drainSchedules: drain.schedules,
    drainBacklogCount: drain.backlogCount,
    drainKillSwitch: drain.killSwitch,
    drainProducerKillSwitch: drain.producerKillSwitch,
    drainStagingManualRun: drain.stagingManualRun,
    drainSharedSecretPresent: drain.sharedSecretPresent,
    finalSchedules: cleanup.schedules,
    finalKillSwitch: cleanup.killSwitch,
    finalProducerKillSwitch: cleanup.producerKillSwitch,
    finalStagingManualRun: cleanup.stagingManualRun,
    finalSharedSecretPresent: cleanup.sharedSecretPresent,
    preflightCapturedAt: preflight.capturedAt,
    activationCapturedAt: activation.capturedAt,
    drainCapturedAt: drain.capturedAt,
    cleanupCapturedAt: cleanup.capturedAt,
    lastQueueTerminalAt,
  };
}

function validateAnalyticsManifest(
  parsed: ReadonlyMap<string, Record<string, unknown>>,
  analytics: Readonly<Record<string, unknown>>,
): void {
  const manifestPath = REQUIRED_RAW_ANALYTICS[12];
  const manifest = record(parsed.get(manifestPath), "RAW_ANALYTICS", "analytics manifest");
  integerEqual(manifest.schemaVersion, 1, "RAW_ANALYTICS", "analytics manifest schemaVersion");
  const captureId = stringPattern(
    manifest.captureId,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    "RAW_ANALYTICS",
    "analytics manifest captureId",
  );
  const files = record(manifest.files, "RAW_ANALYTICS", "analytics manifest files");
  const expectedPaths = REQUIRED_RAW_ANALYTICS.slice(0, 5);
  const expectedNames = expectedPaths.map((path) => path.slice(path.lastIndexOf("/") + 1));
  if (Object.keys(files).length !== expectedNames.length
    || expectedNames.some((name) => !(name in files))) {
    fail("RAW_ANALYTICS", "analytics manifest file set is incomplete");
  }
  for (const [index, path] of expectedPaths.entries()) {
    const name = expectedNames[index]!;
    const entry = record(analytics[path], "RAW_ANALYTICS", `rawAnalytics.${path}`);
    if (files[name] !== entry.sha256) {
      fail("RAW_HASH", `analytics manifest SHA-256 mismatch for ${name}`);
    }
    const payload = record(parsed.get(path), "RAW_ANALYTICS", path);
    const request = record(payload.request, "RAW_ANALYTICS", `${path}.request`);
    if (request.captureId !== captureId) {
      fail("RAW_ANALYTICS", `analytics captureId mismatch for ${name}`);
    }
  }
}

function validateRawLedger(
  value: unknown,
  context: {
    readonly accountId: string;
    readonly d1Id: string;
    readonly start: number;
    readonly end: number;
    readonly tickLedger: readonly LedgerEntry[];
    readonly quotaLedger: readonly LedgerEntry[];
  },
): void {
  const raw = record(value, "RAW_LEDGER", "scheduler attempts raw");
  const request = record(raw.request, "RAW_LEDGER", "scheduler attempts request");
  const startedAt = isoTimestamp(request.startedAt, "RAW_LEDGER", "scheduler attempts startedAt");
  const completedAt = isoTimestamp(request.completedAt, "RAW_LEDGER", "scheduler attempts completedAt");
  const capturedAt = isoTimestamp(request.capturedAt, "RAW_LEDGER", "scheduler attempts capturedAt");
  if (request.accountId !== context.accountId
    || request.databaseId !== context.d1Id
    || request.sql !== WP2_ATTEMPT_COHORT_SQL
    || request.windowStart !== new Date(context.start).toISOString()
    || request.windowEnd !== new Date(context.end).toISOString()
    || startedAt < context.end + 15 * 60_000
    || completedAt < startedAt || completedAt - startedAt > 10_000
    || capturedAt !== completedAt
    || !sameNumberArray(request.params, [context.start, context.end, context.start, context.end])) {
    fail("RAW_LEDGER", "scheduler attempt query provenance does not match the artifact window");
  }
  const response = record(raw.response, "RAW_LEDGER", "scheduler attempts response");
  if (response.success !== true || !emptyArray(response.errors) || !Array.isArray(response.result)
    || response.result.length !== 1) {
    fail("RAW_LEDGER", "scheduler attempt D1 response failed");
  }
  const result = record(response.result[0], "RAW_LEDGER", "scheduler attempts result");
  if (!Array.isArray(result.results)) fail("RAW_LEDGER", "scheduler attempt rows are missing");
  const observed = result.results.map((entry, index) => ledgerEntry(entry, index));
  if (observed.some(({ finishedAt }) => finishedAt > capturedAt)) {
    fail("RAW_LEDGER", "scheduler attempts were captured before they finished");
  }
  const expectedByKey = new Map<string, LedgerEntry>();
  for (const entry of [...context.tickLedger, ...context.quotaLedger]) {
    expectedByKey.set(`${entry.messageId}:${entry.attempt}`, entry);
  }
  const expected = [...expectedByKey.values()].sort((left, right) =>
    left.scheduledTime - right.scheduledTime
      || left.messageId.localeCompare(right.messageId)
      || left.attempt - right.attempt);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    fail("RAW_LEDGER", "artifact ledgers differ from the literal D1 cohort");
  }
}

function windowStartRaw(
  value: unknown,
  expectedAccountId: string,
  expectedDatabaseId: string,
): {
  readonly completedAt: number;
  readonly lastQueueScheduledTime: number;
  readonly nextPhase: Phase;
  readonly startedAt: number;
} {
  const raw = record(value, "RAW_WINDOW_START", "window-start raw");
  const request = record(raw.request, "RAW_WINDOW_START", "window-start request");
  if (request.accountId !== expectedAccountId
    || request.databaseId !== expectedDatabaseId
    || request.sql !== "SELECT key, textValue AS value, integerValue FROM runtime_state WHERE key IN (?, ?) ORDER BY key ASC"
    || !sameStringArray(request.params, ["last_queue_scheduled_time", "next_scheduler_phase"])) {
    fail("RAW_WINDOW_START", "window-start request provenance does not match the artifact");
  }
  const startedAt = isoTimestamp(request.startedAt, "RAW_WINDOW_START", "window-start startedAt");
  const completedAt = isoTimestamp(request.completedAt, "RAW_WINDOW_START", "window-start completedAt");
  if (request.capturedAt !== request.completedAt) {
    fail("RAW_WINDOW_START", "window-start capturedAt must equal completedAt");
  }
  const response = record(raw.response, "RAW_WINDOW_START", "window-start response");
  if (response.success !== true || !Array.isArray(response.errors) || response.errors.length !== 0) {
    fail("RAW_WINDOW_START", "window-start D1 response is not successful");
  }
  if (!Array.isArray(response.result) || response.result.length !== 1) {
    fail("RAW_WINDOW_START", "window-start D1 response must contain one result");
  }
  const result = record(response.result[0], "RAW_WINDOW_START", "window-start result");
  if (!Array.isArray(result.results) || result.results.length !== 2) {
    fail("RAW_WINDOW_START", "window-start D1 response must contain two rows");
  }
  const rows = new Map(result.results.map((entry, index) => {
    const row = record(entry, "RAW_WINDOW_START", `window-start row ${index}`);
    return [row.key, row] as const;
  }));
  if (rows.size !== 2) fail("RAW_WINDOW_START", "window-start D1 rows are duplicated");
  const phase = rows.get("next_scheduler_phase");
  const finalTick = rows.get("last_queue_scheduled_time");
  if (phase === undefined || finalTick === undefined) {
    fail("RAW_WINDOW_START", "window-start D1 keys are invalid");
  }
  return {
    completedAt,
    lastQueueScheduledTime: nonNegativeInteger(
      finalTick.integerValue,
      "RAW_WINDOW_START",
      "window-start last_queue_scheduled_time",
    ),
    nextPhase: enumValue(phase.value, PHASES, "RAW_WINDOW_START", "window-start phase"),
    startedAt,
  };
}

function deploymentVersionsRaw(
  value: unknown,
  expected: { readonly scriptName: string; readonly measuredVersionId: string; readonly commit: string },
): ReadonlySet<string> {
  const raw = record(value, "RAW_DEPLOYMENT", "deployment raw");
  const request = record(raw.request, "RAW_DEPLOYMENT", "deployment request");
  if (!Array.isArray(request.drainVersionIds)
    || request.drainVersionIds.some((versionId) => typeof versionId !== "string" || versionId.length === 0)) {
    fail("RAW_DEPLOYMENT", "drainVersionIds are invalid");
  }
  const drainVersionIds = request.drainVersionIds as string[];
  if (request.scriptName !== expected.scriptName
    || request.measuredVersionId !== expected.measuredVersionId
    || drainVersionIds.length === 0) {
    fail("RAW_DEPLOYMENT", "deployment request does not match the measured window");
  }
  const response = record(raw.response, "RAW_DEPLOYMENT", "deployment response");
  const measured = record(response.measured, "RAW_DEPLOYMENT", "measured deployment");
  if (!Array.isArray(response.drainVersions)) fail("RAW_DEPLOYMENT", "drain deployments are invalid");
  const drainVersions = response.drainVersions;
  if (drainVersions.length !== drainVersionIds.length) {
    fail("RAW_DEPLOYMENT", "drain deployment responses do not match the request");
  }

  const expectedMessage = `git_commit=${expected.commit}`;
  const tagPrefix = `git-${expected.commit.slice(0, 12)}`;
  const measuredEtag = deploymentVersionMetadata(
    measured,
    expected.measuredVersionId,
    expectedMessage,
    tagPrefix,
    true,
  );
  const trusted = new Set<string>([expected.measuredVersionId]);
  for (const [index, unvalidated] of drainVersions.entries()) {
    const version = record(unvalidated, "RAW_DEPLOYMENT", `drain deployment ${index}`);
    const versionId = drainVersionIds[index]!;
    if (trusted.has(versionId)) fail("RAW_DEPLOYMENT", "deployment version IDs are duplicated");
    const etag = deploymentVersionMetadata(version, versionId, expectedMessage, tagPrefix, false);
    if (etag !== measuredEtag) fail("RAW_DEPLOYMENT", "drain deployment bundle differs from measured bundle");
    trusted.add(versionId);
  }
  return trusted;
}

function deploymentVersionMetadata(
  value: Record<string, unknown>,
  expectedVersionId: string,
  expectedMessage: string,
  tagPrefix: string,
  measured: boolean,
): string {
  const annotations = record(value.annotations, "RAW_DEPLOYMENT", "deployment annotations");
  const resources = record(value.resources, "RAW_DEPLOYMENT", "deployment resources");
  const script = record(resources.script, "RAW_DEPLOYMENT", "deployment script");
  const tag = nonEmptyString(annotations["workers/tag"], "RAW_DEPLOYMENT", "deployment tag");
  const validTag = measured ? tag === tagPrefix : tag.startsWith(`${tagPrefix}-`);
  if (value.id !== expectedVersionId
    || annotations["workers/message"] !== expectedMessage
    || !validTag) {
    fail("RAW_DEPLOYMENT", "deployment metadata does not match the artifact");
  }
  return stringPattern(script.etag, /^[a-f0-9]{64}$/, "RAW_DEPLOYMENT", "deployment script etag");
}

function d1Raw(
  value: unknown,
  scope: "database" | "account",
  date: string,
  expectedDatabaseId?: string,
): {
  readonly groups: readonly { databaseId: string; rowsRead: number; rowsWritten: number }[];
  readonly rowsRead: number;
  readonly rowsWritten: number;
} {
  const raw = record(value, "RAW_D1", `${scope} D1 raw`);
  const request = record(raw.request, "RAW_D1", `${scope} D1 request`);
  if (request.date !== date || (expectedDatabaseId !== undefined && request.databaseId !== expectedDatabaseId)) {
    fail("RAW_D1", `${scope} D1 request does not match the artifact window or database`);
  }
  const unvalidatedGroups = nestedGroups(raw, "d1AnalyticsAdaptiveGroups", "RAW_D1");
  const groups = unvalidatedGroups.map((unvalidated, index) => {
    const group = record(unvalidated, "RAW_D1", `${scope} D1 group ${index}`);
    const dimensions = record(group.dimensions, "RAW_D1", `${scope} D1 dimensions ${index}`);
    const databaseId = stringPattern(
      dimensions.databaseId,
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      "RAW_D1",
      `${scope} databaseId`,
    );
    if (dimensions.date !== date) fail("RAW_D1", `${scope} D1 group has another date`);
    const sum = record(group.sum, "RAW_D1", `${scope} D1 sum ${index}`);
    return {
      databaseId,
      rowsRead: nonNegativeInteger(sum.rowsRead, "RAW_D1", `${scope} rowsRead ${index}`),
      rowsWritten: nonNegativeInteger(sum.rowsWritten, "RAW_D1", `${scope} rowsWritten ${index}`),
    };
  });
  if (scope === "database" && (groups.length !== 1 || groups[0]?.databaseId !== expectedDatabaseId)) {
    fail("RAW_D1", "database Analytics must contain exactly the staging D1 group");
  }
  return {
    groups,
    rowsRead: groups.reduce((total, group) => total + group.rowsRead, 0),
    rowsWritten: groups.reduce((total, group) => total + group.rowsWritten, 0),
  };
}

function nestedGroups(raw: Record<string, unknown>, field: string, code: string): readonly unknown[] {
  const response = record(raw.response, code, `${field} response`);
  if (response.errors !== undefined && response.errors !== null
    && (!Array.isArray(response.errors) || response.errors.length !== 0)) {
    fail(code, `${field} response contains GraphQL errors`);
  }
  const data = record(response.data, code, `${field} data`);
  const viewer = record(data.viewer, code, `${field} viewer`);
  if (!Array.isArray(viewer.accounts) || viewer.accounts.length !== 1) {
    fail(code, `${field} must contain exactly one account`);
  }
  const account = record(viewer.accounts[0], code, `${field} account`);
  if (!Array.isArray(account[field])) fail(code, `${field} groups are missing`);
  return account[field];
}

function validateWindowRequest(
  value: unknown,
  expected: Readonly<Record<string, string>>,
  code: string,
): void {
  const request = record(value, code, `${code} request`);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (request[key] !== expectedValue) fail(code, `${key} does not match the artifact`);
  }
}

function graphqlProvenance(
  value: unknown,
  expectedVariables: Readonly<Record<string, unknown>>,
  expectedQuery: string,
  expectedAccountId: string,
  earliestCapture: number,
  code: string,
): void {
  const raw = record(value, code, `${code} raw`);
  const request = record(raw.request, code, `${code} request`);
  const variables = record(request.variables, code, `${code} variables`);
  const capturedAt = isoTimestamp(request.capturedAt, code, `${code} capturedAt`);
  if (request.accountId !== expectedAccountId
    || request.endpoint !== "https://api.cloudflare.com/client/v4/graphql"
    || request.query !== expectedQuery
    || capturedAt < earliestCapture
    || Object.keys(variables).length !== Object.keys(expectedVariables).length
    || Object.entries(expectedVariables).some(([key, expected]) => variables[key] !== expected)) {
    fail(code, "GraphQL query provenance does not match the measured window");
  }
}

function controlRaw(
  value: unknown,
  label: "preflight" | "activation" | "drain" | "cleanup",
  context: { readonly accountId: string; readonly d1Id: string;
    readonly queueId: string; readonly workerName: string },
): {
  readonly schedules: readonly string[];
  readonly backlogCount: number;
  readonly killSwitch: boolean;
  readonly producerKillSwitch: boolean;
  readonly stagingManualRun: boolean;
  readonly sharedSecretPresent: boolean;
  readonly capturedAt: number;
} {
  const raw = record(value, "RAW_CLEANUP", `${label} raw`);
  const request = record(raw.request, "RAW_CLEANUP", `${label} request`);
  const schedulesUrl = `https://api.cloudflare.com/client/v4/accounts/${context.accountId}/workers/scripts/${context.workerName}/schedules`;
  const settingsUrl = `https://api.cloudflare.com/client/v4/accounts/${context.accountId}/workers/scripts/${context.workerName}/settings`;
  const backlogUrl = `https://api.cloudflare.com/client/v4/accounts/${context.accountId}/queues/${context.queueId}/metrics`;
  const startedAt = isoTimestamp(request.startedAt, "RAW_CLEANUP", `${label} startedAt`);
  const completedAt = isoTimestamp(request.completedAt, "RAW_CLEANUP", `${label} completedAt`);
  if (request.accountId !== context.accountId || request.queueId !== context.queueId
    || request.scriptName !== context.workerName || request.mode !== label
    || request.schedulesUrl !== schedulesUrl || request.settingsUrl !== settingsUrl
    || request.backlogUrl !== backlogUrl
    || completedAt < startedAt || completedAt - startedAt > 10_000) {
    fail("RAW_CLEANUP", `${label} request provenance is invalid`);
  }
  if (label === "drain") {
    if (request.healthUrl !== undefined) {
      fail("RAW_CLEANUP", "drain must not contact Worker health");
    }
  } else {
    try {
      const healthUrl = new URL(nonEmptyString(request.healthUrl, "RAW_CLEANUP", `${label} healthUrl`));
      if (healthUrl.protocol !== "https:" || healthUrl.pathname !== "/health"
        || healthUrl.search !== "" || healthUrl.hash !== "") {
        fail("RAW_CLEANUP", `${label} health URL is invalid`);
      }
    } catch (error) {
      if (error instanceof Wp224hArtifactValidationError) throw error;
      fail("RAW_CLEANUP", `${label} health URL is invalid`);
    }
  }
  const response = record(raw.response, "RAW_CLEANUP", `${label} response`);
  const schedulesResponse = record(response.schedules, "RAW_CLEANUP", `${label} schedules response`);
  const schedulesResult = record(schedulesResponse.result, "RAW_CLEANUP", `${label} schedules result`);
  if (schedulesResponse.success !== true || !emptyArray(schedulesResponse.errors)
    || !Array.isArray(schedulesResult.schedules)) {
    fail("RAW_CLEANUP", `${label} schedules response is invalid`);
  }
  const schedules = schedulesResult.schedules.map((entry, index) => {
    const schedule = record(entry, "RAW_CLEANUP", `${label} schedule[${index}]`);
    return nonEmptyString(schedule.cron, "RAW_CLEANUP", `${label} schedule cron`);
  });
  const settingsResponse = record(response.settings, "RAW_CLEANUP", `${label} settings response`);
  const settingsResult = record(settingsResponse.result, "RAW_CLEANUP", `${label} settings result`);
  if (settingsResponse.success !== true || !emptyArray(settingsResponse.errors)
    || !Array.isArray(settingsResult.bindings)) {
    fail("RAW_CLEANUP", `${label} settings response is invalid`);
  }
  const settingBindings = new Map<string, Record<string, unknown>>();
  for (const [index, entry] of settingsResult.bindings.entries()) {
    const binding = record(entry, "RAW_CLEANUP", `${label} setting[${index}]`);
    const name = nonEmptyString(binding.name, "RAW_CLEANUP", `${label} setting name`);
    if (settingBindings.has(name)) fail("RAW_CLEANUP", `${label} setting names are duplicated`);
    settingBindings.set(name, binding);
  }
  const producing = label === "activation";
  const consuming = label === "activation" || label === "drain";
  const expectedBindings = new Map<string, string>([
    ["DEPLOYMENT_ENV", "staging"],
    ["CLOUDFLARE_WORKERS_PLAN", "free"],
    ["CRON_INTERVAL_MINUTES", "5"],
    ["HEADER_LIMIT", "25"],
    ["SWEEP_LIMIT", "4"],
    ["SWEEP_PAGES_PER_RUN", "1"],
    ["PROBE_BATCH_SIZE", "1"],
    ["TRUST8004_REQUESTS_PER_RUN", "4"],
    ["EXTERNAL_SUBREQUESTS_PER_RUN", "12"],
    ["D1_QUERIES_PER_RUN", "40"],
    ["D1_ROWS_READ_PER_RUN", "3000"],
    ["D1_ROWS_WRITTEN_PER_RUN", "60"],
    ["PROBE_TIMEOUT_MS", "5000"],
    ["MAX_CATALOG_RESPONSE_BYTES", "16777216"],
    ["MAX_SELLER_RESPONSE_BYTES", "32768"],
    ["KILL_SWITCH", consuming ? "0" : "1"],
    ["PRODUCER_KILL_SWITCH", producing ? "0" : "1"],
    ["STAGING_MANUAL_RUN", "0"],
  ]);
  for (const [name, expected] of expectedBindings) {
    const binding = settingBindings.get(name);
    if (binding?.type !== "plain_text" || binding.text !== expected) {
      fail("RAW_CLEANUP", `${label} deployed ${name} binding is unsafe`);
    }
  }
  const d1Binding = settingBindings.get("DB");
  const queueBinding = settingBindings.get("WP2_QUEUE");
  if (d1Binding?.type !== "d1" || d1Binding.id !== context.d1Id
    || queueBinding?.type !== "queue" || queueBinding.queue_name !== context.workerName) {
    fail("RAW_CLEANUP", `${label} resource bindings do not match the artifact`);
  }
  const backlogResponse = record(response.backlog, "RAW_CLEANUP", `${label} backlog response`);
  const backlogResult = record(backlogResponse.result, "RAW_CLEANUP", `${label} backlog result`);
  if (backlogResponse.success !== true || !emptyArray(backlogResponse.errors)) {
    fail("RAW_CLEANUP", `${label} backlog response is invalid`);
  }
  const backlogCount = nonNegativeInteger(
    backlogResult.backlog_count,
    "RAW_CLEANUP",
    `${label} backlog_count`,
  );
  nonNegativeInteger(backlogResult.backlog_bytes, "RAW_CLEANUP", `${label} backlog_bytes`);
  if (label === "drain") {
    if (response.health !== undefined) {
      fail("RAW_CLEANUP", "drain must not serialize Worker health");
    }
  } else {
    const health = record(response.health, "RAW_CLEANUP", `${label} health response`);
    const budgets = record(health.budgets, "RAW_CLEANUP", `${label} health budgets`);
    const expectedBudgets: Readonly<Record<string, number>> = {
      cronIntervalMinutes: 5, headerLimit: 25, sweepLimit: 4, sweepPagesPerRun: 1,
      probeBatchSize: 1, trust8004RequestsPerRun: 4, externalSubrequestsPerRun: 12,
      d1QueriesPerRun: 40, d1RowsReadPerRun: 3000, d1RowsWrittenPerRun: 60,
      probeTimeoutMs: 5000, maxCatalogResponseBytes: 16777216, maxSellerResponseBytes: 32768,
    };
    if (health.plan !== "free" || health.schedulerMode !== "single_phase"
      || Object.entries(expectedBudgets).some(([name, expected]) => budgets[name] !== expected)) {
      fail("RAW_CLEANUP", `${label} health does not match the Free profile`);
    }
    if (health.status !== "ok" || health.killSwitch !== !consuming
      || health.producerKillSwitch !== !producing
      || (health.stagingManualRun !== undefined && health.stagingManualRun !== false)) {
      fail("RAW_CLEANUP", `${label} safety state is invalid`);
    }
  }
  if (!Array.isArray(response.secrets)) fail("RAW_CLEANUP", `${label} secret list is invalid`);
  const secretNames = response.secrets.map((entry, index) =>
    nonEmptyString(record(entry, "RAW_CLEANUP", `${label} secret[${index}]`).name,
      "RAW_CLEANUP", `${label} secret name`));
  return {
    schedules,
    backlogCount,
    killSwitch: settingBindings.get("KILL_SWITCH")!.text === "1",
    producerKillSwitch: settingBindings.get("PRODUCER_KILL_SWITCH")!.text === "1",
    stagingManualRun: settingBindings.get("STAGING_MANUAL_RUN")!.text === "1",
    sharedSecretPresent: secretNames.includes("SHARED_SECRET"),
    capturedAt: completedAt,
  };
}

function validateAttribution(
  value: unknown,
  totals: { readonly d1RowsRead: number; readonly d1RowsWritten: number },
  raw: RawMetrics,
): void {
  const usage = record(value, "ATTRIBUTION", "accountUsage");
  if (usage.attributable !== true) fail("ATTRIBUTION", "account-wide D1 usage is not attributable");
  const unrelatedRowsRead = nonNegativeInteger(
    usage.unrelatedRowsRead,
    "ATTRIBUTION",
    "accountUsage.unrelatedRowsRead",
  );
  const unrelatedRowsWritten = nonNegativeInteger(
    usage.unrelatedRowsWritten,
    "ATTRIBUTION",
    "accountUsage.unrelatedRowsWritten",
  );
  const unrelatedQueueOperations = nonNegativeInteger(
    usage.unrelatedQueueOperations,
    "ATTRIBUTION",
    "accountUsage.unrelatedQueueOperations",
  );
  integerEqual(
    unrelatedRowsRead,
    raw.d1AccountRowsRead - raw.d1DatabaseRowsRead,
    "ATTRIBUTION",
    "accountUsage.unrelatedRowsRead",
  );
  integerEqual(
    unrelatedRowsWritten,
    raw.d1AccountRowsWritten - raw.d1DatabaseRowsWritten,
    "ATTRIBUTION",
    "accountUsage.unrelatedRowsWritten",
  );
  if (unrelatedRowsRead > totals.d1RowsRead || unrelatedRowsWritten > totals.d1RowsWritten) {
    fail("ATTRIBUTION", "unrelated usage cannot exceed account totals");
  }
  integerEqual(
    unrelatedQueueOperations,
    raw.queueOperations - raw.stagingQueueOperations,
    "ATTRIBUTION",
    "accountUsage.unrelatedQueueOperations",
  );
}

function validateCleanup(
  value: unknown,
  raw: RawMetrics,
  end: number,
  tickLedger: readonly LedgerEntry[],
): void {
  const cleanup = record(value, "CLEANUP", "cleanup");
  const firstScheduledTime = Math.min(...tickLedger.map(({ scheduledTime }) => scheduledTime));
  const lastScheduledTime = Math.max(...tickLedger.map(({ scheduledTime }) => scheduledTime));
  if (raw.preflightCapturedAt > raw.activationCapturedAt
    || raw.activationCapturedAt >= firstScheduledTime) {
    fail("CLEANUP", "control evidence timestamps are out of order");
  }
  if (raw.drainCapturedAt < lastScheduledTime || raw.drainCapturedAt >= end
    || raw.drainCapturedAt <= raw.activationCapturedAt) {
    fail("CLEANUP", "producer drain evidence is outside the shutdown barrier");
  }
  if (raw.cleanupCapturedAt < end + 15 * 60_000) {
    fail("CLEANUP_GRACE", "cleanup was captured before the 15-minute terminality grace");
  }
  const lastFinishedAt = Math.max(...tickLedger.map(({ finishedAt }) => finishedAt));
  if (raw.cleanupCapturedAt < lastFinishedAt || raw.cleanupCapturedAt < raw.lastQueueTerminalAt) {
    fail("CLEANUP_GRACE", "cleanup was captured before the final terminal attempt or Queue delete");
  }
  if (!sameStringArray(cleanup.preflightSchedules, raw.preflightSchedules)
    || !emptyArray(cleanup.preflightSchedules)
    || cleanup.preflightBacklogCount !== raw.preflightBacklogCount
    || raw.preflightBacklogCount !== 0
    || !sameStringArray(cleanup.installedSchedules, raw.installedSchedules)
    || raw.installedSchedules.length !== 1
    || raw.installedSchedules[0] !== "*/5 * * * *"
    || !sameStringArray(cleanup.drainSchedules, raw.drainSchedules)
    || !emptyArray(cleanup.drainSchedules)
    || cleanup.drainBacklogCount !== raw.drainBacklogCount
    || cleanup.drainKillSwitch !== raw.drainKillSwitch
    || raw.drainKillSwitch !== false
    || cleanup.drainProducerKillSwitch !== raw.drainProducerKillSwitch
    || raw.drainProducerKillSwitch !== true
    || raw.drainStagingManualRun !== false
    || raw.drainSharedSecretPresent !== false
    || !sameStringArray(cleanup.finalSchedules, raw.finalSchedules)
    || !emptyArray(cleanup.finalSchedules)
    || cleanup.finalBacklogCount !== raw.finalBacklogCount
    || raw.finalBacklogCount !== 0
    || cleanup.killSwitch !== raw.finalKillSwitch
    || raw.finalKillSwitch !== true
    || cleanup.producerKillSwitch !== raw.finalProducerKillSwitch
    || raw.finalProducerKillSwitch !== true
    || cleanup.stagingManualRun !== raw.finalStagingManualRun
    || raw.finalStagingManualRun !== false
    || cleanup.sharedSecretPresent !== raw.finalSharedSecretPresent
    || raw.finalSharedSecretPresent !== false) {
    fail("CLEANUP", "preflight, active schedule or final safe state is incomplete");
  }
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function sameNumberArray(value: unknown, expected: readonly number[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function record(value: unknown, code: string, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(code, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  code: string,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) fail(code, `${label} is invalid`);
  return value as T[number];
}

function nonEmptyString(value: unknown, code: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail(code, `${label} must be a non-empty string`);
  return value;
}

function stringPattern(value: unknown, pattern: RegExp, code: string, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(code, `${label} has an invalid format`);
  return value;
}

function nonNegativeInteger(value: unknown, code: string, label: string, maximum?: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (maximum !== undefined && (value as number) > maximum)) {
    fail(code, `${label} must be a non-negative integer${maximum === undefined ? "" : ` no greater than ${maximum}`}`);
  }
  return value as number;
}

function positiveInteger(value: unknown, code: string, label: string, maximum?: number): number {
  const parsed = nonNegativeInteger(value, code, label, maximum);
  if (parsed === 0) fail(code, `${label} must be positive`);
  return parsed;
}

function nonNegativeNumber(value: unknown, code: string, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(code, `${label} must be a finite non-negative number`);
  }
  return value;
}

function integerEqual(value: unknown, expected: number, code: string, label: string): void {
  if (!Number.isSafeInteger(value) || value !== expected) fail(code, `${label} must equal ${expected}`);
}

function numberEqual(value: unknown, expected: number, code: string, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value !== expected) {
    fail(code, `${label} must equal ${expected}`);
  }
}

function zero(value: unknown, code: string, label: string): void {
  integerEqual(value, 0, code, label);
}

function emptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

function fail(code: string, detail: string): never {
  throw new Wp224hArtifactValidationError(code, detail);
}
