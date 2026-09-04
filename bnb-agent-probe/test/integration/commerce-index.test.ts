import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";

import { loadConfig } from "../../src/config";
import {
  commerceCursorKey,
  runCommerceIndex,
  truncateLogs,
  type CommerceIndexReader,
  type CommerceIndexWork,
} from "../../src/phases/commerce-index";
import { commerceJobResponse, commerceJobsListResponse, commerceSummaryResponse } from "../../src/routes/commerce-jobs";
import { DEPLOYMENTS } from "../../src/routes/hire-events";
import type { Env } from "../../src/types";

const NOW = 1_788_000_000_000;
const BUYER = "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52" as Address;
const SELLER = "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5" as Address;
const OTHER = "0x1111111111111111111111111111111111111111" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;

type DecodedLog = {
  address: Address;
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hash;
};

type Job = {
  id: bigint; client: Address; provider: Address; evaluator: Address; description: string;
  budget: bigint; expiredAt: bigint; status: number; hook: Address; submittedAt: bigint; deliverable: `0x${string}`;
};

function job(id: bigint, overrides: Partial<Job> = {}): Job {
  return {
    id, client: BUYER, provider: SELLER, evaluator: OTHER, description: "x".repeat(1_500),
    budget: 10_000_000_000_000_000n, expiredAt: 1_788_600_000n, status: 1, hook: OTHER,
    submittedAt: 0n, deliverable: ZERO_BYTES32, ...overrides,
  };
}

function tx(seed: string): Hash {
  return `0x${seed.repeat(64).slice(0, 64)}` as Hash;
}

function log(eventName: string, jobId: bigint, blockNumber: bigint, logIndex: number, hash: Hash, args: Record<string, unknown> = {}): DecodedLog {
  const base = eventName === "JobSubmitted"
    ? { jobId, provider: SELLER, deliverable: `0x${"ab".repeat(32)}` }
    : eventName === "JobCompleted"
      ? { jobId, evaluator: OTHER, reason: `0x${"cd".repeat(32)}` }
      : eventName === "JobRejected"
        ? { jobId, rejector: OTHER, reason: `0x${"ef".repeat(32)}` }
        : eventName === "JobExpired"
          ? { jobId }
          : eventName === "JobFunded"
            ? { jobId, client: BUYER, provider: SELLER, amount: 10_000_000_000_000_000n }
            : { jobId, client: BUYER, provider: SELLER, evaluator: OTHER, expiredAt: 1_788_600_000n, hook: OTHER };
  return { address: DEPLOYMENTS[56].commerce, eventName, args: { ...base, ...args }, blockNumber, logIndex, transactionHash: hash };
}

function reader(options: {
  head?: bigint;
  logs?: readonly DecodedLog[];
  jobs?: readonly Job[];
  failLogs?: boolean;
} = {}) {
  const jobs = new Map((options.jobs ?? []).map((entry) => [entry.id, entry]));
  const calls = { getLogs: [] as Array<{ fromBlock: bigint; toBlock: bigint }>, multicall: 0 };
  const fake = {
    async getBlockNumber() { return options.head ?? 1_100n; },
    async getLogs(input: { fromBlock: bigint; toBlock: bigint }) {
      calls.getLogs.push({ fromBlock: input.fromBlock, toBlock: input.toBlock });
      if (options.failLogs) throw new Error("secret rpc detail");
      return (options.logs ?? []).filter((entry) => entry.blockNumber >= input.fromBlock && entry.blockNumber <= input.toBlock);
    },
    async getBlock(input: { blockNumber: bigint }) { return { timestamp: 1_700_000_000n + input.blockNumber }; },
    async multicall(input: { contracts: Array<{ args: [bigint] }> }) {
      calls.multicall += 1;
      return input.contracts.map((contract) => ({
        status: "success",
        result: jobs.get(contract.args[0])
          ?? job(contract.args[0], { client: ZERO, provider: ZERO, evaluator: ZERO, hook: ZERO, budget: 0n, expiredAt: 0n, status: 0 }),
      }));
    },
  };
  return { reader: fake as unknown as CommerceIndexReader, calls };
}

// The test env pins the Free write envelope (60 rows per run); these runs use
// the Paid envelope and the Paid index sizes that fit it.
function config(overrides: Record<string, string> = {}) {
  return loadConfig({
    ...env, KILL_SWITCH: "0", PRODUCER_KILL_SWITCH: "0", CLOUDFLARE_WORKERS_PLAN: "paid", COMMERCE_INDEX_ENABLED: "1", D1_ROWS_WRITTEN_PER_RUN: "200",
    COMMERCE_INDEX_LOGS_PER_RUN: "19", COMMERCE_INDEX_JOBS_PER_RUN: "28", ...overrides,
  } as unknown as Env);
}

function run(work: CommerceIndexWork, chainReader: CommerceIndexReader, overrides: Record<string, string> = {}, queue?: { send: ReturnType<typeof vi.fn> }) {
  const runtimeEnv = { ...env, ...(queue ? { WP2_QUEUE: queue } : {}) } as unknown as Env;
  return runCommerceIndex(work, runtimeEnv, config(overrides), { createReader: () => chainReader, now: () => NOW });
}

async function cursor(chainId: 56 | 97): Promise<number | null> {
  const row = await env.DB.prepare("SELECT integerValue FROM runtime_state WHERE key = ?")
    .bind(commerceCursorKey(chainId)).first<{ integerValue: number | null }>();
  return row?.integerValue ?? null;
}

async function events(jobId: number): Promise<Array<Record<string, unknown>>> {
  const result = await env.DB.prepare("SELECT * FROM commerce_job_events WHERE chainId = 56 AND jobId = ? ORDER BY blockNumber, logIndex")
    .bind(jobId).all();
  return result.results ?? [];
}

async function jobRow(chainId: number, jobId: number): Promise<Record<string, unknown> | null> {
  return env.DB.prepare("SELECT * FROM commerce_jobs WHERE chainId = ? AND jobId = ?").bind(chainId, jobId).first();
}

async function seedCursor(chainId: 56 | 97, block: number): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO runtime_state (key, textValue, integerValue, updatedAt) VALUES (?, NULL, ?, ?)")
    .bind(commerceCursorKey(chainId), block, NOW).run();
}

const rangeTick = (chainId: 56 | 97 = 56): CommerceIndexWork => ({ kind: "index_range", chainId, fromBlock: null, toBlock: null, enqueuedAt: NOW });

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM runtime_state").run();
  await env.DB.prepare("DELETE FROM commerce_jobs").run();
  await env.DB.prepare("DELETE FROM hire_events").run();
});

describe("truncateLogs", () => {
  it("keeps whole blocks in order, always at least the first block, within both caps", () => {
    const logs = [
      { blockNumber: 12n, logIndex: 0, id: "c" }, { blockNumber: 10n, logIndex: 0, id: "a" },
      { blockNumber: 10n, logIndex: 1, id: "b" }, { blockNumber: 14n, logIndex: 0, id: "d" },
    ];
    expect(truncateLogs(logs, { logs: 2, blocks: 5 }, 20n)).toEqual({
      included: [{ blockNumber: 10n, logIndex: 0, id: "a" }, { blockNumber: 10n, logIndex: 1, id: "b" }],
      toBlock: 11n,
      partialLogIndex: null,
    });
    expect(truncateLogs(logs, { logs: 1, blocks: 5 }, 20n)).toMatchObject({ toBlock: 9n, partialLogIndex: 0 });
    expect(truncateLogs(logs, { logs: 10, blocks: 2 }, 20n)).toMatchObject({ toBlock: 13n });
    expect(truncateLogs(logs, { logs: 10, blocks: 10 }, 20n)).toMatchObject({ toBlock: 20n });
    expect(truncateLogs([], { logs: 1, blocks: 1 }, 20n)).toEqual({ included: [], toBlock: 20n, partialLogIndex: null });
  });
});

describe("Commerce indexer", () => {
  it("initializes the chain cursor at the safe head without reading history", async () => {
    const { reader: chainReader, calls } = reader({ head: 1_100n });
    const summary = await run(rangeTick(), chainReader);

    expect(summary).toMatchObject({ kind: "index_range", chainId: 56, status: "initialized", fromBlock: 1_085, toBlock: 1_085 });
    expect(await cursor(56)).toBe(1_085);
    expect(calls.getLogs).toEqual([]);
  });

  it("indexes decoded Commerce logs, the touched jobs and the cursor in one run, idempotently", async () => {
    await seedCursor(56, 1_000);
    const logs = [
      log("JobCreated", 551n, 1_001n, 3, tx("a")),
      log("JobFunded", 551n, 1_001n, 4, tx("a")),
      log("JobSubmitted", 551n, 1_002n, 0, tx("b")),
      log("JobCompleted", 552n, 1_003n, 1, tx("c")),
    ];
    const { reader: chainReader, calls } = reader({ head: 1_100n, logs, jobs: [job(551n, { status: 2, submittedAt: 1_788_100_000n, deliverable: `0x${"ab".repeat(32)}` }), job(552n, { status: 3 })] });

    const summary = await run(rangeTick(), chainReader);

    expect(summary).toMatchObject({ status: "ok", fromBlock: 1_001, toBlock: 1_085, logs: 4, jobs: 2 });
    expect(summary.d1Queries).toBeLessThanOrEqual(38);
    expect(calls.getLogs).toEqual([{ fromBlock: 1_001n, toBlock: 1_085n }]);
    expect(await cursor(56)).toBe(1_085);
    expect(await events(551)).toMatchObject([
      { phase: "created", eventName: "JobCreated", txHash: tx("a"), logIndex: 3, blockNumber: 1_001, blockTimestamp: (1_700_000_000 + 1_001) * 1_000, actor: BUYER, amount: null },
      { phase: "funded", eventName: "JobFunded", txHash: tx("a"), logIndex: 4, actor: BUYER, amount: "10000000000000000" },
      { phase: "submitted", eventName: "JobSubmitted", txHash: tx("b"), actor: SELLER, deliverable: `0x${"ab".repeat(32)}` },
    ]);
    expect(await events(552)).toMatchObject([{ phase: "settled", eventName: "JobCompleted", actor: OTHER, reason: `0x${"cd".repeat(32)}` }]);
    expect(await jobRow(56, 551)).toMatchObject({
      client: BUYER, provider: SELLER, budget: "10000000000000000", status: 2,
      expiredAt: 1_788_600_000_000, submittedAt: 1_788_100_000_000, deliverable: `0x${"ab".repeat(32)}`, firstSeenAt: NOW, updatedAt: NOW,
    });

    // The same range delivered again (queue retry) adds nothing.
    await seedCursor(56, 1_000);
    await run(rangeTick(), chainReader);
    expect((await events(551)).length).toBe(3);
    expect(await cursor(56)).toBe(1_085);
  });

  it("stays idle when the cursor already reaches the safe head", async () => {
    await seedCursor(56, 1_085);
    const { reader: chainReader, calls } = reader({ head: 1_100n });
    const summary = await run(rangeTick(), chainReader);
    expect(summary).toMatchObject({ status: "idle", fromBlock: 1_086, toBlock: 1_085, logs: 0, jobs: 0 });
    expect(calls.getLogs).toEqual([]);
    expect(await cursor(56)).toBe(1_085);
  });

  it("truncates to whole blocks under the lookup cap and continues on the next tick", async () => {
    await seedCursor(56, 1_000);
    const logs = [log("JobCreated", 601n, 1_001n, 0, tx("d")), log("JobCreated", 602n, 1_002n, 0, tx("e"))];
    const { reader: chainReader } = reader({ head: 1_100n, logs, jobs: [job(601n), job(602n)] });

    const first = await run(rangeTick(), chainReader, { COMMERCE_INDEX_BLOCK_LOOKUPS_PER_RUN: "1" });
    expect(first).toMatchObject({ status: "ok", toBlock: 1_001, logs: 1, jobs: 1 });
    expect(await cursor(56)).toBe(1_001);
    expect(await jobRow(56, 602)).toBeNull();

    const second = await run(rangeTick(), chainReader, { COMMERCE_INDEX_BLOCK_LOOKUPS_PER_RUN: "1" });
    expect(second).toMatchObject({ status: "ok", fromBlock: 1_002, toBlock: 1_085, logs: 1, jobs: 1 });
    expect(await cursor(56)).toBe(1_085);
  });

  it("re-enqueues the remainder of an explicit range and leaves the cursor alone", async () => {
    const logs = [log("JobCreated", 701n, 900n, 0, tx("f")), log("JobCreated", 702n, 905n, 0, tx("0"))];
    const { reader: chainReader } = reader({ head: 1_100n, logs, jobs: [job(701n), job(702n)] });
    const send = vi.fn().mockResolvedValue(undefined);

    const summary = await run(
      { kind: "index_range", chainId: 56, fromBlock: 890, toBlock: 910, enqueuedAt: NOW },
      chainReader,
      { COMMERCE_INDEX_BLOCK_LOOKUPS_PER_RUN: "1" },
      { send },
    );

    expect(summary).toMatchObject({ status: "ok", fromBlock: 890, toBlock: 904, logs: 1 });
    expect(send).toHaveBeenCalledWith({ schemaVersion: 2, kind: "index_range", chainId: 56, fromBlock: 905, toBlock: 910, hops: 1, enqueuedAt: NOW });
    expect(await cursor(56)).toBeNull();
  });

  it("backfills job state by id, skipping ids that do not exist on chain", async () => {
    const { reader: chainReader } = reader({ jobs: [job(1n, { status: 3 }), job(3n)] });
    const summary = await run({ kind: "index_jobs", chainId: 97, fromJobId: 1, toJobId: 3, enqueuedAt: NOW }, chainReader);

    expect(summary).toMatchObject({ kind: "index_jobs", chainId: 97, status: "ok", jobs: 2 });
    expect(await jobRow(97, 1)).toMatchObject({ status: 3 });
    expect(await jobRow(97, 2)).toBeNull();
    expect(await jobRow(97, 3)).toMatchObject({ status: 1 });

    const { reader: updated } = reader({ jobs: [job(1n, { status: 3 }), job(3n, { status: 2, submittedAt: 5n })] });
    await runCommerceIndex(
      { kind: "index_jobs", chainId: 97, fromJobId: 1, toJobId: 3, enqueuedAt: NOW },
      env as unknown as Env,
      config(),
      { createReader: () => updated, now: () => NOW + 1 },
    );
    expect(await jobRow(97, 3)).toMatchObject({ status: 2, submittedAt: 5_000, firstSeenAt: NOW, updatedAt: NOW + 1 });
  });

  it("rejects an id range larger than one run and records a sanitized failure summary", async () => {
    const { reader: chainReader } = reader({ failLogs: true });
    await seedCursor(56, 1_000);

    await expect(run(rangeTick(), chainReader)).rejects.toThrow("BSC_LOGS_RPC");
    const summary = await env.DB.prepare("SELECT textValue FROM runtime_state WHERE key = 'last_index_summary_56'").first<{ textValue: string }>();
    expect(JSON.parse(summary?.textValue ?? "{}")).toMatchObject({ status: "error", errorCode: "BSC_LOGS_RPC" });
    expect(summary?.textValue).not.toContain("secret rpc detail");
    expect(await cursor(56)).toBe(1_000);

    await expect(run({ kind: "index_jobs", chainId: 56, fromJobId: 1, toJobId: 500, enqueuedAt: NOW }, chainReader))
      .rejects.toThrow("COMMERCE_INDEX_JOB_RANGE");
  });
});

describe("Commerce read routes", () => {
  async function seedLedger() {
    const logs = [
      log("JobCreated", 801n, 1_001n, 0, tx("1")), log("JobFunded", 801n, 1_001n, 1, tx("1")),
      log("JobCreated", 802n, 1_002n, 0, tx("2")),
    ];
    const { reader: chainReader } = reader({
      head: 1_100n, logs,
      jobs: [job(801n, { status: 1 }), job(802n, { client: OTHER, provider: OTHER, status: 0 })],
    });
    await seedCursor(56, 1_000);
    await run(rangeTick(), chainReader);
    await env.DB.prepare(`INSERT INTO hire_events
      (eventKey, agentId, chainId, phase, provenance, jobId, txHash, blockNumber, occurredAt, verifiedAt, callerKey)
      VALUES ('56:0x1:funded', '303779', 56, 'funded', 'chain_verified', '801', ?, '1001', ?, ?, 'anonymous')`)
      .bind(tx("1"), NOW, NOW).run();
  }

  it("lists indexed jobs newest first with the marketplace flag derived from verified hire events", async () => {
    await seedLedger();
    const response = await commerceJobsListResponse(new Request("https://worker.test/commerce-jobs?chainId=56"), env.DB);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=60");
    const body = await response.json() as { jobs: Array<Record<string, unknown>>; nextBefore: string | null };
    expect(body.jobs.map((entry) => [entry.jobId, entry.marketplace])).toEqual([["802", false], ["801", true]]);
    expect(body.jobs[1]).toMatchObject({ client: BUYER, provider: SELLER, budget: "10000000000000000", status: 1, expiredAt: 1_788_600_000_000, submittedAt: null });
    expect(body.nextBefore).toBeNull();

    const byBuyer = await (await commerceJobsListResponse(new Request(`https://worker.test/commerce-jobs?chainId=56&buyer=${BUYER.toLowerCase()}`), env.DB)).json() as { jobs: Array<{ jobId: string }> };
    expect(byBuyer.jobs.map((entry) => entry.jobId)).toEqual(["801"]);
    const byProvider = await (await commerceJobsListResponse(new Request(`https://worker.test/commerce-jobs?chainId=56&provider=${OTHER}`), env.DB)).json() as { jobs: Array<{ jobId: string }> };
    expect(byProvider.jobs.map((entry) => entry.jobId)).toEqual(["802"]);
    const byAgent = await (await commerceJobsListResponse(new Request("https://worker.test/commerce-jobs?chainId=56&agentId=303779"), env.DB)).json() as { jobs: Array<{ jobId: string }> };
    expect(byAgent.jobs.map((entry) => entry.jobId)).toEqual(["801"]);
    const paged = await (await commerceJobsListResponse(new Request("https://worker.test/commerce-jobs?chainId=56&limit=1"), env.DB)).json() as { jobs: Array<{ jobId: string }>; nextBefore: string | null };
    expect(paged).toMatchObject({ jobs: [{ jobId: "802" }], nextBefore: "802" });
    const older = await (await commerceJobsListResponse(new Request("https://worker.test/commerce-jobs?chainId=56&limit=1&before=802"), env.DB)).json() as { jobs: Array<{ jobId: string }>; nextBefore: string | null };
    expect(older).toMatchObject({ jobs: [{ jobId: "801" }], nextBefore: null });
    const funded = await (await commerceJobsListResponse(new Request("https://worker.test/commerce-jobs?chainId=56&status=FUNDED"), env.DB)).json() as { jobs: Array<{ jobId: string }> };
    expect(funded.jobs.map((entry) => entry.jobId)).toEqual(["801"]);
  });

  it.each([
    "/commerce-jobs",
    "/commerce-jobs?chainId=1",
    "/commerce-jobs?chainId=56&buyer=0x1&",
    "/commerce-jobs?chainId=56&buyer=0x1111111111111111111111111111111111111111&provider=0x1111111111111111111111111111111111111111",
    "/commerce-jobs?chainId=56&status=DONE",
    "/commerce-jobs?chainId=56&before=x",
    "/commerce-jobs?chainId=56&before=9999999999999999",
    "/commerce-jobs?chainId=56&limit=0",
    "/commerce-jobs?chainId=56&unknown=1",
    "/commerce-jobs/56/801?x=1",
    "/commerce-jobs/56/9999999999999999",
    "/commerce-summary",
    "/commerce-summary?chainId=56&extra=1",
  ])("rejects %s with 400 and no caching", async (path) => {
    const request = new Request(`https://worker.test${path}`);
    const response = path.startsWith("/commerce-summary")
      ? await commerceSummaryResponse(request, env.DB)
      : path.startsWith("/commerce-jobs/")
        ? await commerceJobResponse(request, env.DB)
        : await commerceJobsListResponse(request, env.DB);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("returns one job with its phase ledger and verified hire events, or 404", async () => {
    await seedLedger();
    const response = await commerceJobResponse(new Request("https://worker.test/commerce-jobs/56/801"), env.DB);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schemaVersion: 1,
      chainId: 56,
      job: { jobId: "801", client: BUYER, provider: SELLER, evaluator: OTHER, hook: OTHER, deliverable: null, marketplace: true },
      events: [
        { phase: "created", txHash: tx("1"), blockNumber: "1001", occurredAt: (1_700_000_000 + 1_001) * 1_000, actor: BUYER },
        { phase: "funded", txHash: tx("1"), amount: "10000000000000000" },
      ],
      marketplace: true,
      hireEvents: [{ agentId: "303779", phase: "funded", txHash: tx("1"), blockNumber: "1001" }],
    });
    const missing = await commerceJobResponse(new Request("https://worker.test/commerce-jobs/56/999999"), env.DB);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });

  it("summarizes protocol and marketplace counts per status with the indexed cursor", async () => {
    await seedLedger();
    const bounded = {
      prepare(query: string) {
        if (/\b(?:COUNT|GROUP\s+BY|EXISTS)\b/i.test(query)) {
          throw new Error(`unbounded summary query: ${query}`);
        }
        return env.DB.prepare(query);
      },
    } as unknown as typeof env.DB;
    const response = await commerceSummaryResponse(new Request("https://worker.test/commerce-summary?chainId=56"), bounded);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schemaVersion: 1,
      chainId: 56,
      indexedThrough: { blockNumber: "1085", at: NOW },
      protocol: { jobs: 2, byStatus: { OPEN: 1, FUNDED: 1, SUBMITTED: 0, COMPLETED: 0, REJECTED: 0, EXPIRED: 0 } },
      marketplace: { jobs: 1, byStatus: { OPEN: 0, FUNDED: 1 } },
      lastIndexRun: { status: "ok", at: NOW },
    });
    const empty = await (await commerceSummaryResponse(new Request("https://worker.test/commerce-summary?chainId=97"), env.DB)).json();
    expect(empty).toMatchObject({ chainId: 97, indexedThrough: null, protocol: { jobs: 0 }, marketplace: { jobs: 0 }, lastIndexRun: null });
  });

  it("moves fixed summary counts on status changes without double-counting later verified phases", async () => {
    await seedLedger();
    await env.DB.prepare("UPDATE commerce_jobs SET status = 3 WHERE chainId = 56 AND jobId = 801").run();
    await env.DB.prepare(`INSERT INTO hire_events
      (eventKey, agentId, chainId, phase, provenance, jobId, txHash, blockNumber, occurredAt, verifiedAt, callerKey)
      VALUES ('summary-second-phase', '303779', 56, 'settled', 'chain_verified', '801', ?, '1002', ?, ?, 'test')`)
      .bind(tx("2"), NOW, NOW).run();

    const body = await (await commerceSummaryResponse(
      new Request("https://worker.test/commerce-summary?chainId=56"), env.DB,
    )).json() as { protocol: { byStatus: Record<string, number> }; marketplace: { byStatus: Record<string, number> } };
    expect(body.protocol.byStatus).toMatchObject({ FUNDED: 0, COMPLETED: 1 });
    expect(body.marketplace.byStatus).toMatchObject({ FUNDED: 0, COMPLETED: 1 });
  });
});
