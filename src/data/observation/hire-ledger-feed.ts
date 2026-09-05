import { AsyncTtlCache } from "../cache/async-ttl-cache.ts";
import {
  HIRE_ACTIVITY_CACHE_SECONDS,
  type HireActivity,
  type HireActivityCounts,
  type HireAddress,
  type HireChainId,
  type HireJob,
  type HireJobDetail,
  type HireJobEvent,
  type HireJobPage,
  type HireJobStatus,
  type HireJobTotals,
  type HireLedgerCounts,
  type HireLedgerSummary,
} from "../../business/entities/hire-job.ts";
import { HIRE_PHASES, type VerifiedHireEvent, type VerifiedHirePhase } from "../../business/entities/verified-hire-event.ts";
import { MarketplaceDataUnavailableError } from "../../business/errors/marketplace-errors.ts";
import { catalogUrl } from "./catalog-candidate-feed.ts";

// Reads the Worker's Commerce indexer (`/commerce-jobs`, `/commerce-summary`,
// `/commerce-activity`).
// Same posture as the hire-event feed: strict allowlist parsers, a short cache
// matching the Worker's own, and nothing partial ever renders as on-chain
// state. Lists and the summary answer null on any failure; the single-job
// reader keeps "not indexed" (null) apart from "cannot read the ledger"
// (MarketplaceDataUnavailableError) because callers turn the first into a 404.

// Clock read through the global so tests can drive it with fake timers.
const cache = new AsyncTtlCache(() => Date.now());
const CACHE_TTL_MS = 30_000;
// The activity window's cache decision lives with the entity so the HTTP
// header and this TTL agree.
const ACTIVITY_TTL_MS = HIRE_ACTIVITY_CACHE_SECONDS * 1000;
const MAX_ACTIVITY_DAYS = 90;
const MISS_TTL_MS = 10_000;
const MAX_MISSES = 256;
const misses = new Map<string, number>();
const STATUS_NAMES: readonly HireJobStatus[] = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"];
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const AGENT_ID = /^[1-9]\d{0,19}$/;
const JOB_ID = /^(?:0|[1-9]\d{0,15})$/;
const BLOCK_NUMBER = /^\d{1,20}$/;
const DECIMAL = /^\d{1,78}$/;
const UTC_DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

type Env = Readonly<Record<string, string | undefined>>;

function invalid(): never {
  throw new Error("HIRE_LEDGER_FEED_INVALID");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) invalid();
  return new Date(value).toISOString();
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function address(value: unknown): HireAddress {
  if (typeof value !== "string" || !ADDRESS.test(value)) invalid();
  return value as HireAddress;
}

function optionalString(value: unknown, pattern: RegExp): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !pattern.test(value)) invalid();
  return value;
}

function chainId(value: unknown, expected: HireChainId): HireChainId {
  if (value !== expected) invalid();
  return expected;
}

function status(value: unknown): HireJobStatus {
  if (typeof value !== "number" || !Number.isInteger(value)) invalid();
  const name = STATUS_NAMES[value];
  if (name === undefined) invalid();
  return name;
}

function job(entry: unknown, chain: HireChainId): HireJob {
  const value = record(entry);
  if (typeof value.jobId !== "string" || !JOB_ID.test(value.jobId)) invalid();
  if (typeof value.budget !== "string" || !DECIMAL.test(value.budget)) invalid();
  if (typeof value.marketplace !== "boolean") invalid();
  return {
    chainId: chain,
    jobId: value.jobId,
    buyer: address(value.client),
    provider: address(value.provider),
    budgetRaw: value.budget,
    status: status(value.status),
    expiresAt: timestamp(value.expiredAt),
    submittedAt: optionalTimestamp(value.submittedAt),
    marketplace: value.marketplace,
    updatedAt: timestamp(value.updatedAt),
  };
}

function event(entry: unknown): HireJobEvent {
  const value = record(entry);
  if (!HIRE_PHASES.includes(value.phase as VerifiedHirePhase) || typeof value.eventName !== "string") invalid();
  if (typeof value.txHash !== "string" || !TX_HASH.test(value.txHash)) invalid();
  if (typeof value.logIndex !== "number" || !Number.isSafeInteger(value.logIndex) || value.logIndex < 0) invalid();
  if (typeof value.blockNumber !== "string" || !BLOCK_NUMBER.test(value.blockNumber)) invalid();
  return {
    phase: value.phase as VerifiedHirePhase,
    eventName: value.eventName,
    txHash: value.txHash as HireAddress,
    logIndex: value.logIndex,
    blockNumber: value.blockNumber,
    occurredAt: timestamp(value.occurredAt),
    actor: value.actor === null ? null : address(value.actor),
    amount: optionalString(value.amount, DECIMAL),
    deliverable: optionalString(value.deliverable, /^0x[0-9a-fA-F]{64}$/),
    reason: optionalString(value.reason, /^0x[0-9a-fA-F]{64}$/),
  };
}

function verifiedEvent(entry: unknown, chain: HireChainId, jobId: string): VerifiedHireEvent {
  const value = record(entry);
  if (typeof value.agentId !== "string" || !AGENT_ID.test(value.agentId)) invalid();
  if (!HIRE_PHASES.includes(value.phase as VerifiedHirePhase)) invalid();
  if (typeof value.txHash !== "string" || !TX_HASH.test(value.txHash)) invalid();
  if (typeof value.blockNumber !== "string" || !BLOCK_NUMBER.test(value.blockNumber)) invalid();
  return {
    chainId: chain,
    agentId: value.agentId,
    phase: value.phase as VerifiedHirePhase,
    jobId,
    txHash: value.txHash as HireAddress,
    blockNumber: value.blockNumber,
    occurredAt: timestamp(value.occurredAt),
    verifiedAt: optionalTimestamp(value.verifiedAt),
  };
}

function counts(entry: unknown): HireLedgerCounts {
  const value = record(entry);
  const byStatus = record(value.byStatus);
  const result = {} as Record<HireJobStatus, number>;
  for (const name of STATUS_NAMES) {
    const count = byStatus[name];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) invalid();
    result[name] = count;
  }
  if (typeof value.jobs !== "number" || !Number.isSafeInteger(value.jobs) || value.jobs < 0) invalid();
  return { jobs: value.jobs, byStatus: result };
}

export function parseHireJobPage(value: unknown, chain: HireChainId): HireJobPage {
  const data = record(value);
  if (data.schemaVersion !== 1 || !Array.isArray(data.jobs)) invalid();
  if (data.nextBefore !== null && (typeof data.nextBefore !== "string" || !JOB_ID.test(data.nextBefore))) invalid();
  return {
    chainId: chainId(data.chainId, chain),
    jobs: data.jobs.map((entry) => job(entry, chain)),
    nextBefore: data.nextBefore as string | null,
    ...(data.totals === undefined ? {} : { totals: parseJobTotals(data.totals) }),
  };
}

function parseJobTotals(value: unknown): HireJobTotals {
  const raw = record(value);
  for (const key of ["total", "completed", "funded", "submitted"] as const) {
    if (typeof raw[key] !== "number" || !Number.isSafeInteger(raw[key]) || raw[key] < 0) invalid();
  }
  const totals = { total: raw.total, completed: raw.completed, funded: raw.funded, submitted: raw.submitted } as HireJobTotals;
  if (totals.completed + totals.funded + totals.submitted > totals.total) invalid();
  return totals;
}

export function parseHireJobDetail(value: unknown, chain: HireChainId): HireJobDetail {
  const data = record(value);
  if (data.schemaVersion !== 1 || !Array.isArray(data.events) || !Array.isArray(data.hireEvents)) invalid();
  chainId(data.chainId, chain);
  const raw = record(data.job);
  const base = job(raw, chain);
  return {
    ...base,
    evaluator: address(raw.evaluator),
    hook: address(raw.hook),
    deliverable: optionalString(raw.deliverable, /^0x[0-9a-fA-F]{64}$/),
    firstSeenAt: timestamp(raw.firstSeenAt),
    events: data.events.map(event),
    hireEvents: data.hireEvents.map((entry) => verifiedEvent(entry, chain, base.jobId)),
  };
}

export function parseHireLedgerSummary(value: unknown, chain: HireChainId): HireLedgerSummary {
  const data = record(value);
  if (data.schemaVersion !== 1) invalid();
  let indexedThrough: HireLedgerSummary["indexedThrough"] = null;
  if (data.indexedThrough !== null) {
    const through = record(data.indexedThrough);
    if (typeof through.blockNumber !== "string" || !BLOCK_NUMBER.test(through.blockNumber)) invalid();
    indexedThrough = { blockNumber: through.blockNumber, at: timestamp(through.at) };
  }
  let lastIndexRun: HireLedgerSummary["lastIndexRun"] = null;
  if (data.lastIndexRun !== null) {
    const run = record(data.lastIndexRun);
    if (typeof run.status !== "string" || !/^[a-z_]{1,32}$/.test(run.status)) invalid();
    lastIndexRun = { status: run.status, at: timestamp(run.at) };
  }
  return {
    chainId: chainId(data.chainId, chain),
    indexedThrough,
    protocol: counts(data.protocol),
    marketplace: counts(data.marketplace),
    lastIndexRun,
  };
}

function activityDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_ACTIVITY_DAYS) invalid();
  return value;
}

// Exactly the five phases, each a non-negative integer; an unknown phase is a
// contract drift, not something to pass through.
function activityCounts(entry: unknown): HireActivityCounts {
  const value = record(entry);
  for (const key of Object.keys(value)) {
    if (!HIRE_PHASES.includes(key as VerifiedHirePhase)) invalid();
  }
  const result = {} as HireActivityCounts;
  for (const phase of HIRE_PHASES) {
    const count = value[phase];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) invalid();
    result[phase] = count;
  }
  return result;
}

export function parseHireActivity(value: unknown, chain: HireChainId): HireActivity {
  const data = record(value);
  if (data.schemaVersion !== 1 || !Array.isArray(data.byDay)) invalid();
  if (typeof data.from !== "number" || typeof data.to !== "number" || data.from > data.to) invalid();
  return {
    chainId: chainId(data.chainId, chain),
    days: activityDays(data.days),
    from: timestamp(data.from),
    to: timestamp(data.to),
    byDay: data.byDay.map((entry) => {
      const { day, ...counts } = record(entry);
      if (typeof day !== "string" || !UTC_DAY.test(day)) invalid();
      return { day, ...activityCounts(counts) };
    }),
    totals: activityCounts(data.totals),
  };
}

class HireLedgerMissError extends Error {
  constructor() {
    super("HIRE_LEDGER_NOT_FOUND");
    this.name = "HireLedgerMissError";
  }
}

function rememberMiss(key: string): void {
  const now = Date.now();
  for (const [candidate, expiresAt] of misses) {
    if (expiresAt <= now) misses.delete(candidate);
  }
  while (misses.size >= MAX_MISSES) {
    const oldest = misses.keys().next().value;
    if (oldest === undefined) break;
    misses.delete(oldest);
  }
  misses.set(key, now + MISS_TTL_MS);
}

// Successful reads are cached for the Worker's own window; failures are not,
// so the next call retries. A 404 surfaces as HireLedgerMissError.
async function read<T>(key: string, url: URL, parse: (value: unknown) => T, ttlMs = CACHE_TTL_MS): Promise<T> {
  return cache.get(key, ttlMs, async () => {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404) throw new HireLedgerMissError();
    if (!response.ok) throw new Error("HIRE_LEDGER_FEED_UNAVAILABLE");
    return parse(await response.json());
  });
}

async function readOrNull<T>(key: string, url: URL, parse: (value: unknown) => T, ttlMs = CACHE_TTL_MS): Promise<T | null> {
  try {
    return await read(key, url, parse, ttlMs);
  } catch {
    return null;
  }
}

// The Worker checks addresses with a strict EIP-55 test, which rejects a
// mixed-case address whose checksum does not match. The marketplace accepts any
// 0x + 40 hex input, so filters go out lowercased: still the same account, and
// a form the Worker always accepts.
function queryAddress(value: HireAddress): string {
  return value.toLowerCase();
}

// At most one identity filter; the Worker rejects two with 400, the reader
// refuses before any request.
export async function getHireJobs(input: {
  chainId: HireChainId;
  buyer?: HireAddress;
  provider?: HireAddress;
  agentId?: string;
  before?: string;
  env?: Env;
}): Promise<HireJobPage | null> {
  const filters = [input.buyer, input.provider, input.agentId].filter((value) => value !== undefined);
  if (filters.length > 1) return null;
  if (input.buyer !== undefined && !ADDRESS.test(input.buyer)) return null;
  if (input.provider !== undefined && !ADDRESS.test(input.provider)) return null;
  if (input.agentId !== undefined && !AGENT_ID.test(input.agentId)) return null;
  if (input.before !== undefined && !JOB_ID.test(input.before)) return null;
  const url = catalogUrl("/commerce-jobs", input.env ?? process.env);
  if (!url) return null;
  url.searchParams.set("chainId", String(input.chainId));
  url.searchParams.set("limit", "25");
  if (input.buyer !== undefined) url.searchParams.set("buyer", queryAddress(input.buyer));
  if (input.provider !== undefined) url.searchParams.set("provider", queryAddress(input.provider));
  if (input.agentId !== undefined) url.searchParams.set("agentId", input.agentId);
  if (input.before !== undefined) url.searchParams.set("before", input.before);
  return readOrNull(`commerce-jobs:${url}`, url, (value) => parseHireJobPage(value, input.chainId));
}

// null means the Worker has no row for the job (a miss, remembered briefly so
// an unknown id does not cost a round-trip per view); every other failure,
// including a missing or non-https OBSERVATIONS_URL, throws
// MarketplaceDataUnavailableError so it is never reported as "not found".
export async function getHireJob(input: { chainId: HireChainId; jobId: string; env?: Env }): Promise<HireJobDetail | null> {
  if (!JOB_ID.test(input.jobId)) return null;
  const url = catalogUrl(`/commerce-jobs/${input.chainId}/${input.jobId}`, input.env ?? process.env);
  if (!url) throw new MarketplaceDataUnavailableError("hire ledger job");
  const key = `commerce-job:${url}`;
  const missedUntil = misses.get(key);
  if (missedUntil !== undefined && missedUntil > Date.now()) return null;
  misses.delete(key);
  try {
    return await read(key, url, (value) => {
      const detail = parseHireJobDetail(value, input.chainId);
      if (detail.jobId !== input.jobId) invalid();
      return detail;
    });
  } catch (error) {
    if (error instanceof HireLedgerMissError) {
      rememberMiss(key);
      return null;
    }
    throw new MarketplaceDataUnavailableError("hire ledger job", { cause: error });
  }
}

export async function getHireLedgerSummary(input: { chainId: HireChainId; env?: Env }): Promise<HireLedgerSummary | null> {
  const url = catalogUrl("/commerce-summary", input.env ?? process.env);
  if (!url) return null;
  url.searchParams.set("chainId", String(input.chainId));
  return readOrNull(`commerce-summary:${url}`, url, (value) => parseHireLedgerSummary(value, input.chainId));
}

// Phase events per UTC day over the trailing window. `days` is sent only when
// given (absent means the Worker's default, so the default read shares one
// cache entry). At most one identity filter, like the job list; every failure,
// including an unconfigured origin, answers null.
export async function getHireActivity(input: {
  chainId: HireChainId;
  days?: number;
  provider?: HireAddress;
  agentId?: string;
  env?: Env;
}): Promise<HireActivity | null> {
  if (input.provider !== undefined && input.agentId !== undefined) return null;
  if (input.provider !== undefined && !ADDRESS.test(input.provider)) return null;
  if (input.agentId !== undefined && !AGENT_ID.test(input.agentId)) return null;
  if (input.days !== undefined && (!Number.isSafeInteger(input.days) || input.days < 1 || input.days > MAX_ACTIVITY_DAYS)) return null;
  const url = catalogUrl("/commerce-activity", input.env ?? process.env);
  if (!url) return null;
  url.searchParams.set("chainId", String(input.chainId));
  if (input.days !== undefined) url.searchParams.set("days", String(input.days));
  if (input.provider !== undefined) url.searchParams.set("provider", queryAddress(input.provider));
  if (input.agentId !== undefined) url.searchParams.set("agentId", input.agentId);
  return readOrNull(`commerce-activity:${url}`, url, (value) => parseHireActivity(value, input.chainId), ACTIVITY_TTL_MS);
}
