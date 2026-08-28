import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";

describe("WP2 retry-aware daily write budget", () => {
  it("includes the daily telemetry write in every nominal and retried attempt", () => {
    const budget = loadConfig({}).projectedDailyBudget;

    expect(budget).toMatchObject({
      invocations: 288,
      maxAttempts: 1_152,
      d1RowsWrittenNominal: 17_568,
      d1RowsWritten: 70_272,
    });
  });

  it("rejects a phase allowance of 69 writes because telemetry makes the retry worst case exceed 80,000", () => {
    expect(() => loadConfig({ D1_ROWS_WRITTEN_PER_RUN: "69" })).toThrow(
      /^D1_ROWS_WRITTEN_PER_RUN:/,
    );
  });
});
