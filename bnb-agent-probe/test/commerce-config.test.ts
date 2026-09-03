import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config";

describe("Commerce indexer configuration", () => {
  it("only enables the indexer explicitly and sizes it per plan", () => {
    expect(loadConfig({ COMMERCE_INDEX_ENABLED: "1" })).toMatchObject({ commerceIndexEnabled: true });
    expect(loadConfig({ CLOUDFLARE_WORKERS_PLAN: "paid" })).toMatchObject({
      commerceIndexEnabled: false,
      commerceIndexBlocksPerRun: 2_000,
      commerceIndexFinalityBlocks: 15,
      commerceIndexJobsPerRun: 100,
      commerceIndexLogsPerRun: 60,
      commerceIndexBlockLookupsPerRun: 20,
    });
    expect(() => loadConfig({ COMMERCE_INDEX_ENABLED: "yes" })).toThrow(ConfigError);
  });

  it("counts the extra cron messages in the Free queue projection", () => {
    expect(loadConfig({ COMMERCE_INDEX_ENABLED: "1" }).projectedDailyBudget).toMatchObject({
      scheduledQueueOperations: 5_184,
      queueOperations: 5_784,
    });
  });

  it.each([
    ["COMMERCE_INDEX_BLOCKS_PER_RUN", "0"],
    ["COMMERCE_INDEX_BLOCKS_PER_RUN", "50001"],
    ["COMMERCE_INDEX_FINALITY_BLOCKS", "201"],
    ["COMMERCE_INDEX_JOBS_PER_RUN", "60"],
    ["COMMERCE_INDEX_LOGS_PER_RUN", "30"],
    ["COMMERCE_INDEX_BLOCK_LOOKUPS_PER_RUN", "x"],
  ])("rejects %s=%s on an enabled Free indexer", (field, value) => {
    expect(() => loadConfig({ COMMERCE_INDEX_ENABLED: "1", [field]: value })).toThrow(ConfigError);
  });

  it("holds only an enabled indexer to the Paid D1 envelope", () => {
    const paid = { CLOUDFLARE_WORKERS_PLAN: "paid", COMMERCE_INDEX_ENABLED: "1" };
    expect(loadConfig({ ...paid, COMMERCE_INDEX_LOGS_PER_RUN: "99" })).toMatchObject({ commerceIndexLogsPerRun: 99 });
    expect(() => loadConfig({ ...paid, COMMERCE_INDEX_LOGS_PER_RUN: "100" })).toThrow(/D1_ROWS_WRITTEN_PER_RUN/);
    expect(() => loadConfig({ ...paid, COMMERCE_INDEX_JOBS_PER_RUN: "200" })).toThrow(/D1_ROWS_WRITTEN_PER_RUN/);
    expect(loadConfig({ CLOUDFLARE_WORKERS_PLAN: "paid", D1_ROWS_WRITTEN_PER_RUN: "40" })).toMatchObject({ commerceIndexEnabled: false });
  });
});
