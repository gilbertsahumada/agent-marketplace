import { createHash } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1_000;
const TICK_MS = 5 * 60 * 1_000;
const EXPECTED_TICKS = DAY_MS / TICK_MS;
const EXPECTED_PER_PHASE = EXPECTED_TICKS / 3;
const REQUIRED_RAW_ANALYTICS = [
  "evidence/raw/d1-database.json",
  "evidence/raw/d1-account.json",
  "evidence/raw/workers.json",
  "evidence/raw/queue.json",
] as const;
const PHASES = ["header", "sweep", "probe"] as const;
const OUTCOMES = ["completed", "failed", "duplicate", "locked"] as const;

type Phase = typeof PHASES[number];
type Outcome = typeof OUTCOMES[number];

interface ValidationDependencies {
  readonly readRawEvidence: (path: string) => Promise<string>;
}

interface LedgerEntry {
  readonly scheduledTime: number;
  readonly attempt: number;
  readonly phase: Phase | null;
  readonly outcome: Outcome;
  readonly upstreamRequests: number;
  readonly d1Queries: number;
  readonly rowsReadObservedBeforeLedger: number;
  readonly rowsWrittenObservedBeforeLedger: number;
}

export interface Wp224hValidationSummary {
  readonly passed: true;
  readonly ticks: number;
  readonly phaseCompletions: Readonly<Record<Phase, number>>;
  readonly retries: number;
  readonly attempts: number;
  readonly maxD1QueriesPerAttempt: number;
}

export class Wp224hArtifactValidationError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "Wp224hArtifactValidationError";
  }
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
  nonEmptyString(worker.name, "STRUCTURE", "worker.name");
  const queue = record(artifact.queue, "STRUCTURE", "queue");
  stringPattern(queue.id, /^[a-f0-9]{32}$/, "STRUCTURE", "queue.id");
  const d1 = record(artifact.d1, "STRUCTURE", "d1");
  stringPattern(
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
  const totals = validateTotals(artifact.totals, limits, ledger);
  await validateRawAnalytics(artifact.rawAnalytics, dependencies);
  validateAttribution(artifact.accountUsage, totals);
  validateCleanup(artifact.cleanup);

  return {
    passed: true,
    ticks: ledger.ticks,
    phaseCompletions: ledger.phaseCompletions,
    retries: ledger.retries,
    attempts: ledger.entries.length,
    maxD1QueriesPerAttempt: ledger.maxD1Queries,
  };
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
} {
  if (!Array.isArray(value)) fail("TICK_COUNT", "ledger must be an array");
  const entries = value.map((entry, index) => ledgerEntry(entry, index));
  const byTick = new Map<number, LedgerEntry[]>();
  let maxD1Queries = 0;

  for (const entry of entries) {
    if (entry.scheduledTime < start || entry.scheduledTime >= end
      || (entry.scheduledTime - start) % TICK_MS !== 0) {
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
  for (let index = 0; index < EXPECTED_TICKS; index += 1) {
    const scheduledTime = start + index * TICK_MS;
    const attempts = byTick.get(scheduledTime);
    if (attempts === undefined) fail("TICK_COUNT", `missing tick ${scheduledTime}`);
    attempts.sort((left, right) => left.attempt - right.attempt);
    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      if (attempts[attemptIndex]!.attempt !== attemptIndex + 1) {
        fail("RETRY_SEQUENCE", `tick ${scheduledTime} has a non-contiguous retry sequence`);
      }
    }
    const completed = attempts.filter(({ outcome }) => outcome === "completed");
    if (completed.length !== 1
      || (attempts.at(-1)?.outcome !== "completed" && attempts.at(-1)?.outcome !== "duplicate")) {
      fail("RETRY_OUTCOME", `tick ${scheduledTime} must contain one completion and finish terminally`);
    }
    const completedIndex = attempts.indexOf(completed[0]!);
    if (attempts.slice(0, completedIndex).some(({ outcome }) => outcome !== "failed" && outcome !== "locked")
      || attempts.slice(completedIndex + 1).some(({ outcome }) => outcome !== "duplicate")) {
      fail("RETRY_OUTCOME", `tick ${scheduledTime} has an invalid retry or duplicate sequence`);
    }
    const completedPhase = completed[0]!.phase;
    if (completedPhase === null) fail("PHASE_COUNT", `completed tick ${scheduledTime} has no phase`);
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
  return {
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
  };
}

function validateTotals(
  value: unknown,
  limits: ReturnType<typeof validateLimits>,
  ledger: ReturnType<typeof validateLedger>,
): { readonly d1RowsRead: number; readonly d1RowsWritten: number } {
  const totals = record(value, "TOTALS", "totals");
  integerEqual(totals.ticks, ledger.ticks, "TOTALS", "totals.ticks");
  integerEqual(totals.headerCompleted, ledger.phaseCompletions.header, "PHASE_COUNT", "totals.headerCompleted");
  integerEqual(totals.sweepCompleted, ledger.phaseCompletions.sweep, "PHASE_COUNT", "totals.sweepCompleted");
  integerEqual(totals.probeCompleted, ledger.phaseCompletions.probe, "PHASE_COUNT", "totals.probeCompleted");
  integerEqual(totals.retries, ledger.retries, "RETRY_COUNT", "totals.retries");
  integerEqual(
    totals.maxD1QueriesPerAttempt,
    ledger.maxD1Queries,
    "D1_QUERY_LIMIT",
    "totals.maxD1QueriesPerAttempt",
  );

  const d1RowsRead = nonNegativeInteger(totals.d1RowsRead, "D1_READ_LIMIT", "totals.d1RowsRead");
  if (d1RowsRead >= limits.d1RowsRead) fail("D1_READ_LIMIT", "D1 rows read did not retain the Free reserve");
  const d1RowsWritten = nonNegativeInteger(totals.d1RowsWritten, "D1_WRITE_LIMIT", "totals.d1RowsWritten");
  if (d1RowsWritten >= limits.d1RowsWritten) fail("D1_WRITE_LIMIT", "D1 rows written did not retain the Free reserve");

  zero(totals.quotaErrors, "QUOTA_ERRORS", "totals.quotaErrors");
  zero(totals.http429, "HTTP_429", "totals.http429");
  zero(totals.exceededCpu, "CPU_LIMIT", "totals.exceededCpu");
  zero(totals.memoryExceeded, "MEMORY_LIMIT", "totals.memoryExceeded");
  const maxConsumerCpuMs = nonNegativeNumber(totals.maxConsumerCpuMs, "CPU_LIMIT", "totals.maxConsumerCpuMs");
  if (maxConsumerCpuMs >= limits.consumerCpuMs) fail("CPU_LIMIT", "consumer CPU reached its limit");
  const memoryUsageBytesP999 = nonNegativeNumber(
    totals.memoryUsageBytesP999,
    "MEMORY_LIMIT",
    "totals.memoryUsageBytesP999",
  );
  if (memoryUsageBytesP999 >= limits.memoryBytesP999) fail("MEMORY_LIMIT", "memory P999 reached its limit");
  return { d1RowsRead, d1RowsWritten };
}

async function validateRawAnalytics(value: unknown, dependencies: ValidationDependencies): Promise<void> {
  if (typeof dependencies?.readRawEvidence !== "function") {
    fail("RAW_ANALYTICS", "readRawEvidence dependency is required");
  }
  const analytics = record(value, "RAW_ANALYTICS", "rawAnalytics");
  for (const requiredPath of REQUIRED_RAW_ANALYTICS) {
    if (!(requiredPath in analytics)) fail("RAW_ANALYTICS", `missing ${requiredPath}`);
  }

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
  }
}

function validateAttribution(
  value: unknown,
  totals: { readonly d1RowsRead: number; readonly d1RowsWritten: number },
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
  if (unrelatedRowsRead > totals.d1RowsRead || unrelatedRowsWritten > totals.d1RowsWritten) {
    fail("ATTRIBUTION", "unrelated usage cannot exceed account totals");
  }
}

function validateCleanup(value: unknown): void {
  const cleanup = record(value, "CLEANUP", "cleanup");
  if (!emptyArray(cleanup.preflightSchedules)
    || cleanup.preflightBacklogCount !== 0
    || !Array.isArray(cleanup.installedSchedules)
    || cleanup.installedSchedules.length !== 1
    || cleanup.installedSchedules[0] !== "*/5 * * * *"
    || !emptyArray(cleanup.finalSchedules)
    || cleanup.finalBacklogCount !== 0
    || cleanup.killSwitch !== true
    || cleanup.stagingManualRun !== false
    || cleanup.sharedSecretPresent !== false) {
    fail("CLEANUP", "preflight, active schedule or final safe state is incomplete");
  }
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

function zero(value: unknown, code: string, label: string): void {
  integerEqual(value, 0, code, label);
}

function emptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

function fail(code: string, detail: string): never {
  throw new Wp224hArtifactValidationError(code, detail);
}
