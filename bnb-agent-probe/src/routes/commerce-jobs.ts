import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import type { D1DatabaseLike } from "../db/client";
import { createDatabase, readRuntimeStates, type CommerceJobRow } from "../db/orm";
import {
  commerceJobCounts,
  commerceJobEvents,
  commerceJobs,
  HIRE_CHAIN_PHASES,
  type HireChainPhase,
  hireEvents,
} from "../db/schema";
import { commerceCursorKey, commerceSummaryKey } from "../phases/commerce-index";
import type { D1Database } from "../types";

/**
 * Public read surface of the Commerce indexer. Every response is indexed
 * on-chain state, never a marketplace claim: `marketplace: true` only says a
 * chain-verified hire event exists for the job, which is how "processed through
 * this marketplace" is derived without an attribution column.
 */

const STATUS_NAMES = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;
const LIST_LIMIT = 50;
const AGENT_ID = /^[1-9]\d{0,19}$/;
const JOB_ID = /^(?:0|[1-9]\d{0,15})$/;
const CACHE_HEADERS = {
  "cache-control": "public, max-age=30, stale-while-revalidate=60",
  "x-content-type-options": "nosniff",
};

function invalidRequest(): Response {
  return Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
}

function chainIdParameter(value: string | null): 56 | 97 | null {
  return value === "56" ? 56 : value === "97" ? 97 : null;
}

function jobIdParameter(value: string | null): number | null {
  if (value === null || !JOB_ID.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

// Every key at most once and every key known: a repeated key would otherwise
// read as one value here while forking the response-cache key upstream.
function queryKeysAllowed(url: URL, allowed: ReadonlySet<string>): boolean {
  const keys = [...url.searchParams.keys()];
  return new Set(keys).size === keys.length && keys.every((key) => allowed.has(key));
}

// Table-qualified on purpose: Drizzle renders column references in a select
// list unqualified, and inside the correlated subquery "jobId" would bind to
// hire_events instead of commerce_jobs.
const marketplaceFlag = sql<number>`EXISTS (
  SELECT 1 FROM hire_events h
  WHERE h.chainId = commerce_jobs.chainId
    AND h.jobId = CAST(commerce_jobs.jobId AS TEXT)
    AND h.provenance = 'chain_verified'
)`;

function publicJob(row: CommerceJobRow & { marketplace: number }) {
  return {
    jobId: String(row.jobId),
    client: row.client,
    provider: row.provider,
    budget: row.budget,
    status: row.status,
    expiredAt: row.expiredAt,
    submittedAt: row.submittedAt,
    marketplace: Boolean(row.marketplace),
    updatedAt: row.updatedAt,
  };
}

export async function commerceJobsListResponse(request: Request, d1: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const allowed = new Set(["chainId", "buyer", "provider", "agentId", "status", "limit", "before"]);
  if (!queryKeysAllowed(url, allowed)) return invalidRequest();
  const chainId = chainIdParameter(url.searchParams.get("chainId"));
  if (chainId === null) return invalidRequest();
  const buyer = url.searchParams.get("buyer");
  const provider = url.searchParams.get("provider");
  const agentId = url.searchParams.get("agentId");
  const status = url.searchParams.get("status");
  const limitRaw = url.searchParams.get("limit");
  const before = url.searchParams.get("before");
  if ([buyer, provider, agentId].filter((value) => value !== null).length > 1) return invalidRequest();
  if ((buyer !== null && !isAddress(buyer)) || (provider !== null && !isAddress(provider))) return invalidRequest();
  if (agentId !== null && !AGENT_ID.test(agentId)) return invalidRequest();
  if (status !== null && !(STATUS_NAMES as readonly string[]).includes(status)) return invalidRequest();
  if (limitRaw !== null && !/^[1-9]\d?$/.test(limitRaw)) return invalidRequest();
  const beforeJobId = before === null ? null : jobIdParameter(before);
  if (before !== null && beforeJobId === null) return invalidRequest();
  const limit = Math.min(limitRaw === null ? LIST_LIMIT : Number(limitRaw), LIST_LIMIT);

  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const conditions = [eq(commerceJobs.chainId, chainId)];
  if (buyer !== null) conditions.push(eq(commerceJobs.client, getAddress(buyer)));
  if (provider !== null) conditions.push(eq(commerceJobs.provider, getAddress(provider)));
  if (agentId !== null) {
    conditions.push(sql`${commerceJobs.jobId} IN (
      SELECT CAST(${hireEvents.jobId} AS INTEGER) FROM ${hireEvents}
      WHERE ${hireEvents.chainId} = ${chainId} AND ${hireEvents.agentId} = ${agentId}
        AND ${hireEvents.provenance} = 'chain_verified' AND ${hireEvents.jobId} IS NOT NULL
    )`);
  }
  if (status !== null) conditions.push(eq(commerceJobs.status, STATUS_NAMES.indexOf(status as typeof STATUS_NAMES[number])));
  if (beforeJobId !== null) conditions.push(lt(commerceJobs.jobId, beforeJobId));
  const rows = await db.select({
    chainId: commerceJobs.chainId,
    jobId: commerceJobs.jobId,
    client: commerceJobs.client,
    provider: commerceJobs.provider,
    evaluator: commerceJobs.evaluator,
    budget: commerceJobs.budget,
    expiredAt: commerceJobs.expiredAt,
    status: commerceJobs.status,
    hook: commerceJobs.hook,
    submittedAt: commerceJobs.submittedAt,
    deliverable: commerceJobs.deliverable,
    firstSeenAt: commerceJobs.firstSeenAt,
    updatedAt: commerceJobs.updatedAt,
    marketplace: marketplaceFlag,
  }).from(commerceJobs).where(and(...conditions)).orderBy(desc(commerceJobs.jobId)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return Response.json({
    schemaVersion: 1,
    chainId,
    jobs: page.map(publicJob),
    nextBefore: rows.length > limit && last !== undefined ? String(last.jobId) : null,
  }, { status: 200, headers: CACHE_HEADERS });
}

export async function commerceJobResponse(request: Request, d1: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/commerce-jobs\/(56|97)\/(0|[1-9]\d{0,15})$/.exec(url.pathname);
  if (match === null || url.search !== "") return invalidRequest();
  const chainId = Number(match[1]) as 56 | 97;
  const jobId = jobIdParameter(match[2] ?? null);
  if (jobId === null) return invalidRequest();
  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const [job] = await db.select({
    chainId: commerceJobs.chainId,
    jobId: commerceJobs.jobId,
    client: commerceJobs.client,
    provider: commerceJobs.provider,
    evaluator: commerceJobs.evaluator,
    budget: commerceJobs.budget,
    expiredAt: commerceJobs.expiredAt,
    status: commerceJobs.status,
    hook: commerceJobs.hook,
    submittedAt: commerceJobs.submittedAt,
    deliverable: commerceJobs.deliverable,
    firstSeenAt: commerceJobs.firstSeenAt,
    updatedAt: commerceJobs.updatedAt,
    marketplace: marketplaceFlag,
  }).from(commerceJobs).where(and(eq(commerceJobs.chainId, chainId), eq(commerceJobs.jobId, jobId))).limit(1);
  if (job === undefined) {
    return Response.json({ error: "not_found" }, {
      status: 404,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
  const [events, verified] = await Promise.all([
    db.select().from(commerceJobEvents)
      .where(and(eq(commerceJobEvents.chainId, chainId), eq(commerceJobEvents.jobId, jobId)))
      .orderBy(asc(commerceJobEvents.blockNumber), asc(commerceJobEvents.logIndex)),
    db.select({
      agentId: hireEvents.agentId,
      phase: hireEvents.phase,
      txHash: hireEvents.txHash,
      blockNumber: hireEvents.blockNumber,
      occurredAt: hireEvents.occurredAt,
      verifiedAt: hireEvents.verifiedAt,
    }).from(hireEvents).where(and(
      eq(hireEvents.chainId, chainId),
      eq(hireEvents.jobId, String(jobId)),
      eq(hireEvents.provenance, "chain_verified"),
    )).orderBy(asc(hireEvents.occurredAt), asc(hireEvents.id)),
  ]);
  return Response.json({
    schemaVersion: 1,
    chainId,
    job: {
      ...publicJob(job),
      evaluator: job.evaluator,
      hook: job.hook,
      deliverable: job.deliverable,
      firstSeenAt: job.firstSeenAt,
    },
    events: events.map((event) => ({
      phase: event.phase,
      eventName: event.eventName,
      txHash: event.txHash,
      logIndex: event.logIndex,
      blockNumber: String(event.blockNumber),
      occurredAt: event.blockTimestamp,
      actor: event.actor,
      amount: event.amount,
      deliverable: event.deliverable,
      reason: event.reason,
    })),
    marketplace: Boolean(job.marketplace),
    hireEvents: verified,
  }, { status: 200, headers: CACHE_HEADERS });
}

type Phase = HireChainPhase;
const ACTIVITY_DEFAULT_DAYS = 30;
const ACTIVITY_MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1_000;
// Day buckets move slowly; the worker's response cache and the browser share
// this window so the two cache-control headers agree.
export const COMMERCE_ACTIVITY_CACHE_SECONDS = 60;
const ACTIVITY_CACHE_HEADERS = {
  "cache-control": `public, max-age=${COMMERCE_ACTIVITY_CACHE_SECONDS}, stale-while-revalidate=${COMMERCE_ACTIVITY_CACHE_SECONDS}`,
  "x-content-type-options": "nosniff",
};

function emptyPhaseCounts(): Record<Phase, number> {
  return Object.fromEntries(HIRE_CHAIN_PHASES.map((phase) => [phase, 0])) as Record<Phase, number>;
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

// Phase events per UTC day for one chain over the last `days` calendar days
// ending today, optionally for one provider wallet or for the jobs a
// marketplace agent has chain-verified hire events on. `from` is the UTC
// midnight opening the oldest day so every bucket but today is complete;
// today runs up to `to`, the clock reading. Only events the indexer saw are
// counted: jobs backfilled from state have no ledger rows.
export async function commerceActivityResponse(request: Request, d1: D1Database, nowMs: number): Promise<Response> {
  const url = new URL(request.url);
  if (!queryKeysAllowed(url, new Set(["chainId", "days", "provider", "agentId"]))) return invalidRequest();
  const chainId = chainIdParameter(url.searchParams.get("chainId"));
  if (chainId === null) return invalidRequest();
  const daysRaw = url.searchParams.get("days");
  const provider = url.searchParams.get("provider");
  const agentId = url.searchParams.get("agentId");
  if (daysRaw !== null && (!/^[1-9]\d?$/.test(daysRaw) || Number(daysRaw) > ACTIVITY_MAX_DAYS)) return invalidRequest();
  if (provider !== null && agentId !== null) return invalidRequest();
  if (provider !== null && !isAddress(provider)) return invalidRequest();
  if (agentId !== null && !AGENT_ID.test(agentId)) return invalidRequest();
  const days = daysRaw === null ? ACTIVITY_DEFAULT_DAYS : Number(daysRaw);
  const to = nowMs;
  const from = startOfUtcDay(nowMs) - (days - 1) * DAY_MS;

  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const providerFilter = provider === null
    ? sql``
    : sql`AND EXISTS (
      SELECT 1 FROM commerce_jobs j
      WHERE j.chainId = e.chainId AND j.jobId = e.jobId AND j.provider = ${getAddress(provider)}
    )`;
  const agentFilter = agentId === null
    ? sql``
    : sql`AND e.jobId IN (
      SELECT CAST(h.jobId AS INTEGER) FROM hire_events h
      WHERE h.chainId = ${chainId} AND h.agentId = ${agentId}
        AND h.provenance = 'chain_verified' AND h.jobId IS NOT NULL
    )`;
  const rows = await db.all<{ day: string; phase: string; total: number }>(sql`
    SELECT date(e.blockTimestamp / 1000, 'unixepoch') AS day, e.phase AS phase, count(*) AS total
    FROM commerce_job_events e
    WHERE e.chainId = ${chainId} AND e.blockTimestamp >= ${from} AND e.blockTimestamp < ${to}
    ${providerFilter}
    ${agentFilter}
    GROUP BY day, e.phase
    ORDER BY day`);
  const byDay = new Map<string, Record<Phase, number>>();
  const totals = emptyPhaseCounts();
  for (const row of rows) {
    if (!(HIRE_CHAIN_PHASES as readonly string[]).includes(row.phase)) continue;
    const phase = row.phase as Phase;
    const counts = byDay.get(row.day) ?? emptyPhaseCounts();
    counts[phase] += Number(row.total);
    totals[phase] += Number(row.total);
    byDay.set(row.day, counts);
  }
  return Response.json({
    schemaVersion: 1,
    chainId,
    days,
    from,
    to,
    byDay: [...byDay.entries()].map(([day, counts]) => ({ day, ...counts })),
    totals,
  }, { status: 200, headers: ACTIVITY_CACHE_HEADERS });
}

function byStatus(rows: Array<{ status: number; total: number }>): { jobs: number; byStatus: Record<string, number> } {
  const counts = Object.fromEntries(STATUS_NAMES.map((name) => [name, 0])) as Record<string, number>;
  let jobs = 0;
  for (const row of rows) {
    const name = STATUS_NAMES[row.status];
    if (name === undefined) continue;
    counts[name] = Number(row.total);
    jobs += Number(row.total);
  }
  return { jobs, byStatus: counts };
}

export async function commerceSummaryResponse(request: Request, d1: D1Database): Promise<Response> {
  const url = new URL(request.url);
  if (!queryKeysAllowed(url, new Set(["chainId"]))) return invalidRequest();
  const chainId = chainIdParameter(url.searchParams.get("chainId"));
  if (chainId === null) return invalidRequest();
  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const [counts, runtime] = await Promise.all([
    db.select().from(commerceJobCounts).where(eq(commerceJobCounts.chainId, chainId)),
    readRuntimeStates(db, [commerceCursorKey(chainId), commerceSummaryKey(chainId)]),
  ]);
  const protocolRows = counts.map((row) => ({ status: row.status, total: row.protocolJobs }));
  const marketplaceRows = counts.map((row) => ({ status: row.status, total: row.marketplaceJobs }));
  const cursor = runtime.find((row) => row.key === commerceCursorKey(chainId));
  const summaryRow = runtime.find((row) => row.key === commerceSummaryKey(chainId));
  let lastIndexRun: { status: string; at: number } | null = null;
  if (summaryRow?.textValue) {
    try {
      const parsed: unknown = JSON.parse(summaryRow.textValue);
      const status = parsed && typeof parsed === "object" ? (parsed as { status?: unknown }).status : undefined;
      if (typeof status === "string" && /^[a-z_]{1,32}$/.test(status)) lastIndexRun = { status, at: summaryRow.updatedAt };
    } catch {
      lastIndexRun = null;
    }
  }
  return Response.json({
    schemaVersion: 1,
    chainId,
    indexedThrough: cursor?.integerValue === null || cursor?.integerValue === undefined
      ? null
      : { blockNumber: String(cursor.integerValue), at: cursor.updatedAt },
    protocol: byStatus(protocolRows),
    marketplace: byStatus(marketplaceRows),
    lastIndexRun,
  }, { status: 200, headers: CACHE_HEADERS });
}
