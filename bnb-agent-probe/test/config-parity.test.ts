import { describe, expect, it } from "vitest";
import { loadObservationWorkerConfig } from "../../src/observation/worker-config.ts";
import { loadConfig } from "../src/config";

describe("observation configuration parity", () => {
  it.each([
    {},
    { CLOUDFLARE_WORKERS_PLAN: "paid" },
    {
      CRON_INTERVAL_MINUTES: "10",
      HEADER_LIMIT: "40",
      SWEEP_LIMIT: "6",
      PROBE_BATCH_SIZE: "0",
      TRUST8004_REQUESTS_PER_RUN: "6",
      EXTERNAL_SUBREQUESTS_PER_RUN: "16",
      D1_QUERIES_PER_RUN: "35",
      D1_ROWS_READ_PER_RUN: "20000",
      D1_ROWS_WRITTEN_PER_RUN: "400",
    },
  ])("matches the marketplace bootstrap contract for %o", (env) => {
    expect(loadConfig(env)).toEqual(loadObservationWorkerConfig(env));
  });
});
