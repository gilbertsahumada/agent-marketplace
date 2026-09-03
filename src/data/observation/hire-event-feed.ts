import { AsyncTtlCache } from "../cache/async-ttl-cache.ts";
import type { VerifiedHireEvent, VerifiedHirePhase } from "../../business/entities/verified-hire-event.ts";
import { catalogUrl } from "./catalog-candidate-feed.ts";

const cache = new AsyncTtlCache();
const CACHE_TTL_MS = 30_000;
const PHASES = ["created", "funded", "submitted", "settled", "refunded"] as const;
const AGENT_ID = /^[1-9]\d{0,19}$/;
const JOB_ID = /^(?:0|[1-9]\d{0,77})$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const BLOCK_NUMBER = /^\d{1,20}$/;

function invalid(): never {
  throw new Error("HIRE_EVENT_FEED_INVALID");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) invalid();
  return new Date(value).toISOString();
}

// Strict allowlist parser: unknown fields are dropped, malformed rows reject
// the whole response so a partial feed can never look like verified history.
export function parseVerifiedHireEvents(
  value: unknown,
  input: { chainId: 56 | 97; agentId: string },
): VerifiedHireEvent[] {
  const data = record(value);
  if (data.schemaVersion !== 1 || data.chainId !== input.chainId || data.agentId !== input.agentId
    || !Array.isArray(data.events)) invalid();
  return data.events.map((entry) => {
    const event = record(entry);
    if (!PHASES.includes(event.phase as VerifiedHirePhase)
      || typeof event.jobId !== "string" || !JOB_ID.test(event.jobId)
      || typeof event.txHash !== "string" || !TX_HASH.test(event.txHash)
      || typeof event.blockNumber !== "string" || !BLOCK_NUMBER.test(event.blockNumber)
      || (event.verifiedAt !== null && typeof event.verifiedAt !== "number")) invalid();
    return {
      chainId: input.chainId,
      agentId: input.agentId,
      phase: event.phase as VerifiedHirePhase,
      jobId: event.jobId,
      txHash: event.txHash as `0x${string}`,
      blockNumber: event.blockNumber,
      occurredAt: timestamp(event.occurredAt),
      verifiedAt: event.verifiedAt === null ? null : timestamp(event.verifiedAt),
    };
  });
}

// Reads the Worker's chain-verified hire events for one agent on one chain.
// Fails closed: any misconfiguration, transport failure or malformed payload
// yields null, and callers render the page exactly as without the feed.
export async function getVerifiedHireEvents(input: {
  chainId: 56 | 97;
  agentId: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<VerifiedHireEvent[] | null> {
  if (!AGENT_ID.test(input.agentId)) return null;
  const url = catalogUrl("/hire-events", input.env ?? process.env);
  if (!url) return null;
  url.searchParams.set("chainId", String(input.chainId));
  url.searchParams.set("agentId", input.agentId);
  try {
    return await cache.get(`hire-events:${url}`, CACHE_TTL_MS, async () => {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("HIRE_EVENT_FEED_UNAVAILABLE");
      return parseVerifiedHireEvents(await response.json(), input);
    });
  } catch {
    return null;
  }
}
