import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildWp224hArtifact, validateWp224hArtifact } from "../src/evidence/wp2-24h-artifact";
import { resolveRawEvidencePath } from "../scripts/build-wp2-artifact";
import {
  WP2_ATTEMPT_COHORT_SQL,
  WP2_D1_ACCOUNT_ANALYTICS_QUERY,
  WP2_D1_DATABASE_ANALYTICS_QUERY,
  WP2_QUEUE_ACCOUNT_ANALYTICS_QUERY,
  WP2_QUEUE_ANALYTICS_QUERY,
  WP2_WORKERS_ANALYTICS_QUERY,
} from "../src/evidence/wp2-24h-queries";

const WINDOW_START = Date.parse("2026-08-29T00:00:00.000Z");
const DEPLOYMENT_VERSION = "00000000-0000-4000-8000-000000000001";
const DRAIN_VERSION = "00000000-0000-4000-8000-000000000099";
const D1_ID = "6fbeea3e-4516-4c4e-a5c4-392cb067198a";
const ACCOUNT_ID = "bc8d4adf4860284fda426b24e7377bc2";
const QUEUE_ID = "721ba809967d425a91dbc34eb1ac3baa";
const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const CAPTURED_AT = "2026-08-30T00:16:00.000Z";
const FIXTURE_LEDGER = Array.from({ length: 288 }, (_, index) => ({
  messageId: `message-${index}`,
  scheduledTime: WINDOW_START + 14_000 + index * 5 * 60_000,
  attempt: 1,
  phase: (["header", "sweep", "probe"] as const)[index % 3],
  outcome: "completed",
  upstreamRequests: index % 3 === 1 ? 4 : index % 3 === 2 ? 8 : 1,
  d1Queries: 13,
  rowsReadObservedBeforeLedger: 20,
  rowsWrittenObservedBeforeLedger: 8,
  startedAt: WINDOW_START + 14_000 + index * 5 * 60_000,
  finishedAt: WINDOW_START + 15_000 + index * 5 * 60_000,
  errorCode: null,
}));
function controlFixture(
  mode: "preflight" | "activation" | "drain" | "cleanup",
  completedAt: string,
): Record<string, unknown> {
  const producing = mode === "activation";
  const consuming = mode === "activation" || mode === "drain";
  const plain = (name: string, text: string) => ({ name, text, type: "plain_text" });
  const bindings = [
    plain("DEPLOYMENT_ENV", "staging"), plain("CLOUDFLARE_WORKERS_PLAN", "free"),
    plain("CRON_INTERVAL_MINUTES", "5"), plain("HEADER_LIMIT", "25"),
    plain("SWEEP_LIMIT", "4"), plain("SWEEP_PAGES_PER_RUN", "1"),
    plain("PROBE_BATCH_SIZE", "1"), plain("TRUST8004_REQUESTS_PER_RUN", "4"),
    plain("EXTERNAL_SUBREQUESTS_PER_RUN", "12"), plain("D1_QUERIES_PER_RUN", "40"),
    plain("D1_ROWS_READ_PER_RUN", "3000"), plain("D1_ROWS_WRITTEN_PER_RUN", "60"),
    plain("PROBE_TIMEOUT_MS", "5000"), plain("MAX_CATALOG_RESPONSE_BYTES", "16777216"),
    plain("MAX_SELLER_RESPONSE_BYTES", "32768"),
    plain("KILL_SWITCH", consuming ? "0" : "1"),
    plain("PRODUCER_KILL_SWITCH", producing ? "0" : "1"),
    plain("STAGING_MANUAL_RUN", "0"),
    { name: "DB", type: "d1", id: D1_ID },
    { name: "WP2_QUEUE", type: "queue", queue_name: "bnb-agent-probe-staging" },
  ];
  return {
    request: {
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      backlogUrl: "https://api.cloudflare.com/client/v4/accounts/bc8d4adf4860284fda426b24e7377bc2/queues/721ba809967d425a91dbc34eb1ac3baa/metrics",
      completedAt,
      healthUrl: "https://bnb-agent-probe-staging.gilbertsahumada.workers.dev/health",
      mode,
      queueId: "721ba809967d425a91dbc34eb1ac3baa",
      schedulesUrl: "https://api.cloudflare.com/client/v4/accounts/bc8d4adf4860284fda426b24e7377bc2/workers/scripts/bnb-agent-probe-staging/schedules",
      settingsUrl: "https://api.cloudflare.com/client/v4/accounts/bc8d4adf4860284fda426b24e7377bc2/workers/scripts/bnb-agent-probe-staging/settings",
      scriptName: "bnb-agent-probe-staging",
      startedAt: new Date(Date.parse(completedAt) - 500).toISOString(),
    },
    response: {
      schedules: { success: true, errors: [], result: { schedules: producing ? [{ cron: "*/5 * * * *" }] : [] } },
      backlog: { success: true, errors: [], result: {
        backlog_count: 0, backlog_bytes: 0, oldest_message_timestamp_ms: 0,
      } },
      settings: { success: true, errors: [], result: { bindings } },
      health: { status: "ok", plan: "free", schedulerMode: "single_phase",
        killSwitch: !consuming, producerKillSwitch: !producing,
        budgets: { cronIntervalMinutes: 5, headerLimit: 25, sweepLimit: 4,
          sweepPagesPerRun: 1, probeBatchSize: 1, trust8004RequestsPerRun: 4,
          externalSubrequestsPerRun: 12, d1QueriesPerRun: 40, d1RowsReadPerRun: 3000,
          d1RowsWrittenPerRun: 60, probeTimeoutMs: 5000,
          maxCatalogResponseBytes: 16777216, maxSellerResponseBytes: 32768 } },
      secrets: [{ name: "BSC_RPC_URL", type: "secret_text" }],
    },
  };
}
const RAW_PAYLOADS = {
  "evidence/raw/d1-database.json": {
    request: { accountId: ACCOUNT_ID, capturedAt: CAPTURED_AT, endpoint: GRAPHQL_ENDPOINT,
      query: WP2_D1_DATABASE_ANALYTICS_QUERY, date: "2026-08-29", databaseId: D1_ID,
      variables: { accountTag: ACCOUNT_ID, date: "2026-08-29", databaseId: D1_ID } },
    response: { data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{
      dimensions: { date: "2026-08-29", databaseId: D1_ID },
      sum: { readQueries: 3_000, writeQueries: 1_000, rowsRead: 200_000, rowsWritten: 20_000 },
    }] }] } }, errors: null },
  },
  "evidence/raw/d1-account.json": {
    request: { accountId: ACCOUNT_ID, capturedAt: CAPTURED_AT, endpoint: GRAPHQL_ENDPOINT,
      query: WP2_D1_ACCOUNT_ANALYTICS_QUERY, date: "2026-08-29",
      variables: { accountTag: ACCOUNT_ID, date: "2026-08-29" } },
    response: { data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [
      {
        dimensions: { date: "2026-08-29", databaseId: D1_ID },
        sum: { readQueries: 3_000, writeQueries: 1_000, rowsRead: 200_000, rowsWritten: 20_000 },
      },
      {
        dimensions: { date: "2026-08-29", databaseId: "00000000-0000-4000-8000-000000000002" },
        sum: { readQueries: 20, writeQueries: 10, rowsRead: 50_000, rowsWritten: 5_000 },
      },
    ] }] } }, errors: null },
  },
  "evidence/raw/scheduler-attempts.json": {
    request: {
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      capturedAt: "2026-08-30T00:16:00.000Z",
      completedAt: "2026-08-30T00:16:00.000Z",
      databaseId: D1_ID,
      params: [WINDOW_START, WINDOW_START + 24 * 60 * 60_000, WINDOW_START, WINDOW_START + 24 * 60 * 60_000],
      sql: WP2_ATTEMPT_COHORT_SQL,
      startedAt: "2026-08-30T00:15:59.500Z",
      windowEnd: "2026-08-30T00:00:00.000Z",
      windowStart: "2026-08-29T00:00:00.000Z",
    },
    response: { success: true, errors: [], result: [{ results: FIXTURE_LEDGER }] },
  },
  "evidence/raw/workers.json": {
    request: {
      accountId: ACCOUNT_ID, capturedAt: CAPTURED_AT, endpoint: GRAPHQL_ENDPOINT,
      query: WP2_WORKERS_ANALYTICS_QUERY,
      scriptName: "bnb-agent-probe-staging",
      start: "2026-08-29T00:00:00.000Z",
      endInclusive: "2026-08-29T23:59:59.999Z",
      terminalityEndInclusive: "2026-08-30T00:15:00.000Z",
      variables: { accountTag: ACCOUNT_ID, scriptName: "bnb-agent-probe-staging",
        start: "2026-08-29T00:00:00.000Z", terminalityEndInclusive: "2026-08-30T00:15:00.000Z" },
    },
    response: { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [
      {
        dimensions: { datetime: "2026-08-29T00:00:14Z", scriptName: "bnb-agent-probe-staging",
          scriptVersion: DEPLOYMENT_VERSION, status: "success" },
        quantiles: { cpuTimeP50: 1_000, cpuTimeP99: 1_140, durationP50: 0.03,
          memoryUsageBytesP50: 8_000_000, memoryUsageBytesP99: 9_000_000,
          memoryUsageBytesP999: 10_000_000 },
        sum: { errors: 0, requests: 288, subrequests: 0 },
      },
      {
        dimensions: { datetime: "2026-08-29T00:00:18Z", scriptName: "bnb-agent-probe-staging",
          scriptVersion: DEPLOYMENT_VERSION, status: "success" },
        quantiles: { cpuTimeP50: 100_000, cpuTimeP99: 200_000, durationP50: 0.2,
          memoryUsageBytesP50: 8_000_000, memoryUsageBytesP99: 11_000_000,
          memoryUsageBytesP999: 12_000_000 },
        sum: { errors: 0, requests: 288, subrequests: 288 },
      },
    ] }] } }, errors: null },
  },
  "evidence/raw/queue.json": {
    request: {
      accountId: ACCOUNT_ID, capturedAt: CAPTURED_AT, endpoint: GRAPHQL_ENDPOINT,
      query: WP2_QUEUE_ANALYTICS_QUERY, queueId: QUEUE_ID,
      start: "2026-08-29T00:00:00.000Z",
      endInclusive: "2026-08-29T23:59:59.999Z",
      terminalityEndInclusive: "2026-08-30T00:15:00.000Z",
      variables: { accountTag: ACCOUNT_ID, queueId: QUEUE_ID, start: "2026-08-29T00:00:00.000Z",
        endInclusive: "2026-08-29T23:59:59.999Z",
        terminalityEndInclusive: "2026-08-30T00:15:00.000Z" },
    },
    response: { data: { viewer: { accounts: [{
      queueDayOperations: [
        {
          count: 288,
          dimensions: { datetime: "2026-08-29T00:00:14Z", queueId: "721ba809967d425a91dbc34eb1ac3baa", actionType: "WriteMessage", consumerType: "", outcome: "" },
          avg: { lagTime: 0, retryCount: 0 }, max: { messageSize: 64 },
          sum: { billableOperations: 288, bytes: 18_432 },
        },
        {
          count: 288,
          dimensions: { datetime: "2026-08-29T23:55:18Z", queueId: "721ba809967d425a91dbc34eb1ac3baa", actionType: "ReadMessage", consumerType: "worker", outcome: "" },
          avg: { lagTime: 1_000, retryCount: 0 }, max: { messageSize: 64 },
          sum: { billableOperations: 288, bytes: 18_432 },
        },
        {
          count: 288,
          dimensions: { datetime: "2026-08-29T23:55:18Z", queueId: "721ba809967d425a91dbc34eb1ac3baa", actionType: "DeleteMessage", consumerType: "", outcome: "success" },
          avg: { lagTime: 1_000, retryCount: 0 }, max: { messageSize: 64 },
          sum: { billableOperations: 288, bytes: 18_432 },
        },
      ],
      queueTerminalOperations: [
        {
          count: 288,
          dimensions: { datetime: "2026-08-29T00:00:14Z", queueId: "721ba809967d425a91dbc34eb1ac3baa", actionType: "WriteMessage", consumerType: "", outcome: "" },
          avg: { lagTime: 0, retryCount: 0 }, max: { messageSize: 64 },
          sum: { billableOperations: 288, bytes: 18_432 },
        },
        {
          count: 288,
          dimensions: { datetime: "2026-08-29T23:55:18Z", queueId: "721ba809967d425a91dbc34eb1ac3baa", actionType: "ReadMessage", consumerType: "worker", outcome: "" },
          avg: { lagTime: 1_000, retryCount: 0 }, max: { messageSize: 64 },
          sum: { billableOperations: 288, bytes: 18_432 },
        },
        {
          count: 288,
          dimensions: { datetime: "2026-08-29T23:55:18Z", queueId: "721ba809967d425a91dbc34eb1ac3baa", actionType: "DeleteMessage", consumerType: "", outcome: "success" },
          avg: { lagTime: 1_000, retryCount: 0 }, max: { messageSize: 64 },
          sum: { billableOperations: 288, bytes: 18_432 },
        },
      ],
      queueBacklogAdaptiveGroups: [{
        dimensions: { datetime: "2026-08-30T00:15:00Z", queueId: "721ba809967d425a91dbc34eb1ac3baa" },
        avg: { messages: 0, bytes: 0 },
      }],
    }] } }, errors: null },
  },
  "evidence/raw/queue-account.json": {
    request: {
      accountId: ACCOUNT_ID, capturedAt: CAPTURED_AT, endpoint: GRAPHQL_ENDPOINT,
      query: WP2_QUEUE_ACCOUNT_ANALYTICS_QUERY,
      start: "2026-08-29T00:00:00.000Z",
      endInclusive: "2026-08-29T23:59:59.999Z",
      variables: { accountTag: ACCOUNT_ID, start: "2026-08-29T00:00:00.000Z",
        endInclusive: "2026-08-29T23:59:59.999Z" },
    },
    response: { data: { viewer: { accounts: [{ queueMessageOperationsAdaptiveGroups: [
      {
        dimensions: { datetime: "2026-08-29T00:00:00Z", queueId: "721ba809967d425a91dbc34eb1ac3baa" },
        sum: { billableOperations: 864 },
      },
      {
        dimensions: { datetime: "2026-08-29T00:00:00Z", queueId: "00000000000000000000000000000002" },
        sum: { billableOperations: 100 },
      },
    ] }] } }, errors: null },
  },
  "evidence/raw/deployment.json": {
    request: { scriptName: "bnb-agent-probe-staging", measuredVersionId: DEPLOYMENT_VERSION,
      drainVersionIds: [DRAIN_VERSION] },
    response: {
      measured: { id: DEPLOYMENT_VERSION, annotations: {
        "workers/message": "git_commit=0123456789abcdef0123456789abcdef01234567",
        "workers/tag": "git-0123456789ab",
      }, resources: { script: { etag: "a".repeat(64) } } },
      drainVersions: [{ id: DRAIN_VERSION, annotations: {
        "workers/message": "git_commit=0123456789abcdef0123456789abcdef01234567",
        "workers/tag": "git-0123456789ab-drain",
      }, resources: { script: { etag: "a".repeat(64) } } }],
    },
  },
  "evidence/raw/preflight.json": {
    ...controlFixture("preflight", "2026-08-28T21:50:00.000Z"),
  },
  "evidence/raw/activation.json": {
    ...controlFixture("activation", "2026-08-28T21:52:00.000Z"),
  },
  "evidence/raw/window-start.json": {
    request: {
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      capturedAt: "2026-08-28T23:59:30.000Z",
      completedAt: "2026-08-28T23:59:30.000Z",
      databaseId: D1_ID,
      params: ["last_queue_scheduled_time", "next_scheduler_phase"],
      sql: "SELECT key, textValue AS value, integerValue FROM runtime_state WHERE key IN (?, ?) ORDER BY key ASC",
      startedAt: "2026-08-28T23:59:29.000Z",
    },
    response: { success: true, errors: [], result: [{ results: [
      { key: "last_queue_scheduled_time", value: null, integerValue: WINDOW_START - 5 * 60_000 + 14_000 },
      { key: "next_scheduler_phase", value: "header", integerValue: null },
    ] }] },
  },
  "evidence/raw/cleanup.json": {
    ...controlFixture("cleanup", "2026-08-30T00:15:00.000Z"),
  },
  "evidence/raw/drain.json": {
    ...controlFixture("drain", "2026-08-29T23:56:30.000Z"),
  },
} as const;
const RAW_FILES = Object.fromEntries(
  Object.entries(RAW_PAYLOADS).map(([path, payload]) => [path, JSON.stringify(payload)]),
) as Record<string, string>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validArtifact(): Record<string, unknown> {
  const ledger = structuredClone(FIXTURE_LEDGER);
  return {
    schemaVersion: 1,
    commit: "0123456789abcdef0123456789abcdef01234567",
    deploymentVersion: DEPLOYMENT_VERSION,
    worker: { name: "bnb-agent-probe-staging" },
    cloudflare: { accountId: "bc8d4adf4860284fda426b24e7377bc2" },
    queue: { id: "721ba809967d425a91dbc34eb1ac3baa" },
    d1: { id: D1_ID },
    window: {
      start: "2026-08-29T00:00:00.000Z",
      end: "2026-08-30T00:00:00.000Z",
    },
    limits: {
      expectedTicks: 288,
      expectedPerPhase: 96,
      d1QueriesPerAttempt: 40,
      d1RowsRead: 4_000_000,
      d1RowsWritten: 80_000,
      consumerCpuMs: 30_000,
      memoryBytesP999: 100_663_296,
    },
    ledger,
    quotaLedger: ledger.map((entry) => ({ ...entry })),
    totals: {
      ticks: 288,
      headerCompleted: 96,
      sweepCompleted: 96,
      probeCompleted: 96,
      retries: 0,
      d1RowsRead: 250_000,
      d1RowsWritten: 25_000,
      quotaErrors: 0,
      http429: 0,
      exceededCpu: 0,
      memoryExceeded: 0,
      maxD1QueriesPerAttempt: 13,
      maxConsumerCpuMs: 200,
      maxProducerCpuMs: 1.14,
      wallTimeP95Ms: 1_000,
      memoryUsageBytesP999: 12_000_000,
      queueOperations: 964,
      quotaAttempts: 288,
      spillIn: 0,
      spillOut: 0,
    },
    rawAnalytics: Object.fromEntries(
      Object.entries(RAW_FILES).map(([name, contents]) => [name, {
        path: name,
        sha256: sha256(contents),
      }]),
    ),
    accountUsage: { attributable: true, unrelatedRowsRead: 50_000, unrelatedRowsWritten: 5_000,
      unrelatedQueueOperations: 100 },
    cleanup: {
      preflightSchedules: [],
      preflightBacklogCount: 0,
      installedSchedules: ["*/5 * * * *"],
      drainSchedules: [],
      drainBacklogCount: 0,
      drainKillSwitch: false,
      drainProducerKillSwitch: true,
      finalSchedules: [],
      finalBacklogCount: 0,
      killSwitch: true,
      producerKillSwitch: true,
      stagingManualRun: false,
      sharedSecretPresent: false,
    },
    verdicts: {
      attribution: "pass",
      cleanup: "pass",
      d1Daily: "pass",
      d1PerAttempt: "pass",
      phaseRotation: "pass",
      queueTerminality: "pass",
      tickCompleteness: "pass",
      workerResources: "pass",
    },
  };
}

const readRawEvidence = async (path: string): Promise<string> => {
  const contents = RAW_FILES[path];
  if (contents === undefined) throw new Error(`missing fixture ${path}`);
  return contents;
};

function evidenceReaderFor(
  artifact: any,
  overrides: Record<string, string> = {},
): (path: string) => Promise<string> {
  const byKey = new Map<string, any>();
  for (const entry of [...artifact.ledger, ...artifact.quotaLedger]) {
    byKey.set(`${entry.messageId}:${entry.attempt}`, entry);
  }
  const rows = [...byKey.values()].sort((left, right) =>
    left.scheduledTime - right.scheduledTime
      || left.messageId.localeCompare(right.messageId)
      || left.attempt - right.attempt);
  const raw = structuredClone(RAW_PAYLOADS["evidence/raw/scheduler-attempts.json"]) as any;
  raw.response.result[0].results = rows;
  const contents = JSON.stringify(raw);
  artifact.rawAnalytics["evidence/raw/scheduler-attempts.json"].sha256 = sha256(contents);
  return async (path) => {
    if (path === "evidence/raw/scheduler-attempts.json") return contents;
    return overrides[path] ?? readRawEvidence(path);
  };
}

describe("WP2 24-hour evidence artifact validator", () => {
  it("resolves repository evidence above the package working directory", () => {
    expect(resolveRawEvidencePath("evidence/raw/d1-database.json"))
      .toBe(new URL("../../evidence/raw/d1-database.json", import.meta.url).pathname);
  });

  it("builds the complete artifact from the required literal raw captures", async () => {
    const artifact = await buildWp224hArtifact({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      databaseId: D1_ID,
      queueId: "721ba809967d425a91dbc34eb1ac3baa",
      windowStart: "2026-08-29T00:00:00.000Z",
      workerName: "bnb-agent-probe-staging",
    }, { readRawEvidence });

    expect(artifact).toEqual(validArtifact());
    await expect(validateWp224hArtifact(artifact, { readRawEvidence })).resolves.toMatchObject({
      passed: true,
      ticks: 288,
    });
  });

  it("queries Workers through the post-midnight terminality cutoff", () => {
    expect(WP2_WORKERS_ANALYTICS_QUERY).toContain("$terminalityEndInclusive: Time!");
    expect(WP2_WORKERS_ANALYTICS_QUERY).toContain("datetime_leq: $terminalityEndInclusive");
  });
  it("accepts one exact UTC day with 288 aligned ticks and 96 completed phases each", async () => {
    await expect(validateWp224hArtifact(validArtifact(), { readRawEvidence })).resolves.toMatchObject({
      passed: true,
      ticks: 288,
      phaseCompletions: { header: 96, sweep: 96, probe: 96 },
    });
  });

  it("rejects a ledger row that differs from the raw D1 cohort", async () => {
    const artifact = validArtifact() as any;
    artifact.ledger[0].d1Queries = 12;
    artifact.quotaLedger[0].d1Queries = 12;
    await expect(validateWp224hArtifact(artifact, { readRawEvidence })).rejects.toThrow("RAW_LEDGER");
  });

  it("rejects a scheduler ledger captured before terminality grace", async () => {
    const artifact = validArtifact() as any;
    const ledger = structuredClone(RAW_PAYLOADS["evidence/raw/scheduler-attempts.json"]) as any;
    ledger.request.startedAt = "2026-08-30T00:14:59.999Z";
    const contents = JSON.stringify(ledger);
    artifact.rawAnalytics["evidence/raw/scheduler-attempts.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/scheduler-attempts.json"
        ? contents : readRawEvidence(path),
    })).rejects.toThrow("RAW_LEDGER");
  });

  it("rejects an incomplete persisted gate verdict set", async () => {
    const artifact = validArtifact() as any;
    delete artifact.verdicts.queueTerminality;
    await expect(validateWp224hArtifact(artifact, { readRawEvidence }))
      .rejects.toThrow("VERDICTS");
  });

  it("rejects analytics captured with a different GraphQL query", async () => {
    const artifact = validArtifact() as any;
    const workers = structuredClone(RAW_PAYLOADS["evidence/raw/workers.json"]) as any;
    workers.request.query += "\n# changed";
    const contents = JSON.stringify(workers);
    artifact.rawAnalytics["evidence/raw/workers.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/workers.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("RAW_WORKERS");
  });

  it("rejects a self-asserted cleanup without literal control-plane responses", async () => {
    const artifact = validArtifact() as any;
    const contents = JSON.stringify({ response: { capturedAt: "2026-08-30T00:15:00.000Z",
      schedules: [], backlogCount: 0, killSwitch: true, producerKillSwitch: true,
      stagingManualRun: false, sharedSecretPresent: false } });
    artifact.rawAnalytics["evidence/raw/cleanup.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/cleanup.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("RAW_CLEANUP");
  });

  it.each([
    ["non-midnight start", (artifact: any) => { artifact.window.start = "2026-08-29T00:00:01.000Z"; }, "WINDOW_UTC"],
    ["partial day", (artifact: any) => { artifact.window.end = "2026-08-29T23:59:59.999Z"; }, "WINDOW_DURATION"],
    ["missing tick", (artifact: any) => { artifact.ledger.pop(); }, "TICK_COUNT"],
    ["unaligned tick", (artifact: any) => { artifact.ledger[7].scheduledTime += 1; }, "TICK_ALIGNMENT"],
    ["negative attempt duration", (artifact: any) => { artifact.ledger[0].finishedAt = artifact.ledger[0].startedAt - 1; }, "LEDGER"],
    ["wrong phase distribution", (artifact: any) => { artifact.ledger[0].phase = "sweep"; }, "PHASE_SEQUENCE"],
    ["D1 query overflow", (artifact: any) => { artifact.ledger[0].d1Queries = 41; }, "D1_QUERY_LIMIT"],
    ["D1 read ceiling", (artifact: any) => { artifact.totals.d1RowsRead = 4_000_000; }, "D1_READ_LIMIT"],
    ["D1 write ceiling", (artifact: any) => { artifact.totals.d1RowsWritten = 80_000; }, "D1_WRITE_LIMIT"],
    ["missing raw analytics", (artifact: any) => { delete artifact.rawAnalytics["evidence/raw/d1-account.json"]; }, "RAW_ANALYTICS"],
    ["bad raw hash", (artifact: any) => { artifact.rawAnalytics["evidence/raw/queue.json"].sha256 = "0".repeat(64); }, "RAW_HASH"],
    ["fabricated D1 totals", (artifact: any) => { artifact.totals.d1RowsRead -= 1; }, "RAW_D1"],
    ["wrong deployment", (artifact: any) => { artifact.deploymentVersion = "00000000-0000-4000-8000-000000000003"; }, "RAW_DEPLOYMENT"],
    ["wrong Queue operations", (artifact: any) => { artifact.totals.queueOperations = 963; }, "RAW_QUEUE"],
    ["incomplete cleanup", (artifact: any) => { artifact.cleanup.finalSchedules = ["*/5 * * * *"]; }, "CLEANUP"],
  ])("rejects %s", async (_label, mutate, errorCode) => {
    const artifact = validArtifact();
    mutate(artifact);

    await expect(validateWp224hArtifact(artifact, { readRawEvidence })).rejects.toThrow(errorCode);
  });

  it("rejects malformed raw JSON even when its SHA-256 matches", async () => {
    const artifact = validArtifact() as any;
    artifact.rawAnalytics["evidence/raw/workers.json"].sha256 = sha256("workers");
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/workers.json" ? "workers" : readRawEvidence(path),
    })).rejects.toThrow("RAW_JSON");
  });

  it("rejects deployment evidence without a Cloudflare commit annotation", async () => {
    const artifact = validArtifact() as any;
    const deployment = structuredClone(RAW_PAYLOADS["evidence/raw/deployment.json"]) as any;
    deployment.response.measured.annotations["workers/message"] = "manual upload";
    const contents = JSON.stringify(deployment);
    artifact.rawAnalytics["evidence/raw/deployment.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/deployment.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("RAW_DEPLOYMENT");
  });

  it("rejects a drain version from another commit or bundle", async () => {
    for (const mutate of [
      (deployment: any) => { deployment.response.drainVersions[0].annotations["workers/message"] = "git_commit=bad"; },
      (deployment: any) => { deployment.response.drainVersions[0].resources.script.etag = "b".repeat(64); },
    ]) {
      const artifact = validArtifact() as any;
      const deployment = structuredClone(RAW_PAYLOADS["evidence/raw/deployment.json"]) as any;
      mutate(deployment);
      const contents = JSON.stringify(deployment);
      artifact.rawAnalytics["evidence/raw/deployment.json"].sha256 = sha256(contents);
      await expect(validateWp224hArtifact(artifact, {
        readRawEvidence: async (path) => path === "evidence/raw/deployment.json" ? contents : readRawEvidence(path),
      })).rejects.toThrow("RAW_DEPLOYMENT");
    }
  });

  it("accepts an explained retry that spills into the quota day", async () => {
    const artifact = validArtifact() as any;
    artifact.quotaLedger.unshift({
      ...artifact.ledger[0],
      messageId: "spill-in-message",
      scheduledTime: WINDOW_START - 5 * 60_000 + 14_000,
      attempt: 2,
      startedAt: WINDOW_START + 1_000,
      finishedAt: WINDOW_START + 2_000,
      outcome: "completed",
      phase: "header",
      errorCode: null,
    });
    artifact.totals.quotaAttempts = 289;
    artifact.totals.spillIn = 1;
    artifact.totals.queueOperations = 965;
    const queue = structuredClone(RAW_PAYLOADS["evidence/raw/queue.json"]) as any;
    queue.response.data.viewer.accounts[0].queueDayOperations[2].count = 289;
    queue.response.data.viewer.accounts[0].queueDayOperations[2].sum.billableOperations = 289;
    queue.response.data.viewer.accounts[0].queueTerminalOperations[2].count = 289;
    queue.response.data.viewer.accounts[0].queueTerminalOperations[2].sum.billableOperations = 289;
    const account = structuredClone(RAW_PAYLOADS["evidence/raw/queue-account.json"]) as any;
    account.response.data.viewer.accounts[0].queueMessageOperationsAdaptiveGroups[0].sum.billableOperations = 865;
    const overrides: Record<string, string> = {
      "evidence/raw/queue.json": JSON.stringify(queue),
      "evidence/raw/queue-account.json": JSON.stringify(account),
    };
    for (const [path, contents] of Object.entries(overrides)) artifact.rawAnalytics[path].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: evidenceReaderFor(artifact, overrides),
    })).resolves.toMatchObject({ passed: true });
  });

  it("rejects a second Queue message for the same scheduled tick", async () => {
    const artifact = validArtifact() as any;
    artifact.ledger.push({ ...artifact.ledger[0], messageId: "double-enqueue", outcome: "failed",
      phase: null, errorCode: "UPSTREAM_TIMEOUT" });
    artifact.quotaLedger.push({ ...artifact.ledger.at(-1) });
    artifact.totals.retries = 1;
    artifact.totals.quotaAttempts = 289;
    await expect(validateWp224hArtifact(artifact, { readRawEvidence })).rejects.toThrow("MESSAGE_ID");
  });

  it("rejects phase counts that do not follow header, sweep, probe on every tick", async () => {
    const artifact = validArtifact() as any;
    [artifact.ledger[0].phase, artifact.ledger[1].phase] = [artifact.ledger[1].phase, artifact.ledger[0].phase];
    [artifact.quotaLedger[0].phase, artifact.quotaLedger[1].phase] =
      [artifact.quotaLedger[1].phase, artifact.quotaLedger[0].phase];
    await expect(validateWp224hArtifact(artifact, { readRawEvidence })).rejects.toThrow("PHASE_SEQUENCE");
  });

  it("accepts a full cyclic rotation that starts with sweep", async () => {
    const artifact = validArtifact() as any;
    for (const cohort of [artifact.ledger, artifact.quotaLedger]) {
      cohort.forEach((entry: any, index: number) => {
        entry.phase = (["sweep", "probe", "header"] as const)[index % 3];
      });
    }
    const windowStart = structuredClone(RAW_PAYLOADS["evidence/raw/window-start.json"]) as any;
    windowStart.response.result[0].results[1].value = "sweep";
    const contents = JSON.stringify(windowStart);
    artifact.rawAnalytics["evidence/raw/window-start.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: evidenceReaderFor(artifact, { "evidence/raw/window-start.json": contents }),
    })).resolves.toMatchObject({ passed: true, rotationStart: "sweep" });
  });

  it("rejects a cyclic rotation that differs from the persisted window-start phase", async () => {
    const artifact = validArtifact() as any;
    for (const cohort of [artifact.ledger, artifact.quotaLedger]) {
      cohort.forEach((entry: any, index: number) => {
        entry.phase = (["sweep", "probe", "header"] as const)[index % 3];
      });
    }
    await expect(validateWp224hArtifact(artifact, { readRawEvidence: evidenceReaderFor(artifact) }))
      .rejects.toThrow("PHASE_SEQUENCE");
  });

  it("rejects window-start evidence from another D1, with errors, stale timing or an incomplete final tick", async () => {
    for (const mutate of [
      (raw: any) => { raw.request.databaseId = "00000000-0000-4000-8000-000000000002"; },
      (raw: any) => { raw.response.errors = [{ message: "contradictory" }]; },
      (raw: any) => { raw.request.startedAt = "2026-08-28T23:55:13.999Z"; },
      (raw: any) => {
        raw.request.completedAt = "2026-08-29T00:00:14.000Z";
        raw.request.capturedAt = raw.request.completedAt;
      },
      (raw: any) => { raw.response.result[0].results[0].integerValue -= 5 * 60_000; },
    ]) {
      const artifact = validArtifact() as any;
      const raw = structuredClone(RAW_PAYLOADS["evidence/raw/window-start.json"]) as any;
      mutate(raw);
      const contents = JSON.stringify(raw);
      artifact.rawAnalytics["evidence/raw/window-start.json"].sha256 = sha256(contents);
      await expect(validateWp224hArtifact(artifact, {
        readRawEvidence: async (path) => path === "evidence/raw/window-start.json" ? contents : readRawEvidence(path),
      })).rejects.toThrow("RAW_WINDOW_START");
    }
  });

  it("accepts a final Queue delete during the post-midnight grace", async () => {
    const artifact = validArtifact() as any;
    const queue = structuredClone(RAW_PAYLOADS["evidence/raw/queue.json"]) as any;
    queue.response.data.viewer.accounts[0].queueTerminalOperations[2].dimensions.datetime =
      "2026-08-30T00:00:03Z";
    const contents = JSON.stringify(queue);
    artifact.rawAnalytics["evidence/raw/queue.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/queue.json" ? contents : readRawEvidence(path),
    })).resolves.toMatchObject({ passed: true });
  });

  it("rejects a quota attempt omitted from the tick cohort", async () => {
    const artifact = validArtifact() as any;
    artifact.quotaLedger.push({ ...artifact.ledger[0], messageId: "omitted-from-ledger" });
    artifact.totals.quotaAttempts = 289;
    await expect(validateWp224hArtifact(artifact, { readRawEvidence })).rejects.toThrow("QUOTA_COHORT");
  });

  it("rejects cleanup evidence captured before the terminality grace", async () => {
    const artifact = validArtifact() as any;
    const cleanup = structuredClone(RAW_PAYLOADS["evidence/raw/cleanup.json"]) as any;
    cleanup.request.startedAt = "2026-08-30T00:14:59.499Z";
    cleanup.request.completedAt = "2026-08-30T00:14:59.999Z";
    const contents = JSON.stringify(cleanup);
    artifact.rawAnalytics["evidence/raw/cleanup.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/cleanup.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("CLEANUP_GRACE");
  });

  it("rejects activation evidence captured after the first scheduled tick", async () => {
    const artifact = validArtifact() as any;
    const activation = structuredClone(RAW_PAYLOADS["evidence/raw/activation.json"]) as any;
    activation.request.startedAt = "2026-08-29T00:00:14.001Z";
    activation.request.completedAt = "2026-08-29T00:00:14.501Z";
    const contents = JSON.stringify(activation);
    artifact.rawAnalytics["evidence/raw/activation.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/activation.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("CLEANUP");
  });

  it("rejects cleanup without a producer shutdown barrier", async () => {
    const artifact = validArtifact() as any;
    const cleanup = structuredClone(RAW_PAYLOADS["evidence/raw/cleanup.json"]) as any;
    cleanup.response.health.producerKillSwitch = false;
    const contents = JSON.stringify(cleanup);
    artifact.rawAnalytics["evidence/raw/cleanup.json"].sha256 = sha256(contents);
    artifact.cleanup.producerKillSwitch = false;
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/cleanup.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("CLEANUP");
  });

  it("rejects a drain snapshot without the producer-only barrier", async () => {
    const artifact = validArtifact() as any;
    const drain = structuredClone(RAW_PAYLOADS["evidence/raw/drain.json"]) as any;
    drain.response.settings.result.bindings
      .find((binding: any) => binding.name === "PRODUCER_KILL_SWITCH").text = "0";
    const contents = JSON.stringify(drain);
    artifact.rawAnalytics["evidence/raw/drain.json"].sha256 = sha256(contents);
    artifact.cleanup.drainProducerKillSwitch = false;
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/drain.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("RAW_CLEANUP");
  });

  it("rejects cleanup with a deployed manual-run binding", async () => {
    const artifact = validArtifact() as any;
    const cleanup = structuredClone(RAW_PAYLOADS["evidence/raw/cleanup.json"]) as any;
    cleanup.response.settings.result.bindings
      .find((binding: any) => binding.name === "STAGING_MANUAL_RUN").text = "1";
    const contents = JSON.stringify(cleanup);
    artifact.rawAnalytics["evidence/raw/cleanup.json"].sha256 = sha256(contents);
    artifact.cleanup.stagingManualRun = true;
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/cleanup.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("RAW_CLEANUP");
  });

  it("rejects a deployed D1 query budget above the reserved Free profile", async () => {
    const artifact = validArtifact() as any;
    const activation = structuredClone(RAW_PAYLOADS["evidence/raw/activation.json"]) as any;
    activation.response.settings.result.bindings
      .find((binding: any) => binding.name === "D1_QUERIES_PER_RUN").text = "50";
    activation.response.health.budgets.d1QueriesPerRun = 50;
    const contents = JSON.stringify(activation);
    artifact.rawAnalytics["evidence/raw/activation.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/activation.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("RAW_CLEANUP");
  });

  it("rejects non-zero Queue backlog at the terminality cutoff", async () => {
    const artifact = validArtifact() as any;
    const queue = structuredClone(RAW_PAYLOADS["evidence/raw/queue.json"]) as any;
    queue.response.data.viewer.accounts[0].queueBacklogAdaptiveGroups[0].avg.messages = 1;
    const contents = JSON.stringify(queue);
    artifact.rawAnalytics["evidence/raw/queue.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/queue.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("QUEUE_TERMINALITY");
  });

  it("rejects producer CPU and wall-time gate violations", async () => {
    for (const mutate of [
      (artifact: any) => { artifact.totals.maxProducerCpuMs = 10; },
      (artifact: any) => { artifact.totals.wallTimeP95Ms = 30_000; },
    ]) {
      const artifact = validArtifact();
      mutate(artifact);
      await expect(validateWp224hArtifact(artifact, { readRawEvidence })).rejects.toThrow();
    }
  });

  it("rejects producer CPU derived from Workers Analytics at the Free ceiling", async () => {
    const artifact = validArtifact() as any;
    const workers = structuredClone(RAW_PAYLOADS["evidence/raw/workers.json"]) as any;
    workers.response.data.viewer.accounts[0].workersInvocationsAdaptive[0].quantiles.cpuTimeP99 = 10_000;
    const contents = JSON.stringify(workers);
    artifact.rawAnalytics["evidence/raw/workers.json"].sha256 = sha256(contents);
    artifact.totals.maxProducerCpuMs = 10;
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/workers.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("CPU_LIMIT");
  });

  it("rejects ambiguous Workers samples instead of swapping producer and consumer CPU", async () => {
    const artifact = validArtifact() as any;
    const workers = structuredClone(RAW_PAYLOADS["evidence/raw/workers.json"]) as any;
    const [producer, consumer] = workers.response.data.viewer.accounts[0].workersInvocationsAdaptive;
    producer.quantiles.cpuTimeP99 = 1_000;
    producer.sum.subrequests = 288;
    consumer.dimensions.datetime = "2026-08-29T00:00:15Z";
    consumer.quantiles.cpuTimeP99 = 20_000;
    consumer.sum.subrequests = 0;
    const contents = JSON.stringify(workers);
    artifact.rawAnalytics["evidence/raw/workers.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/workers.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("RAW_WORKERS");
  });

  it("includes a post-midnight authenticated drain consumer in resource metrics", async () => {
    const artifact = validArtifact() as any;
    const spillOut = artifact.ledger.at(-1);
    spillOut.startedAt = Date.parse("2026-08-30T00:05:00.000Z");
    spillOut.finishedAt = spillOut.startedAt + 1_000;
    artifact.quotaLedger.pop();
    artifact.totals.quotaAttempts = 287;
    artifact.totals.spillOut = 1;
    const workers = structuredClone(RAW_PAYLOADS["evidence/raw/workers.json"]) as any;
    const drainConsumer = structuredClone(workers.response.data.viewer.accounts[0].workersInvocationsAdaptive[1]);
    drainConsumer.dimensions.datetime = "2026-08-30T00:05:00Z";
    drainConsumer.dimensions.scriptVersion = DRAIN_VERSION;
    drainConsumer.quantiles.cpuTimeP99 = 300_000;
    drainConsumer.quantiles.memoryUsageBytesP999 = 13_000_000;
    drainConsumer.sum.requests = 1;
    drainConsumer.sum.subrequests = 1;
    workers.response.data.viewer.accounts[0].workersInvocationsAdaptive.push(drainConsumer);
    const workerContents = JSON.stringify(workers);
    artifact.rawAnalytics["evidence/raw/workers.json"].sha256 = sha256(workerContents);
    const queue = structuredClone(RAW_PAYLOADS["evidence/raw/queue.json"]) as any;
    const deletes = queue.response.data.viewer.accounts[0].queueTerminalOperations;
    deletes[2].count = 287;
    const spillOutDelete = structuredClone(deletes[2]);
    spillOutDelete.count = 1;
    spillOutDelete.dimensions.datetime = "2026-08-30T00:05:02Z";
    deletes.push(spillOutDelete);
    const queueContents = JSON.stringify(queue);
    artifact.rawAnalytics["evidence/raw/queue.json"].sha256 = sha256(queueContents);
    artifact.totals.maxConsumerCpuMs = 300;
    artifact.totals.memoryUsageBytesP999 = 13_000_000;
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: evidenceReaderFor(artifact, {
        "evidence/raw/workers.json": workerContents,
        "evidence/raw/queue.json": queueContents,
      }),
    })).resolves.toMatchObject({ passed: true });
  });

  it("rejects a spill-out attempt without a correlated Worker sample", async () => {
    const artifact = validArtifact() as any;
    const spillOut = artifact.ledger.at(-1);
    spillOut.startedAt = Date.parse("2026-08-30T00:05:00.000Z");
    spillOut.finishedAt = spillOut.startedAt + 1_000;
    artifact.quotaLedger.pop();
    artifact.totals.quotaAttempts = 287;
    artifact.totals.spillOut = 1;
    await expect(validateWp224hArtifact(artifact, { readRawEvidence: evidenceReaderFor(artifact) }))
      .rejects.toThrow("RAW_WORKERS");
  });

  it("does not reuse one Worker request for multiple spill-out attempts", async () => {
    const artifact = validArtifact() as any;
    for (const entry of artifact.ledger.slice(-2)) {
      entry.startedAt = Date.parse("2026-08-30T00:05:00.000Z");
      entry.finishedAt = entry.startedAt + 1_000;
    }
    artifact.quotaLedger.splice(-2);
    artifact.totals.quotaAttempts = 286;
    artifact.totals.spillOut = 2;
    const workers = structuredClone(RAW_PAYLOADS["evidence/raw/workers.json"]) as any;
    const drainConsumer = structuredClone(workers.response.data.viewer.accounts[0].workersInvocationsAdaptive[1]);
    drainConsumer.dimensions.datetime = "2026-08-30T00:05:00Z";
    drainConsumer.dimensions.scriptVersion = DRAIN_VERSION;
    drainConsumer.sum.requests = 1;
    workers.response.data.viewer.accounts[0].workersInvocationsAdaptive.push(drainConsumer);
    const contents = JSON.stringify(workers);
    artifact.rawAnalytics["evidence/raw/workers.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: evidenceReaderFor(artifact, { "evidence/raw/workers.json": contents }),
    })).rejects.toThrow("RAW_WORKERS");
  });

  it("accepts one causal delete for a retried spill-out message", async () => {
    const artifact = validArtifact() as any;
    const terminalAttempt = artifact.ledger.at(-1);
    terminalAttempt.startedAt = Date.parse("2026-08-30T00:05:02.000Z");
    terminalAttempt.finishedAt = terminalAttempt.startedAt + 1_000;
    terminalAttempt.attempt = 2;
    const failedAttempt = {
      ...terminalAttempt,
      attempt: 1,
      outcome: "failed",
      startedAt: Date.parse("2026-08-30T00:05:00.000Z"),
      finishedAt: Date.parse("2026-08-30T00:05:01.000Z"),
      errorCode: "UPSTREAM_TIMEOUT",
    };
    artifact.ledger.splice(-1, 0, failedAttempt);
    artifact.quotaLedger.pop();
    artifact.totals.retries = 1;
    artifact.totals.quotaAttempts = 287;
    artifact.totals.spillOut = 2;
    const workers = structuredClone(RAW_PAYLOADS["evidence/raw/workers.json"]) as any;
    const template = workers.response.data.viewer.accounts[0].workersInvocationsAdaptive[1];
    for (const datetime of ["2026-08-30T00:05:00Z", "2026-08-30T00:05:02Z"]) {
      const drainConsumer = structuredClone(template);
      drainConsumer.dimensions.datetime = datetime;
      drainConsumer.dimensions.scriptVersion = DRAIN_VERSION;
      drainConsumer.sum.requests = 1;
      workers.response.data.viewer.accounts[0].workersInvocationsAdaptive.push(drainConsumer);
    }
    const workerContents = JSON.stringify(workers);
    artifact.rawAnalytics["evidence/raw/workers.json"].sha256 = sha256(workerContents);
    const queue = structuredClone(RAW_PAYLOADS["evidence/raw/queue.json"]) as any;
    const deletes = queue.response.data.viewer.accounts[0].queueTerminalOperations;
    deletes[2].count = 287;
    const spillOutDelete = structuredClone(deletes[2]);
    spillOutDelete.count = 1;
    spillOutDelete.dimensions.datetime = "2026-08-30T00:05:04Z";
    deletes.push(spillOutDelete);
    const queueContents = JSON.stringify(queue);
    artifact.rawAnalytics["evidence/raw/queue.json"].sha256 = sha256(queueContents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: evidenceReaderFor(artifact, {
        "evidence/raw/workers.json": workerContents,
        "evidence/raw/queue.json": queueContents,
      }),
    })).resolves.toMatchObject({ passed: true });
  });

  it("rejects a pre-midnight completion without a causal post-midnight delete", async () => {
    const artifact = validArtifact() as any;
    const crossingAttempt = artifact.ledger.at(-1);
    crossingAttempt.startedAt = Date.parse("2026-08-29T23:59:59.500Z");
    crossingAttempt.finishedAt = Date.parse("2026-08-30T00:00:00.500Z");
    artifact.quotaLedger.at(-1).startedAt = crossingAttempt.startedAt;
    artifact.quotaLedger.at(-1).finishedAt = crossingAttempt.finishedAt;
    await expect(validateWp224hArtifact(artifact, { readRawEvidence: evidenceReaderFor(artifact) }))
      .rejects.toThrow("QUEUE_TERMINALITY");
  });

  it("rejects Workers evidence that ends before terminality grace", async () => {
    const artifact = validArtifact() as any;
    const workers = structuredClone(RAW_PAYLOADS["evidence/raw/workers.json"]) as any;
    workers.request.terminalityEndInclusive = "2026-08-29T23:59:59.999Z";
    const contents = JSON.stringify(workers);
    artifact.rawAnalytics["evidence/raw/workers.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/workers.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("RAW_WORKERS");
  });

  it("counts a blocked drain-version producer without inventing a Queue write", async () => {
    const artifact = validArtifact() as any;
    const workers = structuredClone(RAW_PAYLOADS["evidence/raw/workers.json"]) as any;
    const blockedProducer = structuredClone(workers.response.data.viewer.accounts[0].workersInvocationsAdaptive[0]);
    blockedProducer.dimensions.datetime = "2026-08-29T23:56:00Z";
    blockedProducer.dimensions.scriptVersion = DRAIN_VERSION;
    blockedProducer.quantiles.cpuTimeP99 = 9_000;
    blockedProducer.sum.requests = 1;
    workers.response.data.viewer.accounts[0].workersInvocationsAdaptive.push(blockedProducer);
    const contents = JSON.stringify(workers);
    artifact.rawAnalytics["evidence/raw/workers.json"].sha256 = sha256(contents);
    artifact.totals.maxProducerCpuMs = 9;
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/workers.json" ? contents : readRawEvidence(path),
    })).resolves.toMatchObject({ passed: true });
  });

  it("rejects Workers samples from an unauthenticated version", async () => {
    const artifact = validArtifact() as any;
    const workers = structuredClone(RAW_PAYLOADS["evidence/raw/workers.json"]) as any;
    workers.response.data.viewer.accounts[0].workersInvocationsAdaptive[1].dimensions.scriptVersion =
      "00000000-0000-4000-8000-000000000098";
    const contents = JSON.stringify(workers);
    artifact.rawAnalytics["evidence/raw/workers.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/workers.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("RAW_DEPLOYMENT");
  });

  it("rejects cleanup captured before the final tick attempt finishes", async () => {
    const artifact = validArtifact() as any;
    const last = artifact.ledger.at(-1);
    last.startedAt = Date.parse("2026-08-30T00:14:58.000Z");
    last.finishedAt = Date.parse("2026-08-30T00:15:00.500Z");
    artifact.quotaLedger.pop();
    artifact.totals.quotaAttempts = 287;
    artifact.totals.spillOut = 1;
    const workers = structuredClone(RAW_PAYLOADS["evidence/raw/workers.json"]) as any;
    const drainConsumer = structuredClone(workers.response.data.viewer.accounts[0].workersInvocationsAdaptive[1]);
    drainConsumer.dimensions.datetime = "2026-08-30T00:14:58Z";
    drainConsumer.dimensions.scriptVersion = DRAIN_VERSION;
    drainConsumer.sum.requests = 1;
    workers.response.data.viewer.accounts[0].workersInvocationsAdaptive.push(drainConsumer);
    const contents = JSON.stringify(workers);
    artifact.rawAnalytics["evidence/raw/workers.json"].sha256 = sha256(contents);
    const queue = structuredClone(RAW_PAYLOADS["evidence/raw/queue.json"]) as any;
    const deletes = queue.response.data.viewer.accounts[0].queueTerminalOperations;
    deletes[2].count = 287;
    const spillOutDelete = structuredClone(deletes[2]);
    spillOutDelete.count = 1;
    spillOutDelete.dimensions.datetime = "2026-08-30T00:15:00Z";
    deletes.push(spillOutDelete);
    const queueContents = JSON.stringify(queue);
    artifact.rawAnalytics["evidence/raw/queue.json"].sha256 = sha256(queueContents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: evidenceReaderFor(artifact, {
        "evidence/raw/workers.json": contents,
        "evidence/raw/queue.json": queueContents,
      }),
    })).rejects.toThrow("CLEANUP_GRACE");
  });

  it("rejects quota, HTTP 429, CPU, memory and unattributable account usage", async () => {
    for (const mutate of [
      (artifact: any) => { artifact.totals.quotaErrors = 1; },
      (artifact: any) => { artifact.totals.http429 = 1; },
      (artifact: any) => { artifact.totals.exceededCpu = 1; },
      (artifact: any) => { artifact.totals.memoryExceeded = 1; },
      (artifact: any) => { artifact.accountUsage.attributable = false; },
    ]) {
      const artifact = validArtifact();
      mutate(artifact);
      await expect(validateWp224hArtifact(artifact, { readRawEvidence })).rejects.toThrow();
    }
  });
});
