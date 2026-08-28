import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("defaults to the safe Free profile", () => {
    expect(loadConfig({})).toMatchObject({
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
        queueOperations: 1_728,
        freeQueueOperationsCeiling: 8_000,
      },
    });
  });

  it("only enables the Paid profile explicitly", () => {
    expect(loadConfig({ CLOUDFLARE_WORKERS_PLAN: "paid" })).toMatchObject({
      plan: "paid",
      killSwitch: true,
      schedulerMode: "pipeline",
      cronIntervalMinutes: 1,
      headerLimit: 200,
      sweepLimit: 2_000,
      sweepPagesPerRun: 2,
      probeBatchSize: 10,
      d1QueriesPerRun: 800,
    });
  });

  it.each([
    [{ CLOUDFLARE_WORKERS_PLAN: "enterprise" }, "CLOUDFLARE_WORKERS_PLAN"],
    [{ KILL_SWITCH: "false" }, "KILL_SWITCH"],
    [{ HEADER_LIMIT: "51" }, "HEADER_LIMIT"],
    [{ SWEEP_LIMIT: "41", TRUST8004_REQUESTS_PER_RUN: "41", EXTERNAL_SUBREQUESTS_PER_RUN: "41" }, "SWEEP_LIMIT"],
    [{ SWEEP_PAGES_PER_RUN: "2" }, "SWEEP_PAGES_PER_RUN"],
    [{ PROBE_BATCH_SIZE: "2" }, "PROBE_BATCH_SIZE"],
    [{ PROBE_BATCH_SIZE: "0" }, "PROBE_BATCH_SIZE"],
    [{ PROBE_TIMEOUT_MS: "0" }, "PROBE_TIMEOUT_MS"],
    [{ MAX_SELLER_RESPONSE_BYTES: "0" }, "MAX_SELLER_RESPONSE_BYTES"],
    [{ EXTERNAL_SUBREQUESTS_PER_RUN: "41" }, "EXTERNAL_SUBREQUESTS_PER_RUN"],
    [{ D1_QUERIES_PER_RUN: "41" }, "D1_QUERIES_PER_RUN"],
    [{ D1_QUERIES_PER_RUN: "11" }, "D1_QUERIES_PER_RUN"],
    [{ D1_ROWS_READ_PER_RUN: "0" }, "D1_ROWS_READ_PER_RUN"],
    [{ D1_ROWS_WRITTEN_PER_RUN: "0" }, "D1_ROWS_WRITTEN_PER_RUN"],
    [{ MAX_CATALOG_RESPONSE_BYTES: "16777217" }, "MAX_CATALOG_RESPONSE_BYTES"],
    [{ MAX_CATALOG_RESPONSE_BYTES: "0" }, "MAX_CATALOG_RESPONSE_BYTES"],
    [{ CRON_INTERVAL_MINUTES: "0" }, "CRON_INTERVAL_MINUTES"],
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
    expect(loadConfig({ SWEEP_LIMIT: "5", TRUST8004_REQUESTS_PER_RUN: "5" }).sweepLimit).toBe(5);
  });

  it.each([
    [{ PROBE_AGENT_ALLOWLIST: "" }, "PROBE_AGENT_ALLOWLIST"],
    [{ PROBE_AGENT_ALLOWLIST: "303779,45650" }, "PROBE_AGENT_ALLOWLIST"],
    [{ PROBE_AGENT_ALLOWLIST: "abc" }, "PROBE_AGENT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://seller.example/a2a" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "http://seller.example/a2a" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://seller.example/a2a?token=secret" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://seller.example/a2a#card" }, "PROBE_ENDPOINT_ALLOWLIST"],
    [{ PROBE_ENDPOINT_ALLOWLIST: "https://user:pass@seller.example/a2a" }, "PROBE_ENDPOINT_ALLOWLIST"],
  ])("fails closed for an unsafe WP3 allowlist", (env, field) => {
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
