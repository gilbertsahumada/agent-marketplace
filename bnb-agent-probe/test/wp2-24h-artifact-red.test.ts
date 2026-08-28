import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { validateWp224hArtifact } from "../src/evidence/wp2-24h-artifact";

const WINDOW_START = Date.parse("2026-08-29T00:00:00.000Z");
const DEPLOYMENT_VERSION = "00000000-0000-4000-8000-000000000001";
const D1_ID = "6fbeea3e-4516-4c4e-a5c4-392cb067198a";
const RAW_PAYLOADS = {
  "evidence/raw/d1-database.json": {
    request: { date: "2026-08-29", databaseId: D1_ID },
    response: { data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{
      dimensions: { date: "2026-08-29", databaseId: D1_ID },
      sum: { readQueries: 3_000, writeQueries: 1_000, rowsRead: 200_000, rowsWritten: 20_000 },
    }] }] } }, errors: null },
  },
  "evidence/raw/d1-account.json": {
    request: { date: "2026-08-29" },
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
  "evidence/raw/workers.json": {
    request: {
      scriptName: "bnb-agent-probe-staging",
      start: "2026-08-29T00:00:00.000Z",
      endInclusive: "2026-08-29T23:59:59.999Z",
    },
    response: { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{
      dimensions: {
        datetime: "2026-08-29T00:00:14Z",
        scriptName: "bnb-agent-probe-staging",
        scriptVersion: DEPLOYMENT_VERSION,
        status: "success",
      },
      quantiles: { cpuTimeP50: 100_000, cpuTimeP99: 200_000, durationP50: 0.2,
        memoryUsageBytesP50: 8_000_000, memoryUsageBytesP99: 11_000_000,
        memoryUsageBytesP999: 12_000_000 },
      sum: { errors: 0, requests: 576, subrequests: 288 },
    }] }] } }, errors: null },
  },
  "evidence/raw/queue.json": {
    request: {
      queueId: "721ba809967d425a91dbc34eb1ac3baa",
      start: "2026-08-29T00:00:00.000Z",
      endInclusive: "2026-08-29T23:59:59.999Z",
      terminalityEndInclusive: "2026-08-30T00:15:00.000Z",
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
      start: "2026-08-29T00:00:00.000Z",
      endInclusive: "2026-08-29T23:59:59.999Z",
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
    response: { result: { scriptName: "bnb-agent-probe-staging", versionId: DEPLOYMENT_VERSION,
      commit: "0123456789abcdef0123456789abcdef01234567" } },
  },
  "evidence/raw/preflight.json": {
    response: { capturedAt: "2026-08-28T21:50:00.000Z", schedules: [], backlogCount: 0 },
  },
  "evidence/raw/activation.json": {
    response: { capturedAt: "2026-08-28T21:52:00.000Z", schedules: ["*/5 * * * *"], backlogCount: 0,
      producerCpuMsP99: 1.14 },
  },
  "evidence/raw/cleanup.json": {
    response: { capturedAt: "2026-08-30T00:15:00.000Z", schedules: [], backlogCount: 0, killSwitch: true,
      stagingManualRun: false, sharedSecretPresent: false },
  },
} as const;
const RAW_FILES = Object.fromEntries(
  Object.entries(RAW_PAYLOADS).map(([path, payload]) => [path, JSON.stringify(payload)]),
) as Record<string, string>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validArtifact(): Record<string, unknown> {
  const ledger = Array.from({ length: 288 }, (_, index) => ({
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
  return {
    schemaVersion: 1,
    commit: "0123456789abcdef0123456789abcdef01234567",
    deploymentVersion: DEPLOYMENT_VERSION,
    worker: { name: "bnb-agent-probe-staging" },
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
      finalSchedules: [],
      finalBacklogCount: 0,
      killSwitch: true,
      stagingManualRun: false,
      sharedSecretPresent: false,
    },
  };
}

const readRawEvidence = async (path: string): Promise<string> => {
  const contents = RAW_FILES[path];
  if (contents === undefined) throw new Error(`missing fixture ${path}`);
  return contents;
};

describe("WP2 24-hour evidence artifact validator", () => {
  it("accepts one exact UTC day with 288 aligned ticks and 96 completed phases each", async () => {
    await expect(validateWp224hArtifact(validArtifact(), { readRawEvidence })).resolves.toMatchObject({
      passed: true,
      ticks: 288,
      phaseCompletions: { header: 96, sweep: 96, probe: 96 },
    });
  });

  it.each([
    ["non-midnight start", (artifact: any) => { artifact.window.start = "2026-08-29T00:00:01.000Z"; }, "WINDOW_UTC"],
    ["partial day", (artifact: any) => { artifact.window.end = "2026-08-29T23:59:59.999Z"; }, "WINDOW_DURATION"],
    ["missing tick", (artifact: any) => { artifact.ledger.pop(); }, "TICK_COUNT"],
    ["unaligned tick", (artifact: any) => { artifact.ledger[7].scheduledTime += 1; }, "TICK_ALIGNMENT"],
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

  it("accepts an explained retry that spills into the quota day", async () => {
    const artifact = validArtifact() as any;
    artifact.quotaLedger.unshift({
      ...artifact.ledger[0],
      messageId: "spill-in-message",
      scheduledTime: WINDOW_START - 5 * 60_000 + 14_000,
      attempt: 4,
      startedAt: WINDOW_START + 1_000,
      finishedAt: WINDOW_START + 2_000,
      outcome: "failed",
      phase: null,
      errorCode: "UPSTREAM_TIMEOUT",
    });
    artifact.totals.quotaAttempts = 289;
    artifact.totals.spillIn = 1;
    await expect(validateWp224hArtifact(artifact, { readRawEvidence })).resolves.toMatchObject({ passed: true });
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
    await expect(validateWp224hArtifact(artifact, { readRawEvidence })).resolves.toMatchObject({ passed: true });
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
    cleanup.response.capturedAt = "2026-08-30T00:14:59.999Z";
    const contents = JSON.stringify(cleanup);
    artifact.rawAnalytics["evidence/raw/cleanup.json"].sha256 = sha256(contents);
    await expect(validateWp224hArtifact(artifact, {
      readRawEvidence: async (path) => path === "evidence/raw/cleanup.json" ? contents : readRawEvidence(path),
    })).rejects.toThrow("CLEANUP_GRACE");
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
