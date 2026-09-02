import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("defaults to the safe Free profile", () => {
    expect(loadConfig({})).toMatchObject({
      plan: "free",
      killSwitch: true,
      producerKillSwitch: true,
      schedulerMode: "single_phase",
      cronIntervalMinutes: 5,
      headerLimit: 25,
      sweepLimit: 4,
      sweepPagesPerRun: 1,
      probeBatchSize: 1,
      catalogProbeBatchSize: 1,
      catalogProbeConcurrency: 2,
      catalogValidationRequestsPerDay: 100,
      catalogValidationRequestsPerCallerDay: 10,
      catalogDiscoveryPageSize: 2,
      catalogIngestTasksPerRun: 1,
      catalogDeclarationsPerTask: 1,
      catalogA2aTimeoutMs: 5_000,
      catalogMcpTimeoutMs: 5_000,
      catalogErc8183TimeoutMs: 5_000,
      catalogPriorityRefreshMinutes: 15,
      catalogA2aRefreshMinutes: 720,
      catalogMcpRefreshMinutes: 1_440,
      catalogErc8183RefreshMinutes: 360,
      catalogFailureBackoffMinutes: [60, 360, 1_440, 10_080],
      catalogV2ReadsEnabled: false,
      catalogV2WritesEnabled: false,
      catalogResponseCacheSeconds: 0,
      probeAgentAllowlist: ["303779"],
      probeEndpointAllowlist: ["https://bnb-agent-marketplace-ruby.vercel.app/grid"],
      trust8004RequestsPerRun: 4,
      externalSubrequestsPerRun: 12,
      d1QueriesPerRun: 40,
      d1RowsReadPerRun: 3_000,
      d1RowsWrittenPerRun: 60,
      probeTimeoutMs: 5_000,
      maxCatalogResponseBytes: 16_777_216,
      maxSellerResponseBytes: 32_768,
      platformLimits: {
        cpuMsPerInvocation: 10,
        queueConsumerCpuMs: 30_000,
      },
      projectedDailyBudget: {
        invocations: 288,
        maxAttemptsPerInvocation: 4,
        maxAttempts: 1_152,
        d1RowsReadNominal: 864_000,
        d1RowsWrittenNominal: 17_856,
        d1RowsRead: 3_456_000,
        d1RowsWritten: 71_424,
        scheduledQueueOperations: 1_728,
        onDemandQueueOperations: 600,
        queueOperations: 2_328,
        freeQueueOperationsCeiling: 8_000,
      },
    });
  });

  it("only enables the Paid profile explicitly", () => {
    expect(loadConfig({ CLOUDFLARE_WORKERS_PLAN: "paid" })).toMatchObject({
      plan: "paid",
      killSwitch: true,
      producerKillSwitch: true,
      schedulerMode: "pipeline",
      cronIntervalMinutes: 1,
      headerLimit: 200,
      sweepLimit: 2_000,
      sweepPagesPerRun: 2,
      probeBatchSize: 10,
      catalogProbeBatchSize: 10,
      catalogProbeConcurrency: 4,
      catalogValidationRequestsPerCallerDay: 100,
      catalogDiscoveryPageSize: 200,
      catalogIngestTasksPerRun: 10,
      catalogDeclarationsPerTask: 20,
      d1QueriesPerRun: 800,
    });
  });

  it.each([
    [{ CLOUDFLARE_WORKERS_PLAN: "enterprise" }, "CLOUDFLARE_WORKERS_PLAN"],
    [{ KILL_SWITCH: "false" }, "KILL_SWITCH"],
    [{ PRODUCER_KILL_SWITCH: "false" }, "PRODUCER_KILL_SWITCH"],
    [{ HEADER_LIMIT: "101" }, "HEADER_LIMIT"],
    [{ SWEEP_LIMIT: "41", TRUST8004_REQUESTS_PER_RUN: "41", EXTERNAL_SUBREQUESTS_PER_RUN: "41" }, "SWEEP_LIMIT"],
    [{ SWEEP_PAGES_PER_RUN: "2" }, "SWEEP_PAGES_PER_RUN"],
    [{ PROBE_BATCH_SIZE: "2" }, "PROBE_BATCH_SIZE"],
    [{ PROBE_BATCH_SIZE: "0" }, "PROBE_BATCH_SIZE"],
    [{ PROBE_TIMEOUT_MS: "0" }, "PROBE_TIMEOUT_MS"],
    [{ CATALOG_DISCOVERY_PAGE_SIZE: "0" }, "CATALOG_DISCOVERY_PAGE_SIZE"],
    [{ CATALOG_VALIDATION_REQUESTS_PER_CALLER_DAY: "0" }, "CATALOG_VALIDATION_REQUESTS_PER_CALLER_DAY"],
    [{ CATALOG_INGEST_TASKS_PER_RUN: "0" }, "CATALOG_INGEST_TASKS_PER_RUN"],
    [{ CATALOG_DECLARATIONS_PER_TASK: "0" }, "CATALOG_DECLARATIONS_PER_TASK"],
    [{ CATALOG_A2A_TIMEOUT_MS: "0" }, "CATALOG_A2A_TIMEOUT_MS"],
    [{ CATALOG_MCP_TIMEOUT_MS: "10001" }, "CATALOG_MCP_TIMEOUT_MS"],
    [{ CATALOG_PRIORITY_REFRESH_MINUTES: "0" }, "CATALOG_PRIORITY_REFRESH_MINUTES"],
    [{ MAX_SELLER_RESPONSE_BYTES: "0" }, "MAX_SELLER_RESPONSE_BYTES"],
    [{ EXTERNAL_SUBREQUESTS_PER_RUN: "41" }, "EXTERNAL_SUBREQUESTS_PER_RUN"],
    [{ D1_QUERIES_PER_RUN: "41" }, "D1_QUERIES_PER_RUN"],
    [{ D1_QUERIES_PER_RUN: "12" }, "D1_QUERIES_PER_RUN"],
    [{ D1_ROWS_READ_PER_RUN: "0" }, "D1_ROWS_READ_PER_RUN"],
    [{ D1_ROWS_WRITTEN_PER_RUN: "0" }, "D1_ROWS_WRITTEN_PER_RUN"],
    [{ MAX_CATALOG_RESPONSE_BYTES: "16777217" }, "MAX_CATALOG_RESPONSE_BYTES"],
    [{ MAX_CATALOG_RESPONSE_BYTES: "0" }, "MAX_CATALOG_RESPONSE_BYTES"],
    [{ CRON_INTERVAL_MINUTES: "0" }, "CRON_INTERVAL_MINUTES"],
    [{ CRON_INTERVAL_MINUTES: "7" }, "CRON_INTERVAL_MINUTES"],
    [{ CRON_INTERVAL_MINUTES: "120" }, "CRON_INTERVAL_MINUTES"],
    [{ HEADER_LIMIT: "1.5" }, "HEADER_LIMIT"],
  ])("rejects an unsafe or malformed Free setting", (env, field) => {
    expect(() => loadConfig(env)).toThrow(new RegExp(`^${field}:`));
  });

  it("rejects retry-aware daily Free D1 projections above the reserved quota", () => {
    expect(() => loadConfig({ D1_ROWS_WRITTEN_PER_RUN: "70" })).toThrow(
      /^D1_ROWS_WRITTEN_PER_RUN:/,
    );
    expect(() => loadConfig({ D1_ROWS_READ_PER_RUN: "3473" })).toThrow(
      /^D1_ROWS_READ_PER_RUN:/,
    );
  });

  it("budgets the three configured Queue retries at the fastest cadence", () => {
    expect(() => loadConfig({
      CRON_INTERVAL_MINUTES: "1",
      D1_ROWS_READ_PER_RUN: "1",
      D1_ROWS_WRITTEN_PER_RUN: "1",
    })).toThrow(/^CRON_INTERVAL_MINUTES:/);
  });

  it("requires the upstream request budget to fit the external budget", () => {
    expect(() =>
      loadConfig({
        TRUST8004_REQUESTS_PER_RUN: "13",
        EXTERNAL_SUBREQUESTS_PER_RUN: "12",
      }),
    ).toThrow(/^TRUST8004_REQUESTS_PER_RUN:/);
  });

  it("requires the Free SWEEP detail count to fit the upstream request budget", () => {
    expect(() => loadConfig({ SWEEP_LIMIT: "5" })).toThrow(/^SWEEP_LIMIT:/);
    expect(loadConfig({ SWEEP_LIMIT: "4", TRUST8004_REQUESTS_PER_RUN: "4" }).sweepLimit).toBe(4);
  });

  it("requires the catalog batch worst case to fit the external subrequest budget", () => {
    expect(() => loadConfig({
      CATALOG_PROBE_BATCH_SIZE: "4",
      CATALOG_PROBE_CONCURRENCY: "2",
    })).toThrow(/^CATALOG_PROBE_BATCH_SIZE:/);
    expect(loadConfig({
      CATALOG_PROBE_BATCH_SIZE: "4",
      CATALOG_PROBE_CONCURRENCY: "2",
      EXTERNAL_SUBREQUESTS_PER_RUN: "15",
    })).toMatchObject({
      catalogProbeBatchSize: 4,
      catalogProbeConcurrency: 2,
      externalSubrequestsPerRun: 15,
    });
    expect(() => loadConfig({ CATALOG_PROBE_BATCH_SIZE: "5" })).toThrow(/^CATALOG_PROBE_BATCH_SIZE:/);
    expect(() => loadConfig({ CATALOG_PROBE_CONCURRENCY: "3" })).toThrow(/^CATALOG_PROBE_CONCURRENCY:/);
  });

  it("reserves Free Queue capacity for bounded on-demand validations", () => {
    expect(loadConfig({ CATALOG_VALIDATION_REQUESTS_PER_DAY: "1" })).toMatchObject({
      catalogValidationRequestsPerDay: 1,
      projectedDailyBudget: { onDemandQueueOperations: 6, queueOperations: 1_734 },
    });
    expect(() => loadConfig({ CATALOG_VALIDATION_REQUESTS_PER_DAY: "501" }))
      .toThrow(/^CATALOG_VALIDATION_REQUESTS_PER_DAY:/);
  });

  it("keeps the per-caller validation budget below the global budget", () => {
    expect(loadConfig({ CATALOG_VALIDATION_REQUESTS_PER_CALLER_DAY: "7" }))
      .toMatchObject({ catalogValidationRequestsPerCallerDay: 7 });
    expect(() => loadConfig({ CATALOG_VALIDATION_REQUESTS_PER_DAY: "5", CATALOG_VALIDATION_REQUESTS_PER_CALLER_DAY: "6" }))
      .toThrow(/^CATALOG_VALIDATION_REQUESTS_PER_CALLER_DAY:/);
  });

  it("keeps ingest, protocol deadlines, freshness and backoff configurable", () => {
    expect(loadConfig({
      CLOUDFLARE_WORKERS_PLAN: "paid",
      CATALOG_DISCOVERY_PAGE_SIZE: "10",
      CATALOG_INGEST_TASKS_PER_RUN: "1",
      CATALOG_DECLARATIONS_PER_TASK: "3",
      CATALOG_A2A_TIMEOUT_MS: "4000",
      CATALOG_MCP_TIMEOUT_MS: "9000",
      CATALOG_ERC8183_TIMEOUT_MS: "3000",
      CATALOG_PRIORITY_REFRESH_MINUTES: "10",
      CATALOG_A2A_REFRESH_MINUTES: "600",
      CATALOG_MCP_REFRESH_MINUTES: "1200",
      CATALOG_ERC8183_REFRESH_MINUTES: "300",
      CATALOG_FAILURE_BACKOFF_MINUTES: "30,120,720,4320",
    })).toMatchObject({
      catalogDiscoveryPageSize: 10,
      catalogIngestTasksPerRun: 1,
      catalogDeclarationsPerTask: 3,
      catalogA2aTimeoutMs: 4_000,
      catalogMcpTimeoutMs: 9_000,
      catalogErc8183TimeoutMs: 3_000,
      catalogPriorityRefreshMinutes: 10,
      catalogA2aRefreshMinutes: 600,
      catalogMcpRefreshMinutes: 1_200,
      catalogErc8183RefreshMinutes: 300,
      catalogFailureBackoffMinutes: [30, 120, 720, 4_320],
    });
  });

  it.each([
    "",
    "60",
    "60,30",
    "0,60",
    "60,abc",
    "60,360,1440,10081",
  ])("rejects an invalid catalog failure backoff sequence: %s", (value) => {
    expect(() => loadConfig({ CATALOG_FAILURE_BACKOFF_MINUTES: value }))
      .toThrow(/^CATALOG_FAILURE_BACKOFF_MINUTES:/);
  });

  it("requires catalog discovery and ingest to fit the trust8004 request budget", () => {
    expect(() => loadConfig({
      CATALOG_INGEST_TASKS_PER_RUN: "4",
      TRUST8004_REQUESTS_PER_RUN: "4",
    })).toThrow(/^CATALOG_INGEST_TASKS_PER_RUN:/);
  });

  it("requires an all-new two-page discovery sweep to fit the D1 query budget", () => {
    expect(loadConfig({
      CLOUDFLARE_WORKERS_PLAN: "paid",
      CATALOG_DISCOVERY_PAGE_SIZE: "15",
    }).catalogDiscoveryPageSize).toBe(15);
    expect(() => loadConfig({
      CLOUDFLARE_WORKERS_PLAN: "paid",
      CATALOG_DISCOVERY_PAGE_SIZE: "2000",
    }))
      .toThrow(/^CATALOG_DISCOVERY_PAGE_SIZE:/);
  });

  it("keeps the Free catalog page and declaration chunk within the measured row envelope", () => {
    expect(() => loadConfig({ CATALOG_DISCOVERY_PAGE_SIZE: "3" }))
      .toThrow(/^CATALOG_DISCOVERY_PAGE_SIZE:/);
    expect(() => loadConfig({ CATALOG_INGEST_TASKS_PER_RUN: "2" }))
      .toThrow(/^CATALOG_INGEST_TASKS_PER_RUN:/);
    expect(() => loadConfig({ CATALOG_DECLARATIONS_PER_TASK: "2" }))
      .toThrow(/^CATALOG_DECLARATIONS_PER_TASK:/);
    expect(loadConfig({ CLOUDFLARE_WORKERS_PLAN: "paid", CATALOG_DISCOVERY_PAGE_SIZE: "3" }))
      .toMatchObject({ catalogDiscoveryPageSize: 3 });
  });

  it("keeps v2 writes behind an explicit rollout switch", () => {
    expect(loadConfig({ CATALOG_V2_WRITES_ENABLED: "1" }).catalogV2WritesEnabled).toBe(true);
    expect(() => loadConfig({ CATALOG_V2_WRITES_ENABLED: "yes" }))
      .toThrow(/^CATALOG_V2_WRITES_ENABLED:/);
  });

  it("can roll API reads back independently of v2 writes", () => {
    expect(loadConfig({ CATALOG_V2_READS_ENABLED: "0" }).catalogV2ReadsEnabled).toBe(false);
    expect(loadConfig({ CATALOG_V2_READS_ENABLED: "1" }).catalogV2ReadsEnabled).toBe(true);
    expect(() => loadConfig({ CATALOG_V2_READS_ENABLED: "yes" }))
      .toThrow(/^CATALOG_V2_READS_ENABLED:/);
    expect(loadConfig({ CATALOG_RESPONSE_CACHE_SECONDS: "300" }).catalogResponseCacheSeconds).toBe(300);
    expect(() => loadConfig({ CATALOG_RESPONSE_CACHE_SECONDS: "3601" }))
      .toThrow(/^CATALOG_RESPONSE_CACHE_SECONDS:/);
    expect(() => loadConfig({ CATALOG_RESPONSE_CACHE_SECONDS: "30s" }))
      .toThrow(/^CATALOG_RESPONSE_CACHE_SECONDS:/);
  });

  it.each([
    [{ PROBE_AGENT_ALLOWLIST: "" }, "PROBE_AGENT_ALLOWLIST"],
    [{ PROBE_AGENT_ALLOWLIST: "abc" }, "PROBE_AGENT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "http://seller.example/a2a" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://seller.example/a2a?token=secret" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://seller.example/a2a#card" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://user:pass@seller.example/a2a" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://127.0.0.1/a2a" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://10.0.0.1/a2a" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://[::1]/a2a" }, "PROBE_ENDPOINT_ALLOWLIST"],
  ])("fails closed for an unsafe probe restriction", (env, field) => {
    expect(() => loadConfig(env)).toThrow(new RegExp(`^${field}:`));
  });

  it("accepts one explicit Grid target and canonicalizes its endpoint", () => {
    expect(loadConfig({
      PROBE_AGENT_ALLOWLIST: "303779",
      PROBE_ENDPOINT_ALLOWLIST: "https://bnb-agent-marketplace-ruby.vercel.app/grid",
    })).toMatchObject({
      probeAgentAllowlist: ["303779"],
      probeEndpointAllowlist: ["https://bnb-agent-marketplace-ruby.vercel.app/grid"],
    });
  });

  it("requires an explicit architecture-gate flag for the general WP4 target set", () => {
    expect(() => loadConfig({
      PROBE_AGENT_ALLOWLIST: "*",
      PROBE_ENDPOINT_ALLOWLIST: "*",
    })).toThrow(/^PROBE_AGENT_ALLOWLIST:/);
    expect(loadConfig({
      PROBE_AGENT_ALLOWLIST: "*",
      PROBE_ENDPOINT_ALLOWLIST: "*",
      PROBE_GENERAL_EGRESS_APPROVED: "1",
    })).toMatchObject({ probeAgentAllowlist: [], probeEndpointAllowlist: [] });
  });

  it("uses typed configuration errors without including environment values", () => {
    const secretLikeValue = "not-valid-super-secret";

    try {
      loadConfig({ KILL_SWITCH: secretLikeValue });
      throw new Error("expected loadConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).not.toContain(secretLikeValue);
    }
  });
});
