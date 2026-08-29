import { sql, type SQL } from "drizzle-orm";

import type { D1DatabaseLike } from "./client";
import { createDatabase } from "./orm";
import { runtimeState } from "./schema";

export type DailyBudgetOutcome = "completed" | "failed" | "duplicate" | "locked";

export interface DailyBudgetObservation {
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly outcome: DailyBudgetOutcome;
  readonly upstreamRequests: number;
  readonly d1Queries: number;
  readonly rowsReadObservedBeforeLedger: number;
  readonly rowsWrittenObservedBeforeLedger: number;
}

const MEASUREMENT_SCOPE = "worker_metered_before_daily_ledger";

export async function recordDailyBudget(
  db: D1DatabaseLike,
  observation: DailyBudgetObservation,
): Promise<void> {
  validateObservation(observation);
  const utcDate = new Date(observation.startedAtMs).toISOString().slice(0, 10);
  const key = `daily_budget_${utcDate.replaceAll("-", "")}`;
  const increments = outcomeIncrements(observation.outcome);
  const initial = {
    schemaVersion: 1,
    utcDate,
    measurementScope: MEASUREMENT_SCOPE,
    updatedAt: observation.finishedAtMs,
    invocations: 1,
    ...increments,
    upstreamRequests: observation.upstreamRequests,
    d1Queries: observation.d1Queries,
    rowsReadObservedBeforeLedger: observation.rowsReadObservedBeforeLedger,
    rowsWrittenObservedBeforeLedger: observation.rowsWrittenObservedBeforeLedger,
  };

  const currentInteger = (field: string): SQL =>
    sql`CASE WHEN json_valid(${runtimeState.textValue})
      THEN COALESCE(CAST(json_extract(${runtimeState.textValue}, ${`$.${field}`}) AS INTEGER), 0)
      ELSE 0 END`;
  await createDatabase(db)
    .insert(runtimeState)
    .values({
      key,
      textValue: JSON.stringify(initial),
      integerValue: null,
      updatedAt: observation.finishedAtMs,
    })
    .onConflictDoUpdate({
      target: runtimeState.key,
      set: {
        textValue: sql`json_object(
          'schemaVersion', 1,
          'utcDate', ${utcDate},
          'measurementScope', ${MEASUREMENT_SCOPE},
          'updatedAt', MAX(${currentInteger("updatedAt")}, ${observation.finishedAtMs}),
          'invocations', ${currentInteger("invocations")} + 1,
          'completed', ${currentInteger("completed")} + ${increments.completed},
          'failed', ${currentInteger("failed")} + ${increments.failed},
          'duplicate', ${currentInteger("duplicate")} + ${increments.duplicate},
          'locked', ${currentInteger("locked")} + ${increments.locked},
          'upstreamRequests', ${currentInteger("upstreamRequests")} + ${observation.upstreamRequests},
          'd1Queries', ${currentInteger("d1Queries")} + ${observation.d1Queries},
          'rowsReadObservedBeforeLedger', ${currentInteger("rowsReadObservedBeforeLedger")} + ${observation.rowsReadObservedBeforeLedger},
          'rowsWrittenObservedBeforeLedger', ${currentInteger("rowsWrittenObservedBeforeLedger")} + ${observation.rowsWrittenObservedBeforeLedger}
        )`,
        integerValue: null,
        updatedAt: sql`MAX(${runtimeState.updatedAt}, excluded.updatedAt)`,
      },
    });
}

function outcomeIncrements(outcome: DailyBudgetOutcome): Record<DailyBudgetOutcome, number> {
  return {
    completed: outcome === "completed" ? 1 : 0,
    failed: outcome === "failed" ? 1 : 0,
    duplicate: outcome === "duplicate" ? 1 : 0,
    locked: outcome === "locked" ? 1 : 0,
  };
}

function validateObservation(observation: DailyBudgetObservation): void {
  nonNegativeInteger(observation.startedAtMs, "startedAtMs");
  nonNegativeInteger(observation.finishedAtMs, "finishedAtMs");
  if (observation.finishedAtMs < observation.startedAtMs) {
    throw new Error("finishedAtMs must not precede startedAtMs");
  }
  nonNegativeInteger(observation.upstreamRequests, "upstreamRequests");
  nonNegativeInteger(observation.d1Queries, "d1Queries");
  nonNegativeInteger(observation.rowsReadObservedBeforeLedger, "rowsReadObservedBeforeLedger");
  nonNegativeInteger(observation.rowsWrittenObservedBeforeLedger, "rowsWrittenObservedBeforeLedger");
}

function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}
