import type { WorkerConfig } from "../config";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase, readCatalogOperations } from "../db/orm";
import type { D1Database } from "../types";

export async function catalogOperationsResponse(
  db: D1Database,
  config: WorkerConfig,
  nowMs: number,
): Promise<Response> {
  const dayStart = nowMs - 24 * 60 * 60 * 1_000;
  const rows = await readCatalogOperations(createDatabase(db as unknown as D1DatabaseLike), nowMs);
  const oldestDueAt = rows.endpoints.oldestDueAt;

  return Response.json({
    schemaVersion: 2,
    generatedAt: nowMs,
    window: { from: dayStart, to: nowMs },
    budgetProfile: {
      plan: config.plan,
      cronIntervalMinutes: config.cronIntervalMinutes,
      d1QueriesPerInvocation: config.d1QueriesPerRun,
      externalSubrequestsPerInvocation: config.externalSubrequestsPerRun,
      batchSize: config.catalogProbeBatchSize,
      concurrency: config.catalogProbeConcurrency,
      validationRequestsPerDay: config.catalogValidationRequestsPerDay,
      projectedQueueOperationsPerDay: config.projectedDailyBudget?.queueOperations ?? null,
      ingest: {
        discoveryPageSize: config.catalogDiscoveryPageSize,
        tasksPerRun: config.catalogIngestTasksPerRun,
        declarationsPerTask: config.catalogDeclarationsPerTask,
      },
      protocolTimeoutMs: {
        a2a: config.catalogA2aTimeoutMs,
        mcp: config.catalogMcpTimeoutMs,
        erc8183Http: config.catalogErc8183TimeoutMs,
      },
      refreshMinutes: {
        priority: config.catalogPriorityRefreshMinutes,
        a2a: config.catalogA2aRefreshMinutes,
        mcp: config.catalogMcpRefreshMinutes,
        erc8183Http: config.catalogErc8183RefreshMinutes,
      },
      failureBackoffMinutes: config.catalogFailureBackoffMinutes,
      v2: {
        readsEnabled: config.catalogV2ReadsEnabled,
        writesEnabled: config.catalogV2WritesEnabled,
      },
    },
    work: {
      validationRequests: rows.validationRequests,
      dueEndpoints: rows.endpoints.due,
      leasedEndpoints: rows.endpoints.leased,
      failedEndpoints: rows.endpoints.failed,
      oldestDueAt,
      oldestDueAgeMs: oldestDueAt === null ? null : Math.max(0, nowMs - oldestDueAt),
      ingestTasks: rows.ingestTasks,
    },
    discovery: {
      maximumVisibilityLagMs: rows.maximumVisibilityLagMs,
      basis: "trust8004_metadata_timestamp_to_d1_discovery_start",
    },
    platformObservationsByProtocolAndOutcome: rows.observations,
    scheduler24h: {
      ...rows.scheduler,
      retryRate: rows.scheduler.attempts === 0 ? 0 : rows.scheduler.retries / rows.scheduler.attempts,
      estimatedQueueOperations: rows.scheduler.queueMessages * 3 + rows.scheduler.retries,
      queueOperationsBasis: "send_receive_delete_plus_retries",
    },
    excludedDeclarations: {
      ...rows.declarations,
    },
  }, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
