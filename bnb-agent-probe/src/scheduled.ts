import type { WorkerConfig } from "./config";
import { writeRuntimeState, type D1DatabaseLike } from "./db/client";
import { createBudgetedD1Database } from "./db/query-budget";
import {
  acquireSchedulerLease,
  releaseSchedulerLease,
} from "./lib/scheduler-lease";
import type { Env, ExecutionContext, ScheduledController } from "./types";

const FREE_LEASE_MS = 4 * 60_000;
const PAID_LEASE_MS = 14 * 60_000;

export interface ScheduledRuntimeDependencies {
  now?: () => number;
  randomUUID?: () => string;
}

export function createWp1ScheduledRunner(dependencies: ScheduledRuntimeDependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const randomUUID = dependencies.randomUUID ?? crypto.randomUUID.bind(crypto);

  return async function runWp1Scheduled(
    _controller: ScheduledController,
    env: Env,
    _context: ExecutionContext,
    config: WorkerConfig,
  ): Promise<void> {
    const startedAt = now();
    const runId = randomUUID();
    const leaseMs = config.plan === "free" ? FREE_LEASE_MS : PAID_LEASE_MS;
    const rawDb = env.DB as unknown as D1DatabaseLike;
    // The phase budget excludes one cleanup query so an acquired lease can be
    // released before the invocation reaches the platform hard limit.
    const { db } = createBudgetedD1Database(rawDb, config.d1QueriesPerRun - 1);
    const acquired = await acquireSchedulerLease(db, {
      runId,
      nowMs: startedAt,
      expiresAtMs: startedAt + leaseMs,
    });

    if (!acquired) {
      const finishedAt = now();
      await writeRuntimeState(db, {
        key: "last_scheduler_summary",
        textValue: JSON.stringify({
          status: "skipped_locked",
          requests: 0,
          wallTimeMs: Math.max(0, finishedAt - startedAt),
        }),
        integerValue: null,
        updatedAt: finishedAt,
      });
      return;
    }

    try {
      // WP1 deliberately runs no HEADER, SWEEP or PROBE phase.
    } finally {
      await releaseSchedulerLease(rawDb, runId, now());
    }
  };
}

export const runWp1Scheduled = createWp1ScheduledRunner();
