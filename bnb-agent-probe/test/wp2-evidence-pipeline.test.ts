import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { captureWp2Analytics } from "../scripts/capture-wp2-analytics";
import { captureWp2Control } from "../scripts/capture-wp2-control";
import { captureWp2Deployment } from "../scripts/capture-wp2-deployment";
import { captureWp2Ledger } from "../scripts/capture-wp2-ledger";
import { captureWp2WindowStart } from "../scripts/capture-wp2-window-start";
import { buildWp224hArtifact, validateWp224hArtifact } from "../src/evidence/wp2-24h-artifact";

const ACCOUNT = "bc8d4adf4860284fda426b24e7377bc2";
const D1 = "6fbeea3e-4516-4c4e-a5c4-392cb067198a";
const QUEUE = "721ba809967d425a91dbc34eb1ac3baa";
const SCRIPT = "bnb-agent-probe-staging";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const MEASURED = "00000000-0000-4000-8000-000000000001";
const DRAIN = "00000000-0000-4000-8000-000000000002";
const CLEANUP = "00000000-0000-4000-8000-000000000003";
const ETAG = "a".repeat(64);
const START = Date.parse("2026-08-29T00:00:00.000Z");
const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { force: true, recursive: true }))));

it("runs literal producers through the WP2 builder and validator", async () => {
  const root = await mkdtemp(join(tmpdir(), "wp2-pipeline-"));
  roots.push(root);
  const raw = join(root, "evidence/raw");
  const path = (name: string) => join(raw, name);
  const ledger = Array.from({ length: 288 }, (_, index) => ({
    messageId: `message-${index}`,
    scheduledTime: START + index * 300_000 + 14_000,
    attempt: 1,
    phase: (["header", "sweep", "probe"] as const)[index % 3],
    outcome: "completed",
    upstreamRequests: 1,
    d1Queries: 13,
    rowsReadObservedBeforeLedger: 500,
    rowsWrittenObservedBeforeLedger: 20,
    startedAt: START + index * 300_000 + 17_000,
    finishedAt: START + index * 300_000 + 18_000,
    errorCode: null,
  }));

  await captureWp2Ledger({
    accountId: ACCOUNT, apiToken: "token", databaseId: D1,
    outputPath: path("scheduler-attempts.json"),
    windowStart: "2026-08-29T00:00:00.000Z", windowEnd: "2026-08-30T00:00:00.000Z",
    now: sequence("2026-08-30T00:16:00.000Z", "2026-08-30T00:16:00.500Z"),
    fetch: vi.fn(async () => json({ success: true, errors: [], result: [{ results: ledger }] })),
  });

  await captureWp2WindowStart({
    accountId: ACCOUNT, apiToken: "token", databaseId: D1,
    outputPath: path("window-start.json"),
    now: sequence("2026-08-28T23:59:29.000Z", "2026-08-28T23:59:30.000Z"),
    fetch: vi.fn(async () => json({ success: true, errors: [], result: [{ results: [
      { key: "last_queue_scheduled_time", value: null, integerValue: START - 300_000 + 14_000 },
      { key: "next_scheduler_phase", value: "header", integerValue: null },
    ] }] })),
  });

  for (const [mode, completedAt, backlog] of [
    ["preflight", "2026-08-28T23:50:01.000Z", 0],
    ["activation", "2026-08-28T23:51:01.000Z", 0],
    ["drain", "2026-08-29T23:56:01.000Z", 1],
    ["cleanup", "2026-08-30T00:16:01.000Z", 0],
  ] as const) {
    await captureWp2Control({
      accountId: ACCOUNT, apiToken: "token", databaseId: D1,
      healthUrl: "https://probe.example/health", mode,
      outputPath: path(`${mode}.json`), queueId: QUEUE, scriptName: SCRIPT,
      now: sequence(new Date(Date.parse(completedAt) - 500).toISOString(), completedAt),
      readSecrets: async () => [{ name: "BSC_RPC_URL", type: "secret_text" }],
      fetch: controlFetch(mode, backlog),
    });
  }

  await captureWp2Analytics({
    accountId: ACCOUNT, apiToken: "token", databaseId: D1, date: "2026-08-29",
    outputDirectory: path("analytics"), queueId: QUEUE, scriptName: SCRIPT,
    terminalityEndInclusive: "2026-08-30T00:15:00.000Z",
    now: () => "2026-08-30T00:16:00.000Z",
    fetch: analyticsFetch(),
  });

  await captureWp2Deployment({
    commit: COMMIT, measuredVersionId: MEASURED, drainVersionIds: [DRAIN, CLEANUP],
    outputPath: path("deployment.json"), scriptName: SCRIPT,
    readVersion: async (id) => version(id, id === MEASURED ? "" : id === DRAIN ? "-drain" : "-cleanup"),
  });

  const artifact = await buildWp224hArtifact({
    accountId: ACCOUNT, databaseId: D1, queueId: QUEUE,
    windowStart: "2026-08-29T00:00:00.000Z", workerName: SCRIPT,
  }, { readRawEvidence: reader(root) });
  await expect(validateWp224hArtifact(artifact, { readRawEvidence: reader(root) })).resolves.toMatchObject({
    passed: true, ticks: 288, attempts: 288,
    phaseCompletions: { header: 96, sweep: 96, probe: 96 },
  });
  expect((artifact.rawAnalytics as Record<string, unknown>)["evidence/raw/analytics/analytics-manifest.json"])
    .toBeDefined();
});

function sequence(...values: string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function reader(root: string): (path: string) => Promise<string> {
  return (path) => readFile(join(root, path), "utf8");
}

function version(id: string, suffix: string): unknown {
  return {
    id,
    annotations: { "workers/message": `git_commit=${COMMIT}`, "workers/tag": `git-${COMMIT.slice(0, 12)}${suffix}` },
    resources: { script: { etag: ETAG } },
  };
}

function bindings(mode: "preflight" | "activation" | "drain" | "cleanup"): unknown[] {
  const producing = mode === "activation";
  const consuming = producing || mode === "drain";
  const values: Record<string, string> = {
    DEPLOYMENT_ENV: "staging", CLOUDFLARE_WORKERS_PLAN: "free", CRON_INTERVAL_MINUTES: "5",
    HEADER_LIMIT: "25", SWEEP_LIMIT: "4", SWEEP_PAGES_PER_RUN: "1", PROBE_BATCH_SIZE: "1",
    TRUST8004_REQUESTS_PER_RUN: "4", EXTERNAL_SUBREQUESTS_PER_RUN: "12", D1_QUERIES_PER_RUN: "40",
    D1_ROWS_READ_PER_RUN: "3000", D1_ROWS_WRITTEN_PER_RUN: "60", PROBE_TIMEOUT_MS: "5000",
    MAX_CATALOG_RESPONSE_BYTES: "16777216", MAX_SELLER_RESPONSE_BYTES: "32768",
    KILL_SWITCH: consuming ? "0" : "1", PRODUCER_KILL_SWITCH: producing ? "0" : "1",
    STAGING_MANUAL_RUN: "0",
  };
  return [
    ...Object.entries(values).map(([name, text]) => ({ name, type: "plain_text", text })),
    { name: "DB", type: "d1", id: D1 },
    { name: "WP2_QUEUE", type: "queue", queue_name: SCRIPT },
  ];
}

function controlFetch(mode: "preflight" | "activation" | "drain" | "cleanup", backlog: number): typeof fetch {
  const producing = mode === "activation";
  const consuming = producing || mode === "drain";
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/schedules")) return json({ success: true, errors: [], result: { schedules: producing ? [{ cron: "*/5 * * * *" }] : [] } });
    if (url.endsWith("/settings")) return json({ success: true, errors: [], result: { bindings: bindings(mode) } });
    if (url.endsWith("/metrics")) return json({ success: true, errors: [], result: { backlog_count: backlog, backlog_bytes: backlog * 64 } });
    return json({
      status: "ok", plan: "free", schedulerMode: "single_phase",
      killSwitch: !consuming, producerKillSwitch: !producing, stagingManualRun: false,
      budgets: { cronIntervalMinutes: 5, headerLimit: 25, sweepLimit: 4, sweepPagesPerRun: 1,
        probeBatchSize: 1, trust8004RequestsPerRun: 4, externalSubrequestsPerRun: 12,
        d1QueriesPerRun: 40, d1RowsReadPerRun: 3000, d1RowsWrittenPerRun: 60,
        probeTimeoutMs: 5000, maxCatalogResponseBytes: 16777216, maxSellerResponseBytes: 32768 },
    });
  }) as typeof fetch;
}

function analyticsFetch(): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    if (call === 1) return json({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{
      dimensions: { date: "2026-08-29", databaseId: D1 },
      sum: { readQueries: 3_000, writeQueries: 1_000, rowsRead: 200_000, rowsWritten: 20_000 },
    }] }] } }, errors: null });
    if (call === 2) return json({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [
      { dimensions: { date: "2026-08-29", databaseId: D1 }, sum: { readQueries: 3_000, writeQueries: 1_000, rowsRead: 200_000, rowsWritten: 20_000 } },
      { dimensions: { date: "2026-08-29", databaseId: "00000000-0000-4000-8000-000000000099" }, sum: { readQueries: 20, writeQueries: 10, rowsRead: 50_000, rowsWritten: 5_000 } },
    ] }] } }, errors: null });
    if (call === 3) return json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [
      { dimensions: { datetime: "2026-08-29T00:00:14Z", scriptName: SCRIPT, scriptVersion: MEASURED, status: "success" }, quantiles: { cpuTimeP50: 1_000, cpuTimeP99: 1_140, durationP50: 0.03, memoryUsageBytesP50: 8_000_000, memoryUsageBytesP99: 9_000_000, memoryUsageBytesP999: 10_000_000 }, sum: { errors: 0, requests: 288, subrequests: 0 } },
      { dimensions: { datetime: "2026-08-29T00:00:18Z", scriptName: SCRIPT, scriptVersion: MEASURED, status: "success" }, quantiles: { cpuTimeP50: 100_000, cpuTimeP99: 200_000, durationP50: 0.2, memoryUsageBytesP50: 8_000_000, memoryUsageBytesP99: 11_000_000, memoryUsageBytesP999: 12_000_000 }, sum: { errors: 0, requests: 288, subrequests: 288 } },
    ] }] } }, errors: null });
    const operation = (actionType: string, datetime: string, outcome: string, operations = 288) => ({
      count: 288, dimensions: { datetime, queueId: QUEUE, actionType, consumerType: actionType === "ReadMessage" ? "worker" : "", outcome },
      avg: { lagTime: actionType === "WriteMessage" ? 0 : 1_000, retryCount: 0 }, max: { messageSize: 64 },
      sum: { billableOperations: operations, bytes: 18_432 },
    });
    if (call === 4) {
      const operations = [operation("WriteMessage", "2026-08-29T00:00:14Z", ""), operation("ReadMessage", "2026-08-29T23:55:18Z", ""), operation("DeleteMessage", "2026-08-29T23:55:18Z", "success")];
      return json({ data: { viewer: { accounts: [{ queueDayOperations: operations, queueTerminalOperations: operations,
        queueBacklogAdaptiveGroups: [{ dimensions: { datetime: "2026-08-30T00:15:00Z", queueId: QUEUE }, avg: { messages: 0, bytes: 0 } }] }] } }, errors: null });
    }
    return json({ data: { viewer: { accounts: [{ queueMessageOperationsAdaptiveGroups: [
      { dimensions: { datetime: "2026-08-29T00:00:00Z", queueId: QUEUE }, sum: { billableOperations: 864 } },
      { dimensions: { datetime: "2026-08-29T00:00:00Z", queueId: "00000000000000000000000000000099" }, sum: { billableOperations: 100 } },
    ] }] } }, errors: null });
  }) as typeof fetch;
}
