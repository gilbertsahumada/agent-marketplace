import { NextResponse } from "next/server";
import { getMarketplaceAgent, recordCatalogObservation } from "@/src/business/composition";
import type { BrowserValidationResult } from "@/src/business/entities/browser-validation";
import { InvalidMarketplaceInputError, MarketplacePayloadTooLargeError } from "@/src/business/errors/marketplace-errors";
import { declaredBrowserValidationTargets } from "@/src/business/policies/catalog-validation-policy";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

const MAX_BODY_BYTES = 2_048;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const KEYS = [
  "capabilityCount", "cors", "durationMs", "endpoint", "errorCode", "expiresAt",
  "httpStatus", "message", "method", "observedAt", "outcome", "protocol", "source",
] as const;
const OUTCOMES = new Set([
  "protocol_valid", "cors_blocked", "http_error", "timeout", "invalid_response", "unsafe_url",
]);
const PROTOCOLS = new Set(["a2a", "mcp", "erc8183_http"]);

async function boundedJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) {
    throw new MarketplacePayloadTooLargeError();
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new MarketplacePayloadTooLargeError();
  try { return JSON.parse(body) as unknown; } catch { throw new InvalidMarketplaceInputError("Observation must be JSON"); }
}

function input(raw: unknown, now: number): BrowserValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidMarketplaceInputError("Observation must be an object");
  }
  const value = raw as Record<string, unknown>;
  const actual = Object.keys(value).sort();
  const expected = [...KEYS].sort();
  const observedAt = typeof value.observedAt === "string" ? Date.parse(value.observedAt) : Number.NaN;
  const expiresAt = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : null;
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
    || value.source !== "browser_reported"
    || typeof value.protocol !== "string" || !PROTOCOLS.has(value.protocol)
    || typeof value.endpoint !== "string" || value.endpoint.length > 2_048
    || typeof value.outcome !== "string" || !OUTCOMES.has(value.outcome)
    || !Number.isFinite(observedAt) || Math.abs(observedAt - now) > MAX_CLOCK_SKEW_MS
    || (value.expiresAt !== null && (!Number.isFinite(expiresAt)
      || expiresAt! < observedAt || expiresAt! - observedAt > 15 * 60_000))
    || (value.httpStatus !== null && (typeof value.httpStatus !== "number"
      || !Number.isInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599))
    || typeof value.durationMs !== "number" || !Number.isInteger(value.durationMs)
      || value.durationMs < 0 || value.durationMs > 60_000
    || typeof value.capabilityCount !== "number" || !Number.isInteger(value.capabilityCount)
      || value.capabilityCount < 0 || value.capabilityCount > 10_000
    || (value.errorCode !== null && (typeof value.errorCode !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(value.errorCode)))
    || (value.method !== "GET" && value.method !== "POST")
    || typeof value.cors !== "boolean"
    || typeof value.message !== "string" || value.message.length > 500) {
    throw new InvalidMarketplaceInputError("Observation contract is invalid");
  }
  return value as unknown as BrowserValidationResult;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new InvalidMarketplaceInputError("Content-Type must be application/json");
    }
    const { agentId } = await context.params;
    const result = input(await boundedJson(request), Date.now());
    const agent = await getMarketplaceAgent.execute({ agentId });
    const declared = declaredBrowserValidationTargets(agent).some(
      (target) => target.protocol === result.protocol && target.endpoint === result.endpoint,
    );
    if (!declared) throw new InvalidMarketplaceInputError("Endpoint is not declared by this agent");
    const sync = await recordCatalogObservation({
      source: "browser_reported",
      agentId,
      protocol: result.protocol,
      endpoint: result.endpoint,
      outcome: result.outcome,
      observedAt: result.observedAt,
      expiresAt: result.expiresAt,
      httpStatus: result.httpStatus,
      errorCode: result.errorCode,
      durationMs: result.durationMs,
      details: { capabilityCount: result.capabilityCount, cors: result.cors, method: result.method },
    });
    return NextResponse.json({ validation: "accepted", persistence: sync.status }, {
      status: sync.status === "recorded" ? 201 : 202,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
