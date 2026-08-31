import type { D1DatabaseLike } from "../db/client";
import { appendCatalogObservation, createDatabase } from "../db/orm";
import type { D1Database } from "../types";

const MAX_BODY_BYTES = 4_096;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_EXPIRY_MS = 24 * 60 * 60_000;
const HASH = /^[0-9a-f]{64}$/;
const AGENT_ID = /^[1-9]\d*$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const PROTOCOLS = new Set(["a2a", "mcp", "web", "erc8183_http", "erc8183"]);
const SOURCES = new Set(["browser_reported", "marketplace_probe"]);
const OUTCOMES = new Set([
  "protocol_valid", "cors_blocked", "http_error", "timeout", "network_error",
  "invalid_response", "unsafe_url", "erc8183_detected", "quote_verified",
  "quote_rejected", "unreachable", "error",
]);
const KEYS = [
  "agentId", "details", "durationMs", "endpointKey", "errorCode", "expiresAt",
  "httpStatus", "observedAt", "outcome", "protocol", "schemaVersion", "source",
] as const;
const DETAIL_KEYS = ["capabilityCount", "cors", "method"] as const;

interface CatalogObservationInput {
  schemaVersion: 1;
  source: "browser_reported" | "marketplace_probe";
  agentId: string;
  endpointKey: string;
  protocol: "a2a" | "mcp" | "web" | "erc8183_http" | "erc8183";
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
    || value.schemaVersion !== 1
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
  const id = await appendCatalogObservation(createDatabase(d1 as unknown as D1DatabaseLike), {
    agentKey: `eip155:56:${input.agentId}`,
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
  });
  return Response.json({ status: "recorded", id }, {
    status: 201,
    headers: { "cache-control": "no-store" },
  });
}
