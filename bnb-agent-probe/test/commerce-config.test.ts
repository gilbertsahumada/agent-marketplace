import { describe, expect, it } from "vitest";

import {
  COMMERCE_EVENT_ROW_WRITES,
  COMMERCE_EVENT_STATEMENT_WRITES,
  COMMERCE_JOB_ROW_WRITES,
  COMMERCE_RUNTIME_STATE_ROW_WRITES,
  ConfigError,
  commerceIndexJobsRowWrites,
  commerceIndexRangeRowWrites,
  loadConfig,
} from "../src/config";

function configError(load: () => unknown): ConfigError {
  try {
    load();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("Commerce indexer configuration", () => {
  // A Free indexer needs the ten-minute cadence: see the daily projection below.
  const free = { COMMERCE_INDEX_ENABLED: "1", CRON_INTERVAL_MINUTES: "10" };

  it("only enables the indexer explicitly and sizes it per plan", () => {
    expect(loadConfig(free)).toMatchObject({
      commerceIndexEnabled: true, commerceIndexLogsPerRun: 6, commerceIndexJobsPerRun: 11,
    });
    expect(loadConfig({ CLOUDFLARE_WORKERS_PLAN: "paid" })).toMatchObject({
      commerceIndexEnabled: false,
      commerceIndexBlocksPerRun: 2_000,
      commerceIndexFinalityBlocks: 15,
      commerceIndexJobsPerRun: 39,
      commerceIndexLogsPerRun: 23,
      commerceIndexBlockLookupsPerRun: 20,
    });
    expect(configError(() => loadConfig({ COMMERCE_INDEX_ENABLED: "yes" })).field).toBe("COMMERCE_INDEX_ENABLED");
  });

  it("models D1 rows_written per index entry: events, their sequence row, jobs and runtime_state", () => {
    expect([COMMERCE_EVENT_ROW_WRITES, COMMERCE_EVENT_STATEMENT_WRITES, COMMERCE_JOB_ROW_WRITES, COMMERCE_RUNTIME_STATE_ROW_WRITES]).toEqual([3, 1, 5, 2]);
    // 24 logs on 24 jobs in four six-row statements: 72 + 4 + 120 + three runtime_state rows.
    expect(commerceIndexRangeRowWrites(24, 24, 3)).toBe(202);
    expect(commerceIndexRangeRowWrites(0, 0, 1)).toBe(2);
    expect(commerceIndexJobsRowWrites(39)).toBe(197);
  });

  it.each([
    ["COMMERCE_INDEX_BLOCKS_PER_RUN", "0"],
    ["COMMERCE_INDEX_BLOCKS_PER_RUN", "50001"],
    ["COMMERCE_INDEX_FINALITY_BLOCKS", "201"],
    ["COMMERCE_INDEX_JOBS_PER_RUN", "12"],
    ["COMMERCE_INDEX_LOGS_PER_RUN", "7"],
    ["COMMERCE_INDEX_BLOCK_LOOKUPS_PER_RUN", "x"],
  ])("rejects %s=%s on an enabled Free indexer naming the field", (field, value) => {
    expect(configError(() => loadConfig({ ...free, [field]: value })).field).toBe(field);
  });

  it("projects the indexer's own per-message D1 envelope for every cron tick on Free and holds it to the ceiling", () => {
    // Per index message: the 55-row batch is reserved before it commits, so a
    // retried attempt writes only the failure summary and window hint (2 rows
    // each, possibly fresh); three retries → 55 + 12. Reads: cursor/window plus
    // one lookup per written row. 144 ticks × 2 chains at ten minutes.
    expect(loadConfig(free).projectedDailyBudget).toMatchObject({
      invocations: 144,
      commerceIndexMessagesPerDay: 288,
      commerceIndexD1RowsWrittenPerMessage: 67,
      commerceIndexD1RowsWritten: 19_296,
      commerceIndexD1RowsRead: 288 * 4 * 57,
      d1RowsWrittenNominal: 144 * 62 + 288 * 55,
      d1RowsWritten: 144 * 4 * 62 + 19_296,
      d1RowsRead: 144 * 4 * 3_000 + 288 * 4 * 57,
      scheduledQueueOperations: 2_592,
      queueOperations: 3_192,
    });
    // At five minutes the phase envelope alone uses 71,424 of the 80,000-row
    // ceiling, so no indexer size fits: the error names the switch that broke it.
    const tooFast = configError(() => loadConfig({ COMMERCE_INDEX_ENABLED: "1" }));
    expect(tooFast.field).toBe("COMMERCE_INDEX_ENABLED");
    expect(tooFast.message).toMatch(/CRON_INTERVAL_MINUTES/);
    expect(loadConfig({ COMMERCE_INDEX_ENABLED: "1", CLOUDFLARE_WORKERS_PLAN: "paid" }).projectedDailyBudget).toBeNull();
  });

  it("holds only an enabled indexer to the D1 write envelope, counting index writes", () => {
    const paid = { CLOUDFLARE_WORKERS_PLAN: "paid", COMMERCE_INDEX_ENABLED: "1" };
    expect(loadConfig({ ...paid, COMMERCE_INDEX_LOGS_PER_RUN: "23" })).toMatchObject({ commerceIndexLogsPerRun: 23 });
    const logs = configError(() => loadConfig({ ...paid, COMMERCE_INDEX_LOGS_PER_RUN: "24" }));
    expect(logs.field).toBe("COMMERCE_INDEX_LOGS_PER_RUN");
    expect(logs.message).toMatch(/202 D1 rows.*index writes count.*D1_ROWS_WRITTEN_PER_RUN/);
    expect(loadConfig({ ...paid, COMMERCE_INDEX_JOBS_PER_RUN: "39" })).toMatchObject({ commerceIndexJobsPerRun: 39 });
    const jobs = configError(() => loadConfig({ ...paid, COMMERCE_INDEX_JOBS_PER_RUN: "40" }));
    expect(jobs.field).toBe("COMMERCE_INDEX_JOBS_PER_RUN");
    expect(jobs.message).toMatch(/index writes count/);
    expect(loadConfig({ CLOUDFLARE_WORKERS_PLAN: "paid", D1_ROWS_WRITTEN_PER_RUN: "40" })).toMatchObject({ commerceIndexEnabled: false });
    expect(loadConfig({ COMMERCE_INDEX_LOGS_PER_RUN: "120" })).toMatchObject({ commerceIndexEnabled: false, commerceIndexLogsPerRun: 120 });
  });

  it("holds an enabled indexer to the per-run D1 query budget", () => {
    const paid = {
      CLOUDFLARE_WORKERS_PLAN: "paid", COMMERCE_INDEX_ENABLED: "1", D1_ROWS_WRITTEN_PER_RUN: "2000",
      D1_QUERIES_PER_RUN: "38", CATALOG_DISCOVERY_PAGE_SIZE: "2",
    };
    // 96 logs: 16 event + 16 job statements + 4 fixed = 36 = the 38 - 2 phase limit.
    expect(loadConfig({ ...paid, COMMERCE_INDEX_LOGS_PER_RUN: "96" })).toMatchObject({ commerceIndexLogsPerRun: 96 });
    const logs = configError(() => loadConfig({ ...paid, COMMERCE_INDEX_LOGS_PER_RUN: "97" }));
    expect(logs.field).toBe("COMMERCE_INDEX_LOGS_PER_RUN");
    expect(logs.message).toMatch(/38 D1 queries/);
    // The jobs maximum (200 → 34 + 2 statements) fits the smallest query budget.
    expect(loadConfig({ ...paid, COMMERCE_INDEX_JOBS_PER_RUN: "200" })).toMatchObject({ commerceIndexJobsPerRun: 200 });
  });
});
