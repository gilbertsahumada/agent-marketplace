import { sql } from "drizzle-orm";
import { getAddress, isAddressEqual, type Address, type Hash, type PublicClient } from "viem";

import type { WorkerConfig } from "../config";
import type { D1DatabaseLike } from "../db/client";
import { chunks, createDatabase, readRuntimeStates, writeRuntimeState } from "../db/orm";
import { D1QueryBudgetExceededError, D1RowBudgetExceededError, createBudgetedD1Database } from "../db/query-budget";
import { commerceJobEvents, commerceJobs, runtimeState } from "../db/schema";
import { BscProbeError, READ_ONLY_RPC_METHODS, createCountedBscClient, nestedBscProbeError } from "../lib/chain";
import { DEPLOYMENTS, commerceEventsAbi, commerceReadAbi, type HireChainId } from "../routes/hire-events";
import type { Env } from "../types";

/**
 * Commerce indexer. Two queue messages feed it:
 *
 * - `index_range`: read Commerce logs for a block range and record one
 *   `commerce_job_events` row per log plus the current `getJob()` state of every
 *   job those logs touched. Without an explicit range the message means "from
 *   the chain cursor to head minus the finality margin", and the cursor advances
 *   in the same D1 batch as the rows. An explicit range (backfill) never moves
 *   the cursor; if it has to be truncated, the remainder is re-enqueued.
 * - `index_jobs`: read `getJob()` for an id range and upsert `commerce_jobs`
 *   (state backfill; jobs whose client is the zero address do not exist).
 *
 * Nothing here attributes a job to the marketplace: readers join `hire_events`.
 */

export type CommerceIndexChainId = HireChainId;

export type CommerceIndexWork =
  | {
    readonly kind: "index_range";
    readonly chainId: CommerceIndexChainId;
    readonly fromBlock: number | null;
    readonly toBlock: number | null;
    readonly enqueuedAt: number;
  }
  | {
    readonly kind: "index_jobs";
    readonly chainId: CommerceIndexChainId;
    readonly fromJobId: number;
    readonly toJobId: number;
    readonly enqueuedAt: number;
  };

export type CommerceIndexReader = Pick<PublicClient, "getBlockNumber" | "getLogs" | "getBlock" | "multicall">;

export interface CommerceIndexDependencies {
  readonly createReader?: (chainId: CommerceIndexChainId) => CommerceIndexReader;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export interface CommerceIndexSummary {
  readonly kind: CommerceIndexWork["kind"];
  readonly chainId: CommerceIndexChainId;
  readonly status: "ok" | "initialized" | "idle";
  readonly fromBlock: number | null;
  readonly toBlock: number | null;
  readonly logs: number;
  readonly jobs: number;
  readonly d1Queries: number;
  readonly wallTimeMs: number;
}

const ROW_CHUNK = 6;
const JOB_READ_CHUNK = 50;
const INDEX_RPC_DEADLINE_MS = 60_000;
const INDEX_RPC_RESPONSE_BYTES = 2 * 1_024 * 1_024;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
export const COMMERCE_INDEX_RPC_METHODS: ReadonlySet<string> = new Set([
  ...READ_ONLY_RPC_METHODS, "eth_getLogs", "eth_blockNumber",
]);

const EVENT_PHASES: Record<string, "created" | "funded" | "submitted" | "settled" | "refunded"> = {
  JobCreated: "created",
  JobFunded: "funded",
  JobSubmitted: "submitted",
  JobCompleted: "settled",
  JobRejected: "refunded",
  JobExpired: "refunded",
};

export function commerceCursorKey(chainId: CommerceIndexChainId): string {
  return `commerce_cursor_${chainId}`;
}

export function commerceSummaryKey(chainId: CommerceIndexChainId): string {
  return `last_index_summary_${chainId}`;
}

interface DecodedCommerceLog {
  readonly eventName: string;
  readonly args: Record<string, unknown>;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: Hash;
}

interface JobState {
  readonly id: bigint;
  readonly client: Address;
  readonly provider: Address;
  readonly evaluator: Address;
  readonly budget: bigint;
  readonly expiredAt: bigint;
  readonly status: number;
  readonly hook: Address;
  readonly submittedAt: bigint;
  readonly deliverable: `0x${string}`;
}

// Whole blocks only, in order, until either cap would be exceeded. The first
// block is always included so a single busy block cannot stall the cursor.
export function truncateLogs<T extends { blockNumber: bigint }>(
  logs: readonly T[],
  limits: { readonly logs: number; readonly blocks: number },
  toBlock: bigint,
): { included: T[]; toBlock: bigint } {
  const ordered = [...logs].sort((left, right) => (left.blockNumber < right.blockNumber ? -1 : left.blockNumber > right.blockNumber ? 1 : 0));
  const included: T[] = [];
  let blocks = 0;
  let index = 0;
  while (index < ordered.length) {
    const block = ordered[index]!.blockNumber;
    let end = index;
    while (end < ordered.length && ordered[end]!.blockNumber === block) end += 1;
    const size = end - index;
    if (included.length > 0 && (included.length + size > limits.logs || blocks + 1 > limits.blocks)) {
      return { included, toBlock: block - 1n };
    }
    included.push(...ordered.slice(index, end));
    blocks += 1;
    index = end;
  }
  return { included, toBlock };
}

function errorCode(error: unknown): string {
  const chainError = nestedBscProbeError(error);
  if (chainError) return chainError.code;
  if (error instanceof D1QueryBudgetExceededError) return "D1_QUERY_BUDGET";
  if (error instanceof D1RowBudgetExceededError) return "D1_ROW_BUDGET";
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)) return error.message;
  return "COMMERCE_INDEX_FAILED";
}

function jobRow(chainId: CommerceIndexChainId, job: JobState, nowMs: number) {
  return {
    chainId,
    jobId: Number(job.id),
    client: getAddress(job.client),
    provider: getAddress(job.provider),
    evaluator: getAddress(job.evaluator),
    budget: job.budget.toString(),
    expiredAt: Number(job.expiredAt) * 1_000,
    status: Number(job.status),
    hook: getAddress(job.hook),
    submittedAt: job.submittedAt === 0n ? null : Number(job.submittedAt) * 1_000,
    deliverable: job.deliverable === ZERO_BYTES32 ? null : job.deliverable,
    firstSeenAt: nowMs,
    updatedAt: nowMs,
  };
}

function eventRow(chainId: CommerceIndexChainId, log: DecodedCommerceLog, blockTimestamp: number, nowMs: number) {
  const phase = EVENT_PHASES[log.eventName];
  if (phase === undefined) return null;
  const jobId = log.args.jobId;
  if (typeof jobId !== "bigint") return null;
  const address = (value: unknown): string | null => (typeof value === "string" ? getAddress(value) : null);
  const bytes = (value: unknown): string | null => (typeof value === "string" ? value : null);
  const actor = log.eventName === "JobCreated" || log.eventName === "JobFunded" ? address(log.args.client)
    : log.eventName === "JobSubmitted" ? address(log.args.provider)
      : log.eventName === "JobCompleted" ? address(log.args.evaluator)
        : log.eventName === "JobRejected" ? address(log.args.rejector)
          : null;
  return {
    chainId,
    jobId: Number(jobId),
    phase,
    eventName: log.eventName,
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    blockNumber: Number(log.blockNumber),
    blockTimestamp,
    actor,
    amount: log.eventName === "JobFunded" && typeof log.args.amount === "bigint" ? log.args.amount.toString() : null,
    deliverable: log.eventName === "JobSubmitted" ? bytes(log.args.deliverable) : null,
    reason: log.eventName === "JobCompleted" || log.eventName === "JobRejected" ? bytes(log.args.reason) : null,
    indexedAt: nowMs,
  };
}

async function readJobs(reader: CommerceIndexReader, chainId: CommerceIndexChainId, jobIds: readonly bigint[]): Promise<JobState[]> {
  const jobs: JobState[] = [];
  for (const batch of chunks(jobIds, JOB_READ_CHUNK)) {
    let results: readonly unknown[];
    try {
      results = await reader.multicall({
        contracts: batch.map((jobId) => ({
          address: DEPLOYMENTS[chainId].commerce,
          abi: commerceReadAbi,
          functionName: "getJob",
          args: [jobId],
        })),
        allowFailure: false,
      }) as readonly unknown[];
    } catch (error) {
      const chainError = nestedBscProbeError(error);
      if (chainError) throw chainError;
      throw new BscProbeError("BSC_READS");
    }
    for (const result of results) {
      if (!result || typeof result !== "object") throw new BscProbeError("BSC_READS");
      jobs.push(result as JobState);
    }
  }
  return jobs;
}

function upsertJobs(db: ReturnType<typeof createDatabase>, rows: ReturnType<typeof jobRow>[]) {
  return chunks(rows, ROW_CHUNK).map((chunk) => db.insert(commerceJobs).values(chunk).onConflictDoUpdate({
    target: [commerceJobs.chainId, commerceJobs.jobId],
    set: {
      client: sql.raw("excluded.client"),
      provider: sql.raw("excluded.provider"),
      evaluator: sql.raw("excluded.evaluator"),
      budget: sql.raw("excluded.budget"),
      expiredAt: sql.raw("excluded.expiredAt"),
      status: sql.raw("excluded.status"),
      hook: sql.raw("excluded.hook"),
      submittedAt: sql.raw("excluded.submittedAt"),
      deliverable: sql.raw("excluded.deliverable"),
      updatedAt: sql.raw("excluded.updatedAt"),
    },
  }));
}

function summaryStatement(
  db: ReturnType<typeof createDatabase>,
  chainId: CommerceIndexChainId,
  summary: CommerceIndexSummary,
  nowMs: number,
) {
  return db.insert(runtimeState).values({
    key: commerceSummaryKey(chainId),
    textValue: JSON.stringify(summary),
    integerValue: null,
    updatedAt: nowMs,
  }).onConflictDoUpdate({
    target: runtimeState.key,
    set: { textValue: JSON.stringify(summary), integerValue: null, updatedAt: nowMs },
  });
}

export async function runCommerceIndex(
  work: CommerceIndexWork,
  env: Env,
  config: WorkerConfig,
  dependencies: CommerceIndexDependencies = {},
): Promise<CommerceIndexSummary> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const chainId = work.chainId;
  const rpcUrl = chainId === 56 ? env.BSC_RPC_URL : env.BSC_TESTNET_RPC_URL;
  const reader = dependencies.createReader?.(chainId) ?? (() => {
    if (rpcUrl === undefined) throw new BscProbeError(chainId === 56 ? "BSC_RPC_URL_REQUIRED" : "BSC_TESTNET_RPC_URL_REQUIRED");
    return createCountedBscClient({
      rpcUrl,
      fetch: dependencies.fetchImpl ?? fetch,
      deadlineMs: startedAt + INDEX_RPC_DEADLINE_MS,
      now,
      chain: DEPLOYMENTS[chainId].chain,
      methods: COMMERCE_INDEX_RPC_METHODS,
      maxResponseBytes: INDEX_RPC_RESPONSE_BYTES,
    });
  })();
  const budgeted = createBudgetedD1Database(
    env.DB as unknown as D1DatabaseLike,
    config.d1QueriesPerRun - 2,
    { rowsRead: config.d1RowsReadPerRun, rowsWritten: config.d1RowsWrittenPerRun },
  );
  const db = createDatabase(budgeted.db);
  try {
    const summary = work.kind === "index_jobs"
      ? await indexJobs(work, chainId, reader, db, config, budgeted.budget, startedAt, now)
      : await indexRange(work, chainId, reader, db, config, env, budgeted.budget, startedAt, now);
    return summary;
  } catch (error) {
    const code = errorCode(error);
    try {
      await writeRuntimeState(createDatabase(env.DB as unknown as D1DatabaseLike), {
        key: commerceSummaryKey(chainId),
        textValue: JSON.stringify({ kind: work.kind, chainId, status: "error", errorCode: code, wallTimeMs: now() - startedAt }),
        integerValue: null,
        updatedAt: now(),
      });
    } catch {
      // The failure summary is telemetry; the rethrow below drives the retry.
    }
    throw Object.assign(new Error(code), { cause: error });
  }
}

async function indexJobs(
  work: Extract<CommerceIndexWork, { kind: "index_jobs" }>,
  chainId: CommerceIndexChainId,
  reader: CommerceIndexReader,
  db: ReturnType<typeof createDatabase>,
  config: WorkerConfig,
  budget: { readonly used: number },
  startedAt: number,
  now: () => number,
): Promise<CommerceIndexSummary> {
  if (work.toJobId - work.fromJobId + 1 > config.commerceIndexJobsPerRun) throw new Error("COMMERCE_INDEX_JOB_RANGE");
  const ids: bigint[] = [];
  for (let id = work.fromJobId; id <= work.toJobId; id += 1) ids.push(BigInt(id));
  const nowMs = now();
  const rows = (await readJobs(reader, chainId, ids))
    .filter((job) => !isAddressEqual(job.client, ZERO_ADDRESS))
    .map((job) => jobRow(chainId, job, nowMs));
  const summary: CommerceIndexSummary = {
    kind: "index_jobs", chainId, status: "ok", fromBlock: null, toBlock: null,
    logs: 0, jobs: rows.length, d1Queries: Math.ceil(rows.length / ROW_CHUNK) + 1, wallTimeMs: 0,
  };
  const statements = [...upsertJobs(db, rows), summaryStatement(db, chainId, { ...summary, wallTimeMs: now() - startedAt }, nowMs)];
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  return { ...summary, d1Queries: budget.used, wallTimeMs: now() - startedAt };
}

async function indexRange(
  work: Extract<CommerceIndexWork, { kind: "index_range" }>,
  chainId: CommerceIndexChainId,
  reader: CommerceIndexReader,
  db: ReturnType<typeof createDatabase>,
  config: WorkerConfig,
  env: Env,
  budget: { readonly used: number },
  startedAt: number,
  now: () => number,
): Promise<CommerceIndexSummary> {
  const cursorKey = commerceCursorKey(chainId);
  const cursorMode = work.fromBlock === null || work.toBlock === null;
  let fromBlock: bigint;
  let toBlock: bigint;
  if (cursorMode) {
    const [cursorRow] = await readRuntimeStates(db, [cursorKey]);
    const head = await reader.getBlockNumber();
    const safeHead = head - BigInt(config.commerceIndexFinalityBlocks);
    if (cursorRow === undefined || cursorRow.integerValue === null) {
      // First run: the cursor starts at the safe head and nothing older is
      // read (history is a backfill decision, not an implicit side effect).
      const start = safeHead < 0n ? 0n : safeHead;
      const nowMs = now();
      const summary: CommerceIndexSummary = {
        kind: "index_range", chainId, status: "initialized", fromBlock: Number(start), toBlock: Number(start),
        logs: 0, jobs: 0, d1Queries: 0, wallTimeMs: 0,
      };
      await db.batch([
        db.insert(runtimeState).values({ key: cursorKey, textValue: null, integerValue: Number(start), updatedAt: nowMs })
          .onConflictDoNothing(),
        summaryStatement(db, chainId, { ...summary, wallTimeMs: now() - startedAt }, nowMs),
      ] as unknown as Parameters<typeof db.batch>[0]);
      return { ...summary, d1Queries: budget.used, wallTimeMs: now() - startedAt };
    }
    fromBlock = BigInt(cursorRow.integerValue) + 1n;
    toBlock = fromBlock + BigInt(config.commerceIndexBlocksPerRun) - 1n;
    if (toBlock > safeHead) toBlock = safeHead;
    if (fromBlock > toBlock) {
      const nowMs = now();
      const summary: CommerceIndexSummary = {
        kind: "index_range", chainId, status: "idle", fromBlock: Number(fromBlock), toBlock: Number(safeHead),
        logs: 0, jobs: 0, d1Queries: 0, wallTimeMs: 0,
      };
      await db.batch([
        summaryStatement(db, chainId, { ...summary, wallTimeMs: now() - startedAt }, nowMs),
      ] as unknown as Parameters<typeof db.batch>[0]);
      return { ...summary, d1Queries: budget.used, wallTimeMs: now() - startedAt };
    }
  } else {
    fromBlock = BigInt(work.fromBlock!);
    toBlock = BigInt(work.toBlock!);
    if (toBlock - fromBlock + 1n > BigInt(config.commerceIndexBlocksPerRun)) throw new Error("COMMERCE_INDEX_BLOCK_RANGE");
  }

  let logs: DecodedCommerceLog[];
  try {
    logs = await reader.getLogs({
      address: DEPLOYMENTS[chainId].commerce,
      events: commerceEventsAbi,
      fromBlock,
      toBlock,
    }) as unknown as DecodedCommerceLog[];
  } catch (error) {
    const chainError = nestedBscProbeError(error);
    if (chainError) throw chainError;
    throw new BscProbeError("BSC_LOGS_RPC");
  }
  const truncated = truncateLogs(logs, {
    logs: config.commerceIndexLogsPerRun,
    blocks: config.commerceIndexBlockLookupsPerRun,
  }, toBlock);
  const indexedThrough = truncated.toBlock;
  const timestamps = new Map<bigint, number>();
  for (const log of truncated.included) {
    if (timestamps.has(log.blockNumber)) continue;
    let block: { timestamp: bigint };
    try {
      block = await reader.getBlock({ blockNumber: log.blockNumber });
    } catch (error) {
      const chainError = nestedBscProbeError(error);
      if (chainError) throw chainError;
      throw new BscProbeError("BSC_BLOCK_RPC");
    }
    timestamps.set(log.blockNumber, Number(block.timestamp) * 1_000);
  }
  const nowMs = now();
  const eventRows = truncated.included
    .map((log) => eventRow(chainId, log, timestamps.get(log.blockNumber) ?? 0, nowMs))
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const jobIds = [...new Set(eventRows.map((row) => row.jobId))].map((id) => BigInt(id));
  const jobRows = (await readJobs(reader, chainId, jobIds))
    .filter((job) => !isAddressEqual(job.client, ZERO_ADDRESS))
    .map((job) => jobRow(chainId, job, nowMs));

  const summary: CommerceIndexSummary = {
    kind: "index_range", chainId, status: "ok",
    fromBlock: Number(fromBlock), toBlock: Number(indexedThrough),
    logs: eventRows.length, jobs: jobRows.length,
    d1Queries: 0, wallTimeMs: 0,
  };
  const statements = [
    ...chunks(eventRows, ROW_CHUNK).map((chunk) => db.insert(commerceJobEvents).values(chunk).onConflictDoNothing()),
    ...upsertJobs(db, jobRows),
    ...(cursorMode ? [
      db.insert(runtimeState).values({ key: cursorKey, textValue: null, integerValue: Number(indexedThrough), updatedAt: nowMs })
        .onConflictDoUpdate({
          target: runtimeState.key,
          set: { integerValue: Number(indexedThrough), updatedAt: nowMs },
          setWhere: sql`${runtimeState.integerValue} IS NULL OR ${runtimeState.integerValue} < ${Number(indexedThrough)}`,
        }),
    ] : []),
    summaryStatement(db, chainId, { ...summary, wallTimeMs: now() - startedAt }, nowMs),
  ];
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

  if (!cursorMode && indexedThrough < toBlock) {
    // Explicit ranges are backfill work: the part that did not fit goes back
    // to the queue instead of being silently dropped.
    if (env.WP2_QUEUE === undefined) throw new Error("WP2_QUEUE_BINDING_REQUIRED");
    await env.WP2_QUEUE.send({
      schemaVersion: 2,
      kind: "index_range",
      chainId,
      fromBlock: Number(indexedThrough) + 1,
      toBlock: Number(toBlock),
      enqueuedAt: now(),
    });
  }
  return { ...summary, d1Queries: budget.used, wallTimeMs: now() - startedAt };
}
