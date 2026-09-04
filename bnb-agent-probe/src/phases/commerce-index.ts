import { sql } from "drizzle-orm";
import { getAddress, isAddress, isAddressEqual, type Address, type Hash, type PublicClient } from "viem";

import {
  COMMERCE_EVENT_ROW_WRITES,
  COMMERCE_INDEX_ROW_CHUNK,
  COMMERCE_JOB_ROW_WRITES,
  commerceIndexJobsRowWrites,
  commerceIndexRangeRowWrites,
  type WorkerConfig,
} from "../config";
import type { D1DatabaseLike } from "../db/client";
import { chunks, createDatabase, readRuntimeStates, writeRuntimeState } from "../db/orm";
import {
  D1QueryBudgetExceededError,
  D1RowBudgetExceededError,
  createBudgetedD1Database,
  type BudgetedD1Database,
} from "../db/query-budget";
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
 *   the cursor and stops at the same safe head; if it has to be truncated, the
 *   remainder is re-enqueued (unless the producer kill switch is on).
 * - `index_jobs`: read `getJob()` for an id range and upsert `commerce_jobs`
 *   (state backfill; jobs whose client is the zero address do not exist).
 *
 * Two guards keep a run from stalling or overspending: the per-chain block
 * window (`commerce_window_<chain>`) halves whenever the provider rejects a
 * getLogs range and doubles back after a full-window success, and every batch
 * is reserved against the D1 rows_written budget before it is sent.
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

export type CommerceIndexLogger = Pick<Console, "info" | "error">;

export interface CommerceIndexDependencies {
  readonly createReader?: (chainId: CommerceIndexChainId) => CommerceIndexReader;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly logger?: CommerceIndexLogger;
}

export interface CommerceIndexSummary {
  readonly kind: CommerceIndexWork["kind"];
  readonly chainId: CommerceIndexChainId;
  readonly status: "ok" | "initialized" | "idle";
  readonly fromBlock: number | null;
  readonly toBlock: number | null;
  // Block range size this run asked the RPC for (null for index_jobs); the
  // persisted per-chain window shrinks on RPC failures and grows back on success.
  readonly window: number | null;
  readonly logs: number;
  readonly jobs: number;
  // getJob() reads that reverted or failed individually and were skipped.
  readonly jobsFailed: number;
  readonly d1Queries: number;
  // Stored summary: the rows_written reservation the batch was checked
  // against; returned summary: what D1 metered for the whole run.
  readonly d1RowsWritten: number;
  readonly wallTimeMs: number;
}

// D1 meters rows_written per table row *and* per index entry; the model (and
// the config invariant derived from it) lives next to the plan envelopes.
export const EVENT_ROW_WRITES = COMMERCE_EVENT_ROW_WRITES;
export const JOB_ROW_WRITES = COMMERCE_JOB_ROW_WRITES;

// What the failure path needs to know about a run that threw: the range it
// asked for (telemetry) and, after an RPC rejection of that range, the
// narrower window to persist so the next attempt asks for less.
interface RunContext {
  fromBlock: number | null;
  toBlock: number | null;
  window: number | null;
  narrowTo: number | null;
}

// getLogs failures that mean "this range was too much for the provider":
// a rejected/oversized/slow reply. Nothing else narrows the window.
const WINDOW_NARROWING_CODES: ReadonlySet<string> = new Set([
  "BSC_RPC_RESPONSE", "BSC_RPC_TIMEOUT", "BSC_RPC_HTTP", "BSC_LOGS_RPC",
]);

const ROW_CHUNK = COMMERCE_INDEX_ROW_CHUNK;
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

export function commerceWindowKey(chainId: CommerceIndexChainId): string {
  return `commerce_window_${chainId}`;
}

function windowStatement(db: ReturnType<typeof createDatabase>, chainId: CommerceIndexChainId, window: number, nowMs: number) {
  return db.insert(runtimeState).values({ key: commerceWindowKey(chainId), textValue: null, integerValue: window, updatedAt: nowMs })
    .onConflictDoUpdate({ target: runtimeState.key, set: { integerValue: window, updatedAt: nowMs } });
}

interface DecodedCommerceLog {
  readonly address?: string;
  readonly removed?: boolean;
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

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

// Job-controlled uint256 timestamps become INTEGER epoch milliseconds; anything
// past the safe integer range is pinned there instead of becoming a REAL.
function epochMs(seconds: bigint): number {
  const ms = seconds * 1_000n;
  return ms > MAX_SAFE_BIGINT ? Number.MAX_SAFE_INTEGER : Number(ms);
}

function jobRow(chainId: CommerceIndexChainId, job: JobState, nowMs: number) {
  return {
    chainId,
    jobId: Number(job.id),
    client: getAddress(job.client),
    provider: getAddress(job.provider),
    evaluator: getAddress(job.evaluator),
    budget: job.budget.toString(),
    expiredAt: epochMs(job.expiredAt),
    status: Number(job.status),
    hook: getAddress(job.hook),
    submittedAt: job.submittedAt === 0n ? null : epochMs(job.submittedAt),
    deliverable: job.deliverable === ZERO_BYTES32 ? null : job.deliverable,
    firstSeenAt: nowMs,
    updatedAt: nowMs,
  };
}

function eventRow(chainId: CommerceIndexChainId, log: DecodedCommerceLog, blockTimestamp: number, nowMs: number) {
  const phase = EVENT_PHASES[log.eventName];
  if (phase === undefined) return null;
  const jobId = log.args.jobId;
  // The ledger stores job ids as INTEGER; an id past the safe range cannot
  // round-trip, and no real Commerce job has one.
  if (typeof jobId !== "bigint" || jobId < 0n || jobId > MAX_SAFE_BIGINT) return null;
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

// getJob() for every id, pinned at `blockNumber` so job state never runs
// ahead of the ledger. One reverting read skips that job (counted) instead of
// failing the run; a transport failure surfacing per item still fails it.
// Pinned eth_call needs the provider to hold state for that block: cursor mode
// stays within the finality margin of head, a deep backfill needs archive state.
async function readJobs(
  reader: CommerceIndexReader,
  chainId: CommerceIndexChainId,
  jobIds: readonly bigint[],
  blockNumber: bigint,
): Promise<{ jobs: JobState[]; failed: number }> {
  const jobs: JobState[] = [];
  let failed = 0;
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
        allowFailure: true,
        blockNumber,
      }) as readonly unknown[];
    } catch (error) {
      const chainError = nestedBscProbeError(error);
      if (chainError) throw chainError;
      throw new BscProbeError("BSC_READS");
    }
    if (!Array.isArray(results)) throw new BscProbeError("BSC_READS");
    for (const item of results) {
      if (!item || typeof item !== "object") throw new BscProbeError("BSC_READS");
      const { status, result, error } = item as { status?: unknown; result?: unknown; error?: unknown };
      if (status === "failure") {
        const chainError = nestedBscProbeError(error);
        if (chainError) throw chainError;
        failed += 1;
        continue;
      }
      if (status !== "success" || !result || typeof result !== "object" || typeof (result as JobState).id !== "bigint") {
        throw new BscProbeError("BSC_READS");
      }
      jobs.push(result as JobState);
    }
  }
  return { jobs, failed };
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
  const context: RunContext = { fromBlock: null, toBlock: null, window: null, narrowTo: null };
  try {
    const summary = work.kind === "index_jobs"
      ? await indexJobs(work, chainId, reader, db, config, budgeted, startedAt, now)
      : await indexRange(work, chainId, reader, db, config, env, budgeted, context, dependencies.logger, startedAt, now);
    return { ...summary, d1Queries: budgeted.budget.used, d1RowsWritten: budgeted.usage.rowsWritten, wallTimeMs: now() - startedAt };
  } catch (error) {
    const code = errorCode(error);
    const raw = createDatabase(env.DB as unknown as D1DatabaseLike);
    try {
      await writeRuntimeState(raw, {
        key: commerceSummaryKey(chainId),
        textValue: JSON.stringify({
          kind: work.kind, chainId, status: "error", errorCode: code,
          fromBlock: context.fromBlock, toBlock: context.toBlock, window: context.window, wallTimeMs: now() - startedAt,
        }),
        integerValue: null,
        updatedAt: now(),
      });
      if (context.narrowTo !== null) {
        await writeRuntimeState(raw, { key: commerceWindowKey(chainId), textValue: null, integerValue: context.narrowTo, updatedAt: now() });
      }
    } catch {
      // The failure summary and the narrower window are best-effort telemetry
      // and hints; the rethrow below drives the retry.
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
  budgeted: BudgetedD1Database,
  startedAt: number,
  now: () => number,
): Promise<CommerceIndexSummary> {
  if (work.toJobId - work.fromJobId + 1 > config.commerceIndexJobsPerRun) throw new Error("COMMERCE_INDEX_JOB_RANGE");
  const ids: bigint[] = [];
  for (let id = work.fromJobId; id <= work.toJobId; id += 1) ids.push(BigInt(id));
  const nowMs = now();
  const head = await reader.getBlockNumber();
  const safeHead = head - BigInt(config.commerceIndexFinalityBlocks);
  const read = await readJobs(reader, chainId, ids, safeHead < 0n ? 0n : safeHead);
  const rows = read.jobs
    .filter((job) => !isAddressEqual(job.client, ZERO_ADDRESS))
    .map((job) => jobRow(chainId, job, nowMs));
  const summary: CommerceIndexSummary = {
    kind: "index_jobs", chainId, status: "ok", fromBlock: null, toBlock: null, window: null,
    logs: 0, jobs: rows.length, jobsFailed: read.failed, d1Queries: Math.ceil(rows.length / ROW_CHUNK) + 1,
    d1RowsWritten: commerceIndexJobsRowWrites(rows.length), wallTimeMs: 0,
  };
  const statements = [...upsertJobs(db, rows), summaryStatement(db, chainId, { ...summary, wallTimeMs: now() - startedAt }, nowMs)];
  await commit(db, budgeted, statements, summary.d1RowsWritten);
  return summary;
}

// Every write of a run lands in one batch, checked against the rows_written
// budget *before* it is sent: an over-budget run commits nothing (the cursor
// does not move) instead of committing and then failing its message.
async function commit(db: ReturnType<typeof createDatabase>, budgeted: BudgetedD1Database, statements: unknown[], rows: number): Promise<void> {
  budgeted.reserveRowsWritten(rows);
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
}

async function indexRange(
  work: Extract<CommerceIndexWork, { kind: "index_range" }>,
  chainId: CommerceIndexChainId,
  reader: CommerceIndexReader,
  db: ReturnType<typeof createDatabase>,
  config: WorkerConfig,
  env: Env,
  budgeted: BudgetedD1Database,
  context: RunContext,
  logger: CommerceIndexLogger | undefined,
  startedAt: number,
  now: () => number,
): Promise<CommerceIndexSummary> {
  const cursorKey = commerceCursorKey(chainId);
  const windowKey = commerceWindowKey(chainId);
  const cursorMode = work.fromBlock === null || work.toBlock === null;
  const rows = await readRuntimeStates(db, cursorMode ? [cursorKey, windowKey] : [windowKey]);
  const cursorRow = rows.find((row) => row.key === cursorKey);
  const persisted = rows.find((row) => row.key === windowKey)?.integerValue ?? null;
  const window = Math.min(
    config.commerceIndexBlocksPerRun,
    persisted !== null && Number.isSafeInteger(persisted) && persisted >= 1 ? persisted : config.commerceIndexBlocksPerRun,
  );
  context.window = window;
  const head = await reader.getBlockNumber();
  const safeHead = head - BigInt(config.commerceIndexFinalityBlocks);
  let fromBlock: bigint;
  let toBlock: bigint;
  // Explicit mode: the requested range clamped to the safe head; the part a
  // run could not cover is re-enqueued up to here.
  let rangeEnd: bigint;
  if (cursorMode) {
    if (cursorRow === undefined || cursorRow.integerValue === null) {
      // First run: the cursor starts at the safe head and nothing older is
      // read (history is a backfill decision, not an implicit side effect).
      const start = safeHead < 0n ? 0n : safeHead;
      const nowMs = now();
      const summary: CommerceIndexSummary = {
        kind: "index_range", chainId, status: "initialized", fromBlock: Number(start), toBlock: Number(start), window,
        logs: 0, jobs: 0, jobsFailed: 0, d1Queries: 0, d1RowsWritten: commerceIndexRangeRowWrites(0, 0, 2), wallTimeMs: 0,
      };
      await commit(db, budgeted, [
        db.insert(runtimeState).values({ key: cursorKey, textValue: null, integerValue: Number(start), updatedAt: nowMs })
          .onConflictDoNothing(),
        summaryStatement(db, chainId, { ...summary, wallTimeMs: now() - startedAt }, nowMs),
      ], summary.d1RowsWritten);
      return summary;
    }
    fromBlock = BigInt(cursorRow.integerValue) + 1n;
    toBlock = fromBlock + BigInt(window) - 1n;
    if (toBlock > safeHead) toBlock = safeHead;
    if (fromBlock > toBlock) {
      const nowMs = now();
      const summary: CommerceIndexSummary = {
        kind: "index_range", chainId, status: "idle", fromBlock: Number(fromBlock), toBlock: Number(safeHead), window,
        logs: 0, jobs: 0, jobsFailed: 0, d1Queries: 0, d1RowsWritten: commerceIndexRangeRowWrites(0, 0, 1), wallTimeMs: 0,
      };
      await commit(db, budgeted, [summaryStatement(db, chainId, { ...summary, wallTimeMs: now() - startedAt }, nowMs)], summary.d1RowsWritten);
      return summary;
    }
    rangeEnd = toBlock;
  } else {
    fromBlock = BigInt(work.fromBlock!);
    toBlock = BigInt(work.toBlock!);
    if (toBlock - fromBlock + 1n > BigInt(config.commerceIndexBlocksPerRun)) throw new Error("COMMERCE_INDEX_BLOCK_RANGE");
    // Backfills stop at the safe head like the cursor does: the ledger is
    // append-only (no_update/no_delete triggers), so an unfinalized log that
    // gets reorged could only be removed by dropping those triggers in a
    // migration. Blocks past the safe head belong to cursor mode.
    if (fromBlock > safeHead) throw new Error("COMMERCE_INDEX_BLOCK_RANGE");
    if (toBlock > safeHead) toBlock = safeHead;
    rangeEnd = toBlock;
    // A narrowed window also bounds backfill ranges; the rest is re-enqueued.
    if (toBlock - fromBlock + 1n > BigInt(window)) toBlock = fromBlock + BigInt(window) - 1n;
  }
  context.fromBlock = Number(fromBlock);
  context.toBlock = Number(toBlock);
  const asked = Number(toBlock - fromBlock + 1n);

  let logs: DecodedCommerceLog[];
  try {
    logs = await reader.getLogs({
      address: DEPLOYMENTS[chainId].commerce,
      events: commerceEventsAbi,
      fromBlock,
      toBlock,
    }) as unknown as DecodedCommerceLog[];
  } catch (error) {
    const chainError = nestedBscProbeError(error) ?? new BscProbeError("BSC_LOGS_RPC");
    // The provider could not serve this range: ask for half next time. One
    // block whose logs alone exceed the reply cap cannot be narrowed further
    // and stays a manual (smaller LOGS cap / archive RPC) recovery.
    if (WINDOW_NARROWING_CODES.has(chainError.code)) context.narrowTo = Math.max(1, Math.floor(asked / 2));
    throw chainError;
  }
  // Only logs the Commerce contract emitted and that are still canonical:
  // the filter is what makes the append-only ledger safe to trust.
  const commerce = DEPLOYMENTS[chainId].commerce;
  logs = logs.filter((log) => log.removed !== true
    && typeof log.address === "string" && isAddress(log.address) && isAddressEqual(log.address, commerce));
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
  const read = await readJobs(reader, chainId, jobIds, indexedThrough);
  const jobRows = read.jobs
    .filter((job) => !isAddressEqual(job.client, ZERO_ADDRESS))
    .map((job) => jobRow(chainId, job, nowMs));

  // A narrowed window grows back (doubling, capped at the configured size)
  // only after a cursor run that exercised the whole window succeeded.
  const grownWindow = cursorMode && window < config.commerceIndexBlocksPerRun && asked === window
    ? Math.min(window * 2, config.commerceIndexBlocksPerRun)
    : null;
  const runtimeStateWrites = (cursorMode ? 1 : 0) + (grownWindow !== null ? 1 : 0) + 1;
  const summary: CommerceIndexSummary = {
    kind: "index_range", chainId, status: "ok",
    fromBlock: Number(fromBlock), toBlock: Number(indexedThrough), window,
    logs: eventRows.length, jobs: jobRows.length, jobsFailed: read.failed,
    d1Queries: 0,
    d1RowsWritten: commerceIndexRangeRowWrites(eventRows.length, jobRows.length, runtimeStateWrites),
    wallTimeMs: 0,
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
    ...(grownWindow !== null ? [windowStatement(db, chainId, grownWindow, nowMs)] : []),
    summaryStatement(db, chainId, { ...summary, wallTimeMs: now() - startedAt }, nowMs),
  ];
  await commit(db, budgeted, statements, summary.d1RowsWritten);

  if (!cursorMode && indexedThrough < rangeEnd) {
    // Explicit ranges are backfill work: the part that did not fit goes back
    // to the queue instead of being silently dropped, unless the producer
    // kill switch is on: then nothing new enters the queue from anywhere.
    const remainder = { chainId, fromBlock: Number(indexedThrough) + 1, toBlock: Number(rangeEnd) };
    if (config.producerKillSwitch) {
      logger?.info("commerce.index.remainder_dropped", remainder);
    } else {
      if (env.WP2_QUEUE === undefined) throw new Error("WP2_QUEUE_BINDING_REQUIRED");
      await env.WP2_QUEUE.send({ schemaVersion: 2, kind: "index_range", ...remainder, enqueuedAt: now() });
    }
  }
  return summary;
}
