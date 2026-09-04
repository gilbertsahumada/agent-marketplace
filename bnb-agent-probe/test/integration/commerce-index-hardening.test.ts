import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";

import { loadConfig, type WorkerConfig } from "../../src/config";
import { BscProbeError } from "../../src/lib/chain";
import {
  EVENT_ROW_WRITES,
  JOB_ROW_WRITES,
  commerceCursorKey,
  commerceSummaryKey,
  commerceWindowKey,
  runCommerceIndex,
  type CommerceIndexLogger,
  type CommerceIndexReader,
  type CommerceIndexWork,
} from "../../src/phases/commerce-index";
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
  removed?: boolean;
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
    id, client: BUYER, provider: SELLER, evaluator: OTHER, description: "x",
    budget: 10_000_000_000_000_000n, expiredAt: 1_788_600_000n, status: 1, hook: OTHER,
    submittedAt: 0n, deliverable: ZERO_BYTES32, ...overrides,
  };
}

function tx(seed: string): Hash {
  return `0x${seed.padStart(64, "0")}` as Hash;
}

function created(jobId: bigint, blockNumber: bigint, logIndex = 0, overrides: Partial<DecodedLog> = {}): DecodedLog {
  return {
    address: DEPLOYMENTS[56].commerce,
    eventName: "JobCreated",
    args: { jobId, client: BUYER, provider: SELLER, evaluator: OTHER, expiredAt: 1_788_600_000n, hook: OTHER },
    blockNumber,
    logIndex,
    transactionHash: tx(`${jobId.toString(16)}${blockNumber.toString(16)}${logIndex.toString(16)}`),
    ...overrides,
  };
}

interface ReaderOptions {
  head?: bigint;
  logs?: readonly DecodedLog[];
  jobs?: readonly Job[];
  // getLogs rejects (like a provider range cap or an oversized reply) above this many blocks.
  maxRange?: number;
  failBlock?: boolean;
  failJobIds?: readonly bigint[];
  multicallResult?: unknown;
  onGetBlock?: () => Promise<void>;
}

function reader(options: ReaderOptions = {}) {
  const jobs = new Map((options.jobs ?? []).map((entry) => [entry.id, entry]));
  const calls = {
    getLogs: [] as Array<{ fromBlock: bigint; toBlock: bigint }>,
    multicall: [] as Array<{ blockNumber: bigint | undefined; allowFailure: boolean | undefined; ids: bigint[] }>,
  };
  const fake = {
    async getBlockNumber() { return options.head ?? 1_100n; },
    async getLogs(input: { fromBlock: bigint; toBlock: bigint }) {
      calls.getLogs.push({ fromBlock: input.fromBlock, toBlock: input.toBlock });
      if (options.maxRange !== undefined && input.toBlock - input.fromBlock + 1n > BigInt(options.maxRange)) {
        throw new BscProbeError("BSC_RPC_RESPONSE");
      }
      return (options.logs ?? []).filter((entry) => entry.blockNumber >= input.fromBlock && entry.blockNumber <= input.toBlock);
    },
    async getBlock(input: { blockNumber: bigint }) {
      if (options.failBlock) throw new Error("secret block detail");
      await options.onGetBlock?.();
      return { timestamp: 1_700_000_000n + input.blockNumber };
    },
    async multicall(input: { contracts: Array<{ args: [bigint] }>; blockNumber?: bigint; allowFailure?: boolean }) {
      calls.multicall.push({ blockNumber: input.blockNumber, allowFailure: input.allowFailure, ids: input.contracts.map((c) => c.args[0]) });
      if (options.multicallResult !== undefined) return options.multicallResult;
      return input.contracts.map((contract) => {
        const id = contract.args[0];
        const result = jobs.get(id) ?? job(id, { client: ZERO, provider: ZERO, evaluator: ZERO, hook: ZERO, budget: 0n, expiredAt: 0n, status: 0 });
        if (input.allowFailure !== true) {
          if (options.failJobIds?.includes(id)) throw new Error("execution reverted");
          return result;
        }
        if (options.failJobIds?.includes(id)) return { status: "failure", error: new Error("execution reverted") };
        return { status: "success", result };
      });
    },
  };
  return { reader: fake as unknown as CommerceIndexReader, calls };
}

// Paid sizes at the Paid write envelope (200 rows: 23 logs, 39 jobs), so a run
// can hold the largest Paid batch; single tests narrow them again.
function config(overrides: Record<string, string> = {}) {
  return loadConfig({
    ...env, KILL_SWITCH: "0", PRODUCER_KILL_SWITCH: "0", CLOUDFLARE_WORKERS_PLAN: "paid", COMMERCE_INDEX_ENABLED: "1",
    D1_ROWS_WRITTEN_PER_RUN: "200", COMMERCE_INDEX_LOGS_PER_RUN: "23", COMMERCE_INDEX_JOBS_PER_RUN: "39", ...overrides,
  } as unknown as Env);
}

interface RunOptions {
  config?: Record<string, string>;
  // Applied after validation: lets a test exercise runtime guards that a valid
  // configuration can never reach (defence in depth against invariant drift).
  patch?: Partial<WorkerConfig>;
  queue?: { send: ReturnType<typeof vi.fn> };
  logger?: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

function run(work: CommerceIndexWork, chainReader: CommerceIndexReader, options: RunOptions = {}) {
  const runtimeEnv = { ...env, ...(options.queue ? { WP2_QUEUE: options.queue } : {}) } as unknown as Env;
  return runCommerceIndex(work, runtimeEnv, { ...config(options.config), ...options.patch }, {
    createReader: () => chainReader, now: () => NOW,
    ...(options.logger ? { logger: options.logger as unknown as CommerceIndexLogger } : {}),
  });
}

async function integerState(key: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT integerValue FROM runtime_state WHERE key = ?").bind(key).first<{ integerValue: number | null }>();
  return row?.integerValue ?? null;
}

async function lastSummary(chainId: 56 | 97): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare("SELECT textValue FROM runtime_state WHERE key = ?").bind(commerceSummaryKey(chainId)).first<{ textValue: string }>();
  return JSON.parse(row?.textValue ?? "{}") as Record<string, unknown>;
}

async function eventCount(fromJobId: number, toJobId: number, chainId: 56 | 97 = 56): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM commerce_job_events WHERE chainId = ? AND jobId BETWEEN ? AND ?")
    .bind(chainId, fromJobId, toJobId).first<{ n: number }>();
  return row?.n ?? 0;
}

async function jobRow(chainId: number, jobId: number): Promise<Record<string, unknown> | null> {
  return env.DB.prepare("SELECT * FROM commerce_jobs WHERE chainId = ? AND jobId = ?").bind(chainId, jobId).first();
}

async function seedCursor(chainId: 56 | 97, block: number): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO runtime_state (key, textValue, integerValue, updatedAt) VALUES (?, NULL, ?, ?)")
    .bind(commerceCursorKey(chainId), block, NOW).run();
}

const rangeTick = (chainId: 56 | 97 = 56): CommerceIndexWork => ({ kind: "index_range", chainId, fromBlock: null, toBlock: null, enqueuedAt: NOW });
const explicit = (fromBlock: number, toBlock: number): CommerceIndexWork => ({ kind: "index_range", chainId: 56, fromBlock, toBlock, enqueuedAt: NOW });

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM runtime_state").run();
  await env.DB.prepare("DELETE FROM commerce_jobs").run();
});

describe("Commerce indexer window recovery", () => {
  it("halves the persisted window on each rejected getLogs range, indexes with the narrower range and doubles it back after a full-window success", async () => {
    await seedCursor(56, 1_000);
    const logs = [created(11n, 1_001n), created(12n, 1_040n), created(13n, 1_070n)];
    const { reader: chainReader, calls } = reader({ head: 2_000n, logs, jobs: [job(11n), job(12n), job(13n)], maxRange: 60 });
    const blocks = { COMMERCE_INDEX_BLOCKS_PER_RUN: "200" };

    await expect(run(rangeTick(), chainReader, { config: blocks })).rejects.toThrow("BSC_RPC_RESPONSE");
    expect(await integerState(commerceWindowKey(56))).toBe(100);
    expect(await lastSummary(56)).toMatchObject({ status: "error", errorCode: "BSC_RPC_RESPONSE", fromBlock: 1_001, toBlock: 1_200, window: 200 });
    expect(await integerState(commerceCursorKey(56))).toBe(1_000);

    await expect(run(rangeTick(), chainReader, { config: blocks })).rejects.toThrow("BSC_RPC_RESPONSE");
    expect(await integerState(commerceWindowKey(56))).toBe(50);

    const recovered = await run(rangeTick(), chainReader, { config: blocks });
    expect(recovered).toMatchObject({ status: "ok", fromBlock: 1_001, toBlock: 1_050, logs: 2, jobs: 2, window: 50 });
    expect(await integerState(commerceCursorKey(56))).toBe(1_050);
    expect(await integerState(commerceWindowKey(56))).toBe(100);

    await expect(run(rangeTick(), chainReader, { config: blocks })).rejects.toThrow("BSC_RPC_RESPONSE");
    const next = await run(rangeTick(), chainReader, { config: blocks });
    expect(next).toMatchObject({ status: "ok", fromBlock: 1_051, toBlock: 1_100, logs: 1, window: 50 });
    expect(calls.getLogs).toEqual([
      { fromBlock: 1_001n, toBlock: 1_200n }, { fromBlock: 1_001n, toBlock: 1_100n }, { fromBlock: 1_001n, toBlock: 1_050n },
      { fromBlock: 1_051n, toBlock: 1_150n }, { fromBlock: 1_051n, toBlock: 1_100n },
    ]);
    expect(await eventCount(11, 13)).toBe(3);
  });

  it("never narrows below one block and keeps the window at the configured size when nothing was persisted", async () => {
    await seedCursor(56, 1_000);
    await env.DB.prepare("INSERT INTO runtime_state (key, textValue, integerValue, updatedAt) VALUES (?, NULL, 1, ?)")
      .bind(commerceWindowKey(56), NOW).run();
    const { reader: chainReader, calls } = reader({ head: 2_000n, maxRange: 0 });
    await expect(run(rangeTick(), chainReader)).rejects.toThrow("BSC_RPC_RESPONSE");
    expect(calls.getLogs).toEqual([{ fromBlock: 1_001n, toBlock: 1_001n }]);
    expect(await integerState(commerceWindowKey(56))).toBe(1);

    await env.DB.prepare("DELETE FROM runtime_state WHERE key = ?").bind(commerceWindowKey(56)).run();
    const { reader: healthy } = reader({ head: 2_000n });
    expect(await run(rangeTick(), healthy, { config: { COMMERCE_INDEX_BLOCKS_PER_RUN: "300" } })).toMatchObject({ toBlock: 1_300, window: 300 });
    expect(await integerState(commerceWindowKey(56))).toBeNull();
  });
});

describe("Commerce indexer row budget", () => {
  // 23 logs on 23 distinct jobs across 12 blocks: the largest Paid batch.
  // Job ids are per test: the ledger is append-only and shared within a file.
  const capLogs = (base: number) => Array.from({ length: 23 }, (_, index) => created(BigInt(base + index), 1_001n + BigInt(index >> 1), index & 1));
  const jobsOf = (logs: DecodedLog[]) => logs.map((entry) => job(entry.args.jobId as bigint));
  // 23*3 events + 4 sequence rows + 23*5 jobs = 188, plus the cursor update (1)
  // and a fresh summary row (2) = 191 metered; the reservation allows two
  // rows for each runtime_state write: 192.
  const reserved = 23 * EVENT_ROW_WRITES + 4 + 23 * JOB_ROW_WRITES + 2 * 2;

  it("meters a run at the Paid cap under D1_ROWS_WRITTEN_PER_RUN using the real rows_written meta", async () => {
    await seedCursor(56, 1_000);
    const logs = capLogs(100);
    const { reader: chainReader } = reader({ head: 1_100n, logs, jobs: jobsOf(logs) });
    const summary = await run(rangeTick(), chainReader, { config: { COMMERCE_INDEX_BLOCK_LOOKUPS_PER_RUN: "12" } });
    expect(summary).toMatchObject({ status: "ok", logs: 23, jobs: 23 });
    expect(summary.d1RowsWritten).toBe(reserved - 1);
    expect(summary.d1RowsWritten).toBeLessThanOrEqual(config().d1RowsWrittenPerRun);
    expect(await lastSummary(56)).toMatchObject({ status: "ok", d1RowsWritten: reserved });
    expect(await eventCount(100, 122)).toBe(23);
  });

  it("refuses the batch before anything commits when the expected index writes exceed the row budget", async () => {
    await seedCursor(56, 1_000);
    const logs = capLogs(200);
    const { reader: chainReader } = reader({ head: 1_100n, logs, jobs: jobsOf(logs) });
    await expect(run(rangeTick(), chainReader, {
      config: { COMMERCE_INDEX_BLOCK_LOOKUPS_PER_RUN: "12" }, patch: { d1RowsWrittenPerRun: reserved - 1 },
    })).rejects.toThrow("D1_ROW_BUDGET");
    expect(await lastSummary(56)).toMatchObject({ status: "error", errorCode: "D1_ROW_BUDGET" });
    expect(await integerState(commerceCursorKey(56))).toBe(1_000);
    expect(await eventCount(200, 222)).toBe(0);
    expect(await jobRow(56, 200)).toBeNull();
  });
});

describe("Commerce indexer explicit ranges", () => {
  it("clamps an explicit range to the safe head and re-enqueues only the part below it", async () => {
    // head 1100, finality 15 → safe head 1085; the lookup cap of one block
    // stops after the first busy block so a remainder exists.
    const logs = [created(301n, 1_075n), created(302n, 1_080n), created(303n, 1_090n)];
    const { reader: chainReader, calls } = reader({ head: 1_100n, logs, jobs: [job(301n), job(302n), job(303n)] });
    const send = vi.fn().mockResolvedValue(undefined);
    const summary = await run(explicit(1_070, 1_095), chainReader, { config: { COMMERCE_INDEX_BLOCK_LOOKUPS_PER_RUN: "1" }, queue: { send } });
    expect(calls.getLogs).toEqual([{ fromBlock: 1_070n, toBlock: 1_085n }]);
    expect(summary).toMatchObject({ status: "ok", fromBlock: 1_070, toBlock: 1_079, logs: 1 });
    expect(send).toHaveBeenCalledWith({ schemaVersion: 2, kind: "index_range", chainId: 56, fromBlock: 1_080, toBlock: 1_085, enqueuedAt: NOW });
    expect(await jobRow(56, 303)).toBeNull();
    expect(await integerState(commerceCursorKey(56))).toBeNull();
  });

  it("rejects an explicit range that starts past the safe head or spans more than one run", async () => {
    const { reader: chainReader, calls } = reader({ head: 1_100n });
    await expect(run(explicit(1_086, 1_090), chainReader)).rejects.toThrow("COMMERCE_INDEX_BLOCK_RANGE");
    await expect(run(explicit(1, 2_001), chainReader)).rejects.toThrow("COMMERCE_INDEX_BLOCK_RANGE");
    expect(calls.getLogs).toEqual([]);
    expect(await lastSummary(56)).toMatchObject({ status: "error", errorCode: "COMMERCE_INDEX_BLOCK_RANGE" });
  });

  it("does not re-enqueue the remainder while the producer kill switch is on, and says so", async () => {
    const logs = [created(311n, 1_001n), created(312n, 1_002n)];
    const { reader: chainReader } = reader({ head: 1_100n, logs, jobs: [job(311n), job(312n)] });
    const send = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn() };
    const summary = await run(explicit(1_000, 1_010), chainReader, {
      config: { COMMERCE_INDEX_BLOCK_LOOKUPS_PER_RUN: "1", PRODUCER_KILL_SWITCH: "1" }, queue: { send }, logger,
    });
    expect(summary).toMatchObject({ status: "ok", toBlock: 1_001, logs: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("commerce.index.remainder_dropped", { chainId: 56, fromBlock: 1_002, toBlock: 1_010 });
    // Without a logger the remainder is dropped silently, never sent.
    await expect(run(explicit(1_000, 1_010), chainReader, {
      config: { COMMERCE_INDEX_BLOCK_LOOKUPS_PER_RUN: "1", PRODUCER_KILL_SWITCH: "1" }, queue: { send },
    })).resolves.toMatchObject({ status: "ok" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("Commerce indexer log filtering", () => {
  it("ignores removed logs and logs emitted by other contracts", async () => {
    await seedCursor(56, 1_000);
    const logs = [
      created(401n, 1_001n, 0),
      created(402n, 1_001n, 1, { address: OTHER }),
      created(403n, 1_001n, 2, { address: DEPLOYMENTS[56].commerce.toLowerCase() as Address }),
      created(404n, 1_002n, 0, { removed: true }),
    ];
    const { reader: chainReader, calls } = reader({ head: 1_100n, logs, jobs: [job(401n), job(402n), job(403n), job(404n)] });
    const summary = await run(rangeTick(), chainReader);
    expect(summary).toMatchObject({ status: "ok", logs: 2, jobs: 2, toBlock: 1_085 });
    expect(calls.multicall.flatMap((call) => call.ids)).toEqual([401n, 403n]);
    expect(await eventCount(401, 404)).toBe(2);
    expect(await jobRow(56, 402)).toBeNull();
    expect(await jobRow(56, 404)).toBeNull();
  });
});

describe("Commerce indexer job reads", () => {
  it("reads jobs pinned at the indexed block, skipping and counting items that fail", async () => {
    await seedCursor(56, 1_000);
    const logs = [created(501n, 1_001n), created(502n, 1_001n, 1), created(503n, 1_002n)];
    const { reader: chainReader, calls } = reader({ head: 1_100n, logs, jobs: [job(501n), job(502n), job(503n)], failJobIds: [502n] });
    const summary = await run(rangeTick(), chainReader);
    expect(summary).toMatchObject({ status: "ok", logs: 3, jobs: 2, jobsFailed: 1, toBlock: 1_085 });
    expect(calls.multicall).toEqual([{ blockNumber: 1_085n, allowFailure: true, ids: [501n, 502n, 503n] }]);
    expect(await jobRow(56, 501)).not.toBeNull();
    expect(await jobRow(56, 502)).toBeNull();
    expect(await jobRow(56, 503)).not.toBeNull();
    expect(await lastSummary(56)).toMatchObject({ jobsFailed: 1 });
  });

  it("pins an id backfill at the safe head", async () => {
    const { reader: chainReader, calls } = reader({ head: 1_100n, jobs: [job(7n)] });
    const summary = await run({ kind: "index_jobs", chainId: 56, fromJobId: 7, toJobId: 8, enqueuedAt: NOW }, chainReader);
    expect(summary).toMatchObject({ status: "ok", jobs: 1, jobsFailed: 0 });
    expect(calls.multicall).toEqual([{ blockNumber: 1_085n, allowFailure: true, ids: [7n, 8n] }]);
  });

  it("fails the run with BSC_READS when a multicall item is not a job", async () => {
    await seedCursor(56, 1_000);
    const logs = [created(511n, 1_001n)];
    const { reader: broken } = reader({ head: 1_100n, logs, multicallResult: [42] });
    await expect(run(rangeTick(), broken)).rejects.toThrow("BSC_READS");
    const { reader: malformed } = reader({ head: 1_100n, logs, multicallResult: [{ status: "success", result: "nope" }] });
    await expect(run(rangeTick(), malformed)).rejects.toThrow("BSC_READS");
    expect(await lastSummary(56)).toMatchObject({ status: "error", errorCode: "BSC_READS" });
    expect(await integerState(commerceCursorKey(56))).toBe(1_000);
  });

  it("fails the run with BSC_BLOCK_RPC when a block timestamp cannot be read, without leaking the cause", async () => {
    await seedCursor(56, 1_000);
    const { reader: chainReader } = reader({ head: 1_100n, logs: [created(521n, 1_001n)], failBlock: true });
    await expect(run(rangeTick(), chainReader)).rejects.toThrow("BSC_BLOCK_RPC");
    const row = await env.DB.prepare("SELECT textValue FROM runtime_state WHERE key = ?").bind(commerceSummaryKey(56)).first<{ textValue: string }>();
    expect(row?.textValue).toContain("BSC_BLOCK_RPC");
    expect(row?.textValue).not.toContain("secret block detail");
  });
});

describe("Commerce indexer safe integers", () => {
  it("clamps job timestamps to the safe integer range and drops events whose job id exceeds it", async () => {
    await seedCursor(56, 1_000);
    const huge = 2n ** 256n - 1n;
    const logs = [created(601n, 1_001n), created(huge, 1_001n, 1)];
    const { reader: chainReader, calls } = reader({ head: 1_100n, logs, jobs: [job(601n, { expiredAt: huge, submittedAt: huge, status: 2 })] });
    const summary = await run(rangeTick(), chainReader);
    expect(summary).toMatchObject({ status: "ok", logs: 1, jobs: 1 });
    expect(calls.multicall.flatMap((call) => call.ids)).toEqual([601n]);
    expect(await jobRow(56, 601)).toMatchObject({ expiredAt: Number.MAX_SAFE_INTEGER, submittedAt: Number.MAX_SAFE_INTEGER });
    expect(await eventCount(601, 601)).toBe(1);
  });
});

describe("Commerce indexer cursor guards", () => {
  it("never moves the cursor backwards when a newer cursor landed while the run was in flight", async () => {
    await seedCursor(56, 1_000);
    const { reader: chainReader } = reader({
      head: 1_100n, logs: [created(701n, 1_001n)], jobs: [job(701n)],
      onGetBlock: async () => { await seedCursor(56, 2_000); },
    });
    const summary = await run(rangeTick(), chainReader);
    expect(summary).toMatchObject({ status: "ok", toBlock: 1_085, logs: 1 });
    expect(await integerState(commerceCursorKey(56))).toBe(2_000);
    expect(await eventCount(701, 701)).toBe(1);
  });

  it("indexes BSC Testnet from its own cursor and contract", async () => {
    await seedCursor(97, 500);
    const logs = [created(801n, 501n, 0, { address: DEPLOYMENTS[97].commerce }), created(802n, 502n, 0)];
    const { reader: chainReader, calls } = reader({ head: 600n, logs, jobs: [job(801n), job(802n)] });
    const summary = await run(rangeTick(97), chainReader);
    expect(summary).toMatchObject({ kind: "index_range", chainId: 97, status: "ok", fromBlock: 501, toBlock: 585, logs: 1, jobs: 1 });
    expect(calls.getLogs).toEqual([{ fromBlock: 501n, toBlock: 585n }]);
    expect(await integerState(commerceCursorKey(97))).toBe(585);
    expect(await integerState(commerceCursorKey(56))).toBeNull();
    expect(await jobRow(97, 801)).not.toBeNull();
    expect(await eventCount(801, 802, 97)).toBe(1);
  });

  it("truncates a full run to whole blocks under COMMERCE_INDEX_LOGS_PER_RUN and resumes from there", async () => {
    await seedCursor(56, 1_000);
    const logs = [created(901n, 1_001n), created(902n, 1_002n), created(903n, 1_003n), created(904n, 1_004n), created(905n, 1_005n)];
    const { reader: chainReader } = reader({ head: 1_100n, logs, jobs: logs.map((entry) => job(entry.args.jobId as bigint)) });
    const first = await run(rangeTick(), chainReader, { config: { COMMERCE_INDEX_LOGS_PER_RUN: "3" } });
    expect(first).toMatchObject({ status: "ok", fromBlock: 1_001, toBlock: 1_003, logs: 3, jobs: 3 });
    expect(await integerState(commerceCursorKey(56))).toBe(1_003);
    expect(await jobRow(56, 904)).toBeNull();
    const second = await run(rangeTick(), chainReader, { config: { COMMERCE_INDEX_LOGS_PER_RUN: "3" } });
    expect(second).toMatchObject({ status: "ok", fromBlock: 1_004, toBlock: 1_085, logs: 2, jobs: 2 });
    expect(await eventCount(901, 905)).toBe(5);
  });
});
