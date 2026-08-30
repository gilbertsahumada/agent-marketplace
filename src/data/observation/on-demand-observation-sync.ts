import "server-only";

import type { NormalizedErc8183Quote } from "../../business/entities/erc8183-browser-spike.ts";

export type ObservationSyncStatus = "synced" | "duplicate" | "failed" | "not_configured";
export interface ObservationSyncResult { readonly status: ObservationSyncStatus }

type RequestQuote = { execute(): Promise<NormalizedErc8183Quote> };
type Environment = Readonly<Record<string, string | undefined>>;

function privateUrl(observationsUrl: string): string {
  const url = new URL(observationsUrl);
  url.pathname = "/__internal/on-demand-observation";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function allowedPrivateUrl(observationsUrl: string, allowedOrigin: string): string | null {
  try {
    const url = new URL(observationsUrl);
    const allowed = new URL(allowedOrigin);
    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || allowed.protocol !== "https:"
      || allowed.username !== ""
      || allowed.password !== ""
      || allowed.pathname !== "/"
      || allowed.search !== ""
      || allowed.hash !== ""
      || url.origin !== allowed.origin
    ) return null;
    return privateUrl(url.toString());
  } catch { return null; }
}

function hash(envelope: Record<string, unknown>, field: string): string {
  const value = envelope[field];
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Verified quote omitted ${field}`);
  }
  return value.toLowerCase();
}

function observationEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  // This route is currently the controlled Grid seller. The normalized browser
  // quote intentionally exposes only its origin, while D1 keys the declared A2A
  // target by its /grid path.
  url.pathname = "/grid";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function syncBuyerQuoteObservation(
  quote: NormalizedErc8183Quote,
  options: {
    readonly env?: Environment;
    readonly fetchImpl?: typeof fetch;
    readonly now?: () => number;
    readonly durationMs?: number;
  } = {},
): Promise<ObservationSyncResult> {
  const env = options.env ?? process.env;
  const observationsUrl = env.OBSERVATIONS_URL?.trim();
  const allowedOrigin = env.BUYER_OBSERVATION_ALLOWED_ORIGIN?.trim();
  const secret = env.BUYER_OBSERVATION_SECRET?.trim();
  if (!observationsUrl || !allowedOrigin || !secret) return { status: "not_configured" };
  const destination = allowedPrivateUrl(observationsUrl, allowedOrigin);
  if (destination === null) return { status: "failed" };
  if (quote.chainId !== 56) return { status: "failed" };
  const now = options.now?.() ?? Date.now();
  const payload = {
    schemaVersion: 1,
    source: "buyer_refresh",
    agentId: String(quote.agentId),
    chainId: 56,
    transport: "a2a",
    endpoint: observationEndpoint(quote.endpoint),
    probeCategory: "grid_trading",
    probedAt: now,
    durationMs: Math.max(0, Math.min(60_000, Math.trunc(options.durationMs ?? 0))),
    observedWallet: quote.provider,
    commerce: quote.commerce,
    router: quote.router,
    policy: quote.policy,
    priceRaw: quote.priceRaw,
    currency: quote.token,
    decimals: quote.tokenDecimals,
    signer: quote.provider,
    requestHash: hash(quote.envelope, "request_hash"),
    negotiationHash: hash(quote.envelope, "negotiation_hash"),
    quoteNegotiatedAt: quote.negotiatedAt * 1_000,
    quoteExpiresAt: quote.quoteExpiresAt * 1_000,
  } as const;
  const raw = JSON.stringify(payload);
  if (new TextEncoder().encode(raw).byteLength > 8_192) return { status: "failed" };
  try {
    const response = await (options.fetchImpl ?? fetch)(destination, {
      method: "POST",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: raw,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { status: "failed" };
    const body = await response.json() as { status?: unknown };
    return body.status === "duplicate" ? { status: "duplicate" } : body.status === "synced" ? { status: "synced" } : { status: "failed" };
  } catch { return { status: "failed" }; }
}

export async function requestQuoteWithObservationSync(
  requestQuote: RequestQuote,
  sync: (quote: NormalizedErc8183Quote, options?: { durationMs?: number }) => Promise<ObservationSyncResult> = syncBuyerQuoteObservation,
  now: () => number = Date.now,
): Promise<NormalizedErc8183Quote & { observationSync: ObservationSyncResult }> {
  const startedAt = now();
  const quote = await requestQuote.execute();
  let observationSync: ObservationSyncResult;
  try { observationSync = await sync(quote, { durationMs: Math.max(0, now() - startedAt) }); }
  catch { observationSync = { status: "failed" }; }
  return { ...quote, observationSync };
}
