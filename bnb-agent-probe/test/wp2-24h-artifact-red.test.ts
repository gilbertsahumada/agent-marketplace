import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { validateWp224hArtifact } from "../src/evidence/wp2-24h-artifact";

const WINDOW_START = Date.parse("2026-08-29T00:00:00.000Z");
const RAW_FILES = {
  "evidence/raw/d1-database.json": "d1 database analytics",
  "evidence/raw/d1-account.json": "d1 account analytics",
  "evidence/raw/workers.json": "workers analytics",
  "evidence/raw/queue.json": "queue analytics",
} as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validArtifact(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    commit: "0123456789abcdef0123456789abcdef01234567",
    deploymentVersion: "00000000-0000-4000-8000-000000000001",
    worker: { name: "bnb-agent-probe-staging" },
    queue: { id: "721ba809967d425a91dbc34eb1ac3baa" },
    d1: { id: "6fbeea3e-4516-4c4e-a5c4-392cb067198a" },
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
    ledger: Array.from({ length: 288 }, (_, index) => ({
      scheduledTime: WINDOW_START + index * 5 * 60_000,
      attempt: 1,
      phase: (["header", "sweep", "probe"] as const)[index % 3],
      outcome: "completed",
      upstreamRequests: index % 3 === 1 ? 4 : index % 3 === 2 ? 8 : 1,
      d1Queries: 12,
      rowsReadObservedBeforeLedger: 20,
      rowsWrittenObservedBeforeLedger: 8,
    })),
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
      maxD1QueriesPerAttempt: 12,
      maxConsumerCpuMs: 200,
      memoryUsageBytesP999: 12_000_000,
    },
    rawAnalytics: Object.fromEntries(
      Object.entries(RAW_FILES).map(([name, contents]) => [name, {
        path: name,
        sha256: sha256(contents),
      }]),
    ),
    accountUsage: { attributable: true, unrelatedRowsRead: 0, unrelatedRowsWritten: 0 },
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
  const contents = RAW_FILES[path as keyof typeof RAW_FILES];
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
    ["wrong phase distribution", (artifact: any) => { artifact.ledger[0].phase = "sweep"; }, "PHASE_COUNT"],
    ["D1 query overflow", (artifact: any) => { artifact.ledger[0].d1Queries = 41; }, "D1_QUERY_LIMIT"],
    ["D1 read ceiling", (artifact: any) => { artifact.totals.d1RowsRead = 4_000_000; }, "D1_READ_LIMIT"],
    ["D1 write ceiling", (artifact: any) => { artifact.totals.d1RowsWritten = 80_000; }, "D1_WRITE_LIMIT"],
    ["missing raw analytics", (artifact: any) => { delete artifact.rawAnalytics["evidence/raw/d1-account.json"]; }, "RAW_ANALYTICS"],
    ["bad raw hash", (artifact: any) => { artifact.rawAnalytics["evidence/raw/queue.json"].sha256 = "0".repeat(64); }, "RAW_HASH"],
    ["incomplete cleanup", (artifact: any) => { artifact.cleanup.finalSchedules = ["*/5 * * * *"]; }, "CLEANUP"],
  ])("rejects %s", async (_label, mutate, errorCode) => {
    const artifact = validArtifact();
    mutate(artifact);

    await expect(validateWp224hArtifact(artifact, { readRawEvidence })).rejects.toThrow(errorCode);
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
