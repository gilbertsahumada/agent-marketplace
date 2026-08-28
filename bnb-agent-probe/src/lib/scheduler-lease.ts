import type { D1DatabaseLike } from "../db/client";

// Deliberately raw SQL, exempt from the Drizzle runtime layer in db/orm.ts:
// the lease's INSERT ... ON CONFLICT ... WHERE ... RETURNING is the one query
// whose exact contention semantics must be auditable at a glance.
const SCHEDULER_LEASE_KEY = "scheduler_lease";

export interface SchedulerLeaseRequest {
  readonly runId: string;
  readonly nowMs: number;
  readonly expiresAtMs: number;
}

export async function acquireSchedulerLease(
  db: D1DatabaseLike,
  request: SchedulerLeaseRequest,
): Promise<boolean> {
  validateLeaseRequest(request);

  const result = await db
    .prepare(
      `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
       VALUES ('scheduler_lease', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         textValue = excluded.textValue,
         integerValue = excluded.integerValue,
         updatedAt = excluded.updatedAt
       WHERE runtime_state.integerValue <= ?
       RETURNING key`,
    )
    .bind(request.runId, request.expiresAtMs, request.nowMs, request.nowMs)
    .all<{ key: string }>();

  if (!result.success) throw new Error("Could not acquire scheduler lease");
  return result.results?.[0]?.key === SCHEDULER_LEASE_KEY;
}

export async function releaseSchedulerLease(
  db: D1DatabaseLike,
  runId: string,
  nowMs: number,
): Promise<boolean> {
  assertRunId(runId);
  assertEpochMilliseconds(nowMs, "nowMs");

  const result = await db
    .prepare(
      `UPDATE runtime_state
       SET textValue = NULL, integerValue = ?, updatedAt = ?
       WHERE key = 'scheduler_lease' AND textValue = ?
       RETURNING key`,
    )
    .bind(nowMs, nowMs, runId)
    .all<{ key: string }>();

  if (!result.success) throw new Error("Could not release scheduler lease");
  return result.results?.[0]?.key === SCHEDULER_LEASE_KEY;
}

function validateLeaseRequest(request: SchedulerLeaseRequest): void {
  assertRunId(request.runId);
  assertEpochMilliseconds(request.nowMs, "nowMs");
  assertEpochMilliseconds(request.expiresAtMs, "expiresAtMs");
  if (request.expiresAtMs <= request.nowMs) {
    throw new Error("expiresAtMs must be later than nowMs");
  }
}

function assertRunId(runId: string): void {
  if (runId.trim().length === 0) throw new Error("runId must not be empty");
}

function assertEpochMilliseconds(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}
