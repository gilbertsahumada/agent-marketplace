import type { D1DatabaseLike } from "./client";

export type SchedulerAttemptOutcome = "completed" | "failed" | "duplicate" | "locked";
export type SchedulerAttemptPhase = "header" | "sweep" | "probe" | null;

export interface SchedulerAttemptInput {
  readonly scheduledTime: number;
  readonly phase: SchedulerAttemptPhase;
  readonly outcome: SchedulerAttemptOutcome;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly upstreamRequests: number;
  readonly d1Queries: number;
  readonly rowsReadObservedBeforeLedger: number;
  readonly rowsWrittenObservedBeforeLedger: number;
  readonly errorCode: string | null;
}

export interface SchedulerAttempt extends SchedulerAttemptInput {
  readonly attempt: number;
}

interface SchedulerAttemptRow {
  readonly scheduledTime: number;
  readonly attempt: number;
  readonly phase: string | null;
  readonly outcome: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly upstreamRequests: number;
  readonly d1Queries: number;
  readonly rowsReadObservedBeforeLedger: number;
  readonly rowsWrittenObservedBeforeLedger: number;
  readonly errorCode: string | null;
}

export async function recordSchedulerAttempt(
  db: D1DatabaseLike,
  input: SchedulerAttemptInput,
): Promise<void> {
  validateAttemptInput(input);
  const result = await db.prepare(
    `INSERT INTO scheduler_attempts (
       scheduledTime, attempt, phase, outcome, startedAt, finishedAt,
       upstreamRequests, d1Queries, rowsReadObservedBeforeLedger,
       rowsWrittenObservedBeforeLedger, errorCode
     )
     SELECT ?, COALESCE(MAX(attempt), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?
     FROM scheduler_attempts
     WHERE scheduledTime = ?`,
  ).bind(
    input.scheduledTime,
    input.phase,
    input.outcome,
    input.startedAt,
    input.finishedAt,
    input.upstreamRequests,
    input.d1Queries,
    input.rowsReadObservedBeforeLedger,
    input.rowsWrittenObservedBeforeLedger,
    input.errorCode,
    input.scheduledTime,
  ).run();
  if (!result.success) throw new Error("Could not persist scheduler attempt");
}

export async function listSchedulerAttempts(
  db: D1DatabaseLike,
  startInclusive: number,
  endExclusive: number,
): Promise<readonly SchedulerAttempt[]> {
  nonNegativeSafeInteger(startInclusive, "startInclusive");
  nonNegativeSafeInteger(endExclusive, "endExclusive");
  if (endExclusive <= startInclusive) throw new Error("endExclusive must follow startInclusive");
  const result = await db.prepare(
    `SELECT scheduledTime, attempt, phase, outcome, startedAt, finishedAt,
            upstreamRequests, d1Queries, rowsReadObservedBeforeLedger,
            rowsWrittenObservedBeforeLedger, errorCode
     FROM scheduler_attempts
     WHERE scheduledTime >= ? AND scheduledTime < ?
     ORDER BY scheduledTime ASC, attempt ASC`,
  ).bind(startInclusive, endExclusive).all<SchedulerAttemptRow>();
  if (!result.success) throw new Error("Could not read scheduler attempts");
  return (result.results ?? []).map(toSchedulerAttempt);
}

function toSchedulerAttempt(row: SchedulerAttemptRow): SchedulerAttempt {
  if (!isPhase(row.phase) || !isOutcome(row.outcome)) {
    throw new Error("Scheduler attempt ledger contains an invalid enum");
  }
  const attempt: SchedulerAttempt = {
    scheduledTime: row.scheduledTime,
    attempt: row.attempt,
    phase: row.phase,
    outcome: row.outcome,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    upstreamRequests: row.upstreamRequests,
    d1Queries: row.d1Queries,
    rowsReadObservedBeforeLedger: row.rowsReadObservedBeforeLedger,
    rowsWrittenObservedBeforeLedger: row.rowsWrittenObservedBeforeLedger,
    errorCode: row.errorCode,
  };
  validateAttemptInput(attempt);
  if (!Number.isSafeInteger(attempt.attempt) || attempt.attempt < 1 || attempt.attempt > 4) {
    throw new Error("Scheduler attempt ledger contains an invalid attempt number");
  }
  return attempt;
}

function validateAttemptInput(input: SchedulerAttemptInput): void {
  nonNegativeSafeInteger(input.scheduledTime, "scheduledTime");
  nonNegativeSafeInteger(input.startedAt, "startedAt");
  nonNegativeSafeInteger(input.finishedAt, "finishedAt");
  if (input.finishedAt < input.startedAt) throw new Error("finishedAt must not precede startedAt");
  nonNegativeSafeInteger(input.upstreamRequests, "upstreamRequests");
  if (!Number.isSafeInteger(input.d1Queries) || input.d1Queries < 1 || input.d1Queries > 40) {
    throw new Error("d1Queries must be between 1 and 40");
  }
  nonNegativeSafeInteger(input.rowsReadObservedBeforeLedger, "rowsReadObservedBeforeLedger");
  nonNegativeSafeInteger(input.rowsWrittenObservedBeforeLedger, "rowsWrittenObservedBeforeLedger");
  if (!isPhase(input.phase) || !isOutcome(input.outcome)) throw new Error("Invalid scheduler attempt enum");
}

function nonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function isPhase(value: unknown): value is SchedulerAttemptPhase {
  return value === null || value === "header" || value === "sweep" || value === "probe";
}

function isOutcome(value: unknown): value is SchedulerAttemptOutcome {
  return value === "completed" || value === "failed" || value === "duplicate" || value === "locked";
}
