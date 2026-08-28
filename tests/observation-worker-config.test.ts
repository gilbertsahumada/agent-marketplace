import { describe, expect, it } from "vitest";
import {
  loadObservationWorkerConfig,
  ObservationWorkerConfigError,
} from "../src/observation/worker-config.ts";
import {
  phasesForInvocation,
  rotateObservationPhase,
} from "../src/observation/scheduler-policy.ts";

describe("observation Worker configuration", () => {
  it("defaults to a disabled Free-plan profile", () => {
    const config = loadObservationWorkerConfig({});

    expect(config).toMatchObject({
      plan: "free",
      killSwitch: true,
      schedulerMode: "single_phase",
      cronIntervalMinutes: 5,
      headerLimit: 25,
      sweepLimit: 4,
      sweepPagesPerRun: 1,
      probeBatchSize: 1,
      probeAgentAllowlist: ["303779"],
      probeEndpointAllowlist: [
        "https://bnb-agent-marketplace-ruby.vercel.app/grid",
      ],
      trust8004RequestsPerRun: 4,
      externalSubrequestsPerRun: 12,
      d1QueriesPerRun: 40,
      d1RowsReadPerRun: 3_000,
      d1RowsWrittenPerRun: 60,
      maxCatalogResponseBytes: 16_777_216,
    });
    expect(config.platformLimits).toMatchObject({
      cpuMsPerInvocation: 10,
      queueConsumerCpuMs: 30_000,
      externalSubrequestsPerInvocation: 50,
      d1QueriesPerInvocation: 50,
      d1RowsReadPerDay: 5_000_000,
      d1RowsWrittenPerDay: 100_000,
    });
  });

  it("accepts conservative Free-plan overrides", () => {
    const config = loadObservationWorkerConfig({
      KILL_SWITCH: "0",
      CRON_INTERVAL_MINUTES: "10",
      HEADER_LIMIT: "40",
      SWEEP_LIMIT: "6",
      PROBE_BATCH_SIZE: "1",
      TRUST8004_REQUESTS_PER_RUN: "6",
      EXTERNAL_SUBREQUESTS_PER_RUN: "16",
      D1_QUERIES_PER_RUN: "35",
      D1_ROWS_READ_PER_RUN: "5000",
      D1_ROWS_WRITTEN_PER_RUN: "100",
    });

    expect(config).toMatchObject({
      plan: "free",
      killSwitch: false,
      cronIntervalMinutes: 10,
      headerLimit: 40,
      sweepLimit: 6,
      probeBatchSize: 1,
      trust8004RequestsPerRun: 6,
      externalSubrequestsPerRun: 16,
      d1QueriesPerRun: 35,
    });
  });

  it("uses the higher-throughput defaults only when Paid is explicit", () => {
    const config = loadObservationWorkerConfig({
      CLOUDFLARE_WORKERS_PLAN: "paid",
    });

    expect(config).toMatchObject({
      plan: "paid",
      killSwitch: true,
      schedulerMode: "pipeline",
      cronIntervalMinutes: 1,
      headerLimit: 200,
      sweepLimit: 2_000,
      sweepPagesPerRun: 2,
      probeBatchSize: 10,
      trust8004RequestsPerRun: 20,
      externalSubrequestsPerRun: 55,
      d1QueriesPerRun: 800,
    });
    expect(config.platformLimits).toMatchObject({
      cpuMsPerInvocation: 30_000,
      externalSubrequestsPerInvocation: 10_000,
      d1QueriesPerInvocation: 1_000,
    });
  });

  it.each([
    [{ CLOUDFLARE_WORKERS_PLAN: "enterprise" }, "CLOUDFLARE_WORKERS_PLAN"],
    [{ KILL_SWITCH: "false" }, "KILL_SWITCH"],
    [{ HEADER_LIMIT: "51" }, "HEADER_LIMIT"],
    [{ SWEEP_LIMIT: "51" }, "SWEEP_LIMIT"],
    [{ SWEEP_PAGES_PER_RUN: "2" }, "SWEEP_PAGES_PER_RUN"],
    [{ PROBE_BATCH_SIZE: "2" }, "PROBE_BATCH_SIZE"],
    [{ PROBE_BATCH_SIZE: "0" }, "PROBE_BATCH_SIZE"],
    [{ PROBE_TIMEOUT_MS: "0" }, "PROBE_TIMEOUT_MS"],
    [{ MAX_SELLER_RESPONSE_BYTES: "0" }, "MAX_SELLER_RESPONSE_BYTES"],
    [{ PROBE_AGENT_ALLOWLIST: "303779,45650" }, "PROBE_AGENT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://seller.example/a2a" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "http://seller.example/a2a" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://seller.example/a2a?key=secret" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ EXTERNAL_SUBREQUESTS_PER_RUN: "41" }, "EXTERNAL_SUBREQUESTS_PER_RUN"],
    [{ D1_QUERIES_PER_RUN: "41" }, "D1_QUERIES_PER_RUN"],
    [{ D1_QUERIES_PER_RUN: "11" }, "D1_QUERIES_PER_RUN"],
    [{ D1_ROWS_READ_PER_RUN: "0" }, "D1_ROWS_READ_PER_RUN"],
    [{ D1_ROWS_WRITTEN_PER_RUN: "0" }, "D1_ROWS_WRITTEN_PER_RUN"],
    [{ MAX_CATALOG_RESPONSE_BYTES: "16777217" }, "MAX_CATALOG_RESPONSE_BYTES"],
    [{ MAX_CATALOG_RESPONSE_BYTES: "0" }, "MAX_CATALOG_RESPONSE_BYTES"],
    [{ TRUST8004_REQUESTS_PER_RUN: "13" }, "TRUST8004_REQUESTS_PER_RUN"],
    [{ CRON_INTERVAL_MINUTES: "1" }, "D1_ROWS_WRITTEN_PER_RUN"],
  ])("rejects a Free-plan configuration that crosses its safety envelope", (env, field) => {
    expect(() => loadObservationWorkerConfig(env)).toThrowError(ObservationWorkerConfigError);
    expect(() => loadObservationWorkerConfig(env)).toThrow(field);
  });

  it("rejects a trust8004 budget larger than the total external budget", () => {
    expect(() => loadObservationWorkerConfig({
      TRUST8004_REQUESTS_PER_RUN: "10",
      EXTERNAL_SUBREQUESTS_PER_RUN: "9",
    })).toThrow("TRUST8004_REQUESTS_PER_RUN");
  });

  it("reports projected Free-plan D1 usage with a twenty-percent reserve", () => {
    const config = loadObservationWorkerConfig({});

    expect(config.projectedDailyBudget).toEqual({
      invocations: 288,
      maxAttemptsPerInvocation: 4,
      maxAttempts: 1_152,
      d1RowsReadNominal: 864_000,
      d1RowsWrittenNominal: 17_280,
      d1RowsRead: 3_456_000,
      d1RowsWritten: 69_120,
      queueOperations: 1_728,
      freeReadCeiling: 4_000_000,
      freeWriteCeiling: 80_000,
      freeQueueOperationsCeiling: 8_000,
    });
  });

  it("rejects D1 row budgets whose configured retries cross the reserve", () => {
    expect(() => loadObservationWorkerConfig({
      D1_ROWS_READ_PER_RUN: "3473",
    })).toThrow("D1_ROWS_READ_PER_RUN");
    expect(() => loadObservationWorkerConfig({
      D1_ROWS_WRITTEN_PER_RUN: "70",
    })).toThrow("D1_ROWS_WRITTEN_PER_RUN");
  });

  it("includes configured Queue retries in the Free cadence budget", () => {
    expect(() => loadObservationWorkerConfig({
      CRON_INTERVAL_MINUTES: "1",
      D1_ROWS_READ_PER_RUN: "1",
      D1_ROWS_WRITTEN_PER_RUN: "1",
    })).toThrow("CRON_INTERVAL_MINUTES");
  });
});

describe("observation scheduler policy", () => {
  it("runs and rotates exactly one phase on Free", () => {
    const config = loadObservationWorkerConfig({});

    expect(phasesForInvocation(config, "sweep")).toEqual(["sweep"]);
    expect(rotateObservationPhase("header")).toBe("sweep");
    expect(rotateObservationPhase("sweep")).toBe("probe");
    expect(rotateObservationPhase("probe")).toBe("header");
  });

  it("uses the complete ordered pipeline on Paid", () => {
    const config = loadObservationWorkerConfig({ CLOUDFLARE_WORKERS_PLAN: "paid" });

    expect(phasesForInvocation(config, "probe")).toEqual(["header", "sweep", "probe"]);
  });
});
