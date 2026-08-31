import { and, desc, eq } from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import { appendCatalogObservation, createDatabase } from "../db/orm";
import { catalogAgentEndpoints, catalogEndpoints, catalogObservations } from "../db/schema";
import type { D1Database } from "../types";

const MAX_BODY_BYTES = 4_096;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_EXPIRY_MS = 24 * 60 * 60_000;
const REPORT_COOLDOWN_MS = 10_000;
const HASH = /^[0-9a-f]{64}$/;
const AGENT_ID = /^[1-9]\d*$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const PROTOCOLS = new Set(["a2a", "mcp", "erc8183_http"]);
const SOURCES = new Set(["browser_reported"]);
const OUTCOMES = new Set([
  "protocol_valid", "cors_blocked", "http_error", "timeout", "network_error",
  "invalid_response", "unsafe_url", "unreachable", "error",
]);
const KEYS = [
  "agentId", "details", "durationMs", "endpointKey", "errorCode", "expiresAt",
  "httpStatus", "observedAt", "outcome", "protocol", "schemaVersion", "source",
] as const;
const DETAIL_KEYS = ["capabilityCount", "cors", "method"] as const;

interface CatalogObservationInput {
  schemaVersion: 2;
  source: "browser_reported";
  agentId: string;
  endpointKey: string;
  protocol: "a2a" | "mcp" | "erc8183_http";
  outcome: string;
  observedAt: number;
  expiresAt: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  durationMs: number;
  details: { capabilityCount?: number; cors?: boolean; method?: "GET" | "POST" };
}

class InvalidCatalogObservation extends Error {}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function closedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseDetails(raw: unknown): CatalogObservationInput["details"] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new InvalidCatalogObservation();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !DETAIL_KEYS.includes(key as typeof DETAIL_KEYS[number]))) {
    throw new InvalidCatalogObservation();
  }
  if (value.capabilityCount !== undefined && (!integer(value.capabilityCount) || value.capabilityCount > 10_000)) {
    throw new InvalidCatalogObservation();
  }
  if (value.cors !== undefined && typeof value.cors !== "boolean") throw new InvalidCatalogObservation();
  if (value.method !== undefined && value.method !== "GET" && value.method !== "POST") {
    throw new InvalidCatalogObservation();
  }
  return value as CatalogObservationInput["details"];
}

function parseInput(raw: unknown, now: number): CatalogObservationInput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new InvalidCatalogObservation();
  const value = raw as Record<string, unknown>;
  if (!closedKeys(value, KEYS)
    || value.schemaVersion !== 2
    || typeof value.source !== "string" || !SOURCES.has(value.source)
    || typeof value.agentId !== "string" || !AGENT_ID.test(value.agentId)
    || typeof value.endpointKey !== "string" || !HASH.test(value.endpointKey)
    || typeof value.protocol !== "string" || !PROTOCOLS.has(value.protocol)
    || typeof value.outcome !== "string" || !OUTCOMES.has(value.outcome)
    || !integer(value.observedAt) || Math.abs(value.observedAt - now) > MAX_CLOCK_SKEW_MS
    || !integer(value.durationMs) || value.durationMs > 60_000
    || (value.expiresAt !== null && (!integer(value.expiresAt) || value.expiresAt < value.observedAt
      || value.expiresAt - value.observedAt > MAX_EXPIRY_MS))
    || (value.httpStatus !== null && (!integer(value.httpStatus, 100) || value.httpStatus > 599))
    || (value.errorCode !== null && (typeof value.errorCode !== "string" || !ERROR_CODE.test(value.errorCode)))) {
    throw new InvalidCatalogObservation();
  }
  return { ...value, details: parseDetails(value.details) } as CatalogObservationInput;
}

async function boundedJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new InvalidCatalogObservation();
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new InvalidCatalogObservation();
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new InvalidCatalogObservation();
  try { return JSON.parse(body) as unknown; } catch { throw new InvalidCatalogObservation(); }
}

export async function catalogObservationResponse(
  request: Request,
  d1: D1Database,
  now: number,
): Promise<Response> {
  let input: CatalogObservationInput;
  try {
    input = parseInput(await boundedJson(request), now);
  } catch {
    return Response.json({ error: "invalid_request" }, {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const agentKey = `eip155:56:${input.agentId}`;
  const targets = await db.select({ endpointKey: catalogEndpoints.endpointKey })
    .from(catalogAgentEndpoints)
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgentEndpoints.agentKey, agentKey),
      eq(catalogAgentEndpoints.endpointKey, input.endpointKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
      eq(catalogEndpoints.validationProtocol, input.protocol),
    )).limit(1);
  if (targets.length === 0) {
    return Response.json({ error: "target_unavailable" }, {
      status: 409,
      headers: { "cache-control": "no-store" },
    });
  }
  const latest = await db.select({ observedAt: catalogObservations.observedAt })
    .from(catalogObservations).where(and(
      eq(catalogObservations.agentKey, agentKey),
      eq(catalogObservations.endpointKey, input.endpointKey),
      eq(catalogObservations.source, "browser_reported"),
      eq(catalogObservations.validationKind, "protocol"),
    )).orderBy(desc(catalogObservations.observedAt), desc(catalogObservations.id)).limit(1);
  if (latest[0] && latest[0].observedAt > now - REPORT_COOLDOWN_MS) {
    const retryAfterMs = latest[0].observedAt + REPORT_COOLDOWN_MS - now;
    return Response.json({ error: "rate_limited", retryAfterMs }, {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": String(Math.ceil(retryAfterMs / 1_000)) },
    });
  }
  const id = await appendCatalogObservation(db, {
    agentKey,
    endpointKey: input.endpointKey,
    protocol: input.protocol,
    source: input.source,
    outcome: input.outcome,
    observedAt: input.observedAt,
    expiresAt: input.expiresAt,
    httpStatus: input.httpStatus,
    errorCode: input.errorCode,
    durationMs: input.durationMs,
    detailsJson: JSON.stringify(input.details),
    attemptId: crypto.randomUUID(),
    validationKind: "protocol",
    verificationLevel: "user_observed",
  });
  return Response.json({ status: "recorded", id }, {
    status: 201,
    headers: { "cache-control": "no-store" },
  });
}
