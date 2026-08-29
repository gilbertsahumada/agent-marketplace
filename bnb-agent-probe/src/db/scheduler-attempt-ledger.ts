import { and, asc, gte, lt } from "drizzle-orm";

import type { D1DatabaseLike } from "./client";
import { createDatabase, type SchedulerAttemptRow } from "./orm";
import { schedulerAttempts } from "./schema";

export type SchedulerAttemptOutcome = "completed" | "failed" | "duplicate" | "locked";
export type SchedulerAttemptPhase = "header" | "sweep" | "probe" | null;

export interface SchedulerAttemptInput {
  readonly messageId: string;
  readonly scheduledTime: number;
  readonly attempt: number;
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
}

export async function recordSchedulerAttempt(
  db: D1DatabaseLike,
  input: SchedulerAttemptInput,
): Promise<void> {
  validateAttemptInput(input);
  await createDatabase(db).insert(schedulerAttempts).values({
    messageId: input.messageId,
    scheduledTime: input.scheduledTime,
    attempt: input.attempt,
    phase: input.phase,
    outcome: input.outcome,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    upstreamRequests: input.upstreamRequests,
    d1Queries: input.d1Queries,
    rowsReadObservedBeforeLedger: input.rowsReadObservedBeforeLedger,
    rowsWrittenObservedBeforeLedger: input.rowsWrittenObservedBeforeLedger,
    errorCode: input.errorCode,
  });
}

export async function listSchedulerAttempts(
  db: D1DatabaseLike,
  startInclusive: number,
  endExclusive: number,
): Promise<readonly SchedulerAttempt[]> {
  nonNegativeSafeInteger(startInclusive, "startInclusive");
  nonNegativeSafeInteger(endExclusive, "endExclusive");
  if (endExclusive <= startInclusive) throw new Error("endExclusive must follow startInclusive");
  const rows = await createDatabase(db)
    .select()
    .from(schedulerAttempts)
    .where(and(
      gte(schedulerAttempts.scheduledTime, startInclusive),
      lt(schedulerAttempts.scheduledTime, endExclusive),
    ))
    .orderBy(asc(schedulerAttempts.scheduledTime), asc(schedulerAttempts.attempt));
  return rows.map(toSchedulerAttempt);
}

function toSchedulerAttempt(row: SchedulerAttemptRow): SchedulerAttempt {
  if (!isPhase(row.phase) || !isOutcome(row.outcome)) {
    throw new Error("Scheduler attempt ledger contains an invalid enum");
  }
  const attempt: SchedulerAttempt = {
    messageId: row.messageId,
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
  return attempt;
}

function validateAttemptInput(input: SchedulerAttemptInput): void {
  if (input.messageId.length < 1 || input.messageId.length > 256) {
    throw new Error("messageId must contain between 1 and 256 characters");
  }
  nonNegativeSafeInteger(input.scheduledTime, "scheduledTime");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 4) {
    throw new Error("attempt must be between 1 and 4");
  }
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
