import "server-only";
import { callerFingerprint } from "./caller-fingerprint.ts";
import { privateWorkerUrl } from "./catalog-observation-sync.ts";
import { invalidateCatalogCandidateCache } from "./catalog-candidate-feed.ts";

type Environment = Readonly<Record<string, string | undefined>>;

export interface BuyerQuoteHistoryRequest {
  id: number;
  requestHash: string;
  kind: "buyer_quote" | "capability_probe" | string;
  status: string;
  transport: string;
  endpoint: string | null;
  provider: string | null;
  createdAt: number;
  completedAt: number | null;
  quoteExpiresAt: number | null;
  resultObservationId: number | null;
  errorCode: string | null;
  attempts: Array<{ id: string; executor: string; status: string; durationMs: number | null; httpStatus: number | null; outcome: string | null; errorCode: string | null }>;
}

export interface BuyerQuoteHistory {
  schemaVersion: number;
  agentId: string;
  counts: {
    requests: number;
    succeeded: number;
    rejected: number;
    failed: number;
    expired: number;
    buyerRequests: number;
    buyerSucceeded?: number;
    buyerRejected?: number;
    buyerFailed?: number;
    buyerExpired?: number;
    capabilityProbes: number;
    capabilitySucceeded?: number;
  };
  requests: BuyerQuoteHistoryRequest[];
}

export interface BuyerQuoteBrief {
  objective: string;
  deliverable: string;
  acceptanceCriteria: string;
}
export interface SellerParameterRequest {
  schemaVersion: 2;
  endpointKey: string;
  contractHash: string;
  parameters: Record<string, unknown>;
}

function urlFor(env: Environment, path: string): URL | null {
  return privateWorkerUrl(env, path);
}

async function requestWorker(
  path: string,
  init: RequestInit,
  options: { env?: Environment; fetchImpl?: typeof fetch; caller?: string } = {},
): Promise<{ status: number; body: unknown } | null> {
  const env = options.env ?? process.env;
  const destination = urlFor(env, path);
  const secret = env.BUYER_OBSERVATION_SECRET?.trim();
  if (!destination || !secret) return null;
  try {
    const response = await (options.fetchImpl ?? fetch)(destination, {
      ...init,
      cache: "no-store",
      headers: {
        authorization: `Bearer ${secret}`,
        accept: "application/json",
        ...(init.headers ?? {}),
        "x-marketplace-caller": callerFingerprint("quote-request-caller", options.caller, secret),
      },
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch { return null; }
}

export async function startBuyerQuote(
  agentId: string,
  brief: BuyerQuoteBrief | SellerParameterRequest,
  options: { env?: Environment; fetchImpl?: typeof fetch; caller?: string } = {},
) {
  const result = await requestWorker(`/catalog-quotes/${agentId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, ...brief }),
  }, options);
  // A request is public activity even before it succeeds: the card's quote
  // count and the detail history must not wait for the 30-second feed cache.
  if (result && result.status >= 200 && result.status < 300) invalidateCatalogCandidateCache();
  return result;
}

export async function getBuyerNegotiationInput(agentId: string, options: { env?: Environment; fetchImpl?: typeof fetch; caller?: string } = {}) {
  return requestWorker(`/catalog-quotes/${agentId}/input`, { method: "GET" }, options);
}

export async function submitBuyerQuoteResult(
  agentId: string,
  attemptId: string,
  envelope: Record<string, unknown>,
  options: { env?: Environment; fetchImpl?: typeof fetch; caller?: string } = {},
) {
  const result = await requestWorker(`/catalog-quotes/${agentId}/attempt/${attemptId}/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, envelope }),
  }, options);
  if (result && result.status >= 200 && result.status < 300) invalidateCatalogCandidateCache();
  return result;
}

export async function reportBuyerQuoteFailure(
  agentId: string,
  attemptId: string,
  errorCode: string,
  options: { env?: Environment; fetchImpl?: typeof fetch; caller?: string } = {},
) {
  const result = await requestWorker(`/catalog-quotes/${agentId}/attempt/${attemptId}/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, errorCode }),
  }, options);
  if (result && result.status >= 200 && result.status < 300) invalidateCatalogCandidateCache();
  return result;
}

export async function fallbackBuyerQuote(
  agentId: string,
  attemptId: string,
  request: { task_description: string; terms: Record<string, unknown> },
  options: { env?: Environment; fetchImpl?: typeof fetch; browserErrorCode?: string; caller?: string } = {},
) {
  const browserErrorCode = options.browserErrorCode?.trim().toUpperCase();
  const result = await requestWorker(`/catalog-quotes/${agentId}/attempt/${attemptId}/fallback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(browserErrorCode && /^[A-Z][A-Z0-9_]{2,63}$/.test(browserErrorCode)
        ? { "x-marketplace-browser-error": browserErrorCode }
        : {}),
    },
    body: JSON.stringify(request),
  }, options);
  if (result && result.status >= 200 && result.status < 300) invalidateCatalogCandidateCache();
  return result;
}

export async function getBuyerQuoteHistory(
  agentId: string,
  options: { env?: Environment; fetchImpl?: typeof fetch } = {},
) {
  return requestWorker(`/catalog-quotes/${agentId}`, { method: "GET" }, options);
}

/**
 * Resolve one public buyer-quote record for the server-side hire routes.
 * The Worker remains the source of truth; this helper only applies the
 * session/agent binding and never accepts a client-supplied endpoint.
 */
export async function resolveBuyerQuoteRequest(
  agentId: string,
  requestId: number,
  options: { env?: Environment; fetchImpl?: typeof fetch } = {},
): Promise<BuyerQuoteHistoryRequest | null> {
  if (!Number.isSafeInteger(requestId) || requestId < 1) return null;
  const result = await getBuyerQuoteHistory(agentId, options);
  if (!result || result.status < 200 || result.status >= 300 || !result.body || typeof result.body !== "object") return null;
  const body = result.body as Partial<BuyerQuoteHistory>;
  if (!Array.isArray(body.requests)) return null;
  const row = body.requests.find((candidate): candidate is BuyerQuoteHistoryRequest => (
    candidate && typeof candidate === "object" && candidate.id === requestId && candidate.kind === "buyer_quote"
  ));
  return row ?? null;
}
