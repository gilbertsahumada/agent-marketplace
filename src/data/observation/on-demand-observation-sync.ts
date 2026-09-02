import "server-only";

import type { NormalizedErc8183Quote } from "../../business/entities/erc8183-browser-spike.ts";
import { catalogEndpointKey } from "./catalog-observation-sync.ts";

export type ObservationSyncStatus = "synced" | "duplicate" | "failed" | "not_configured";
export interface ObservationSyncResult { readonly status: ObservationSyncStatus }

const QUOTE_OBSERVATION_TIMEOUT_MS = 12_000;

type RequestQuote = { execute(): Promise<NormalizedErc8183Quote> };
type Environment = Readonly<Record<string, string | undefined>>;

function privateUrl(observationsUrl: string): string {
  const url = new URL(observationsUrl);
  url.pathname = "/catalog-quote-evidence";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function allowedPrivateUrl(
  observationsUrl: string,
  allowedOrigin: string,
  allowLoopbackHttp: boolean,
): string | null {
  try {
    const url = new URL(observationsUrl);
    const allowed = new URL(allowedOrigin);
    const loopbackDevelopment = allowLoopbackHttp
      && url.protocol === "http:"
      && allowed.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && (allowed.hostname === "localhost" || allowed.hostname === "127.0.0.1");
    if (
      (!loopbackDevelopment && url.protocol !== "https:")
      || url.username !== ""
      || url.password !== ""
      || (!loopbackDevelopment && allowed.protocol !== "https:")
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

function observationEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  // This route is currently the controlled Grid seller. The normalized browser
  // quote intentionally exposes only its origin, while D1 keys the declared A2A
  // resource by the agent-card URL published in ERC-8004 metadata.
  url.pathname = "/grid/.well-known/agent-card.json";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function safeDiagnostic(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : undefined;
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
  const destination = allowedPrivateUrl(
    observationsUrl,
    allowedOrigin,
    env.NODE_ENV === "development",
  );
  if (destination === null) return { status: "failed" };
  if (quote.chainId !== 56) return { status: "failed" };
  let endpointKey: string;
  try { endpointKey = catalogEndpointKey("a2a", observationEndpoint(quote.endpoint)); }
  catch { return { status: "failed" }; }
  const payload = {
    schemaVersion: 2,
    agentId: String(quote.agentId),
    endpointKey,
    probeCategory: "grid_trading",
    envelope: quote.envelope,
  } as const;
  const raw = JSON.stringify(payload);
  if (new TextEncoder().encode(raw).byteLength > 64 * 1_024) return { status: "failed" };
  try {
    const response = await (options.fetchImpl ?? fetch)(destination, {
      method: "POST",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: raw,
      signal: AbortSignal.timeout(QUOTE_OBSERVATION_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null) as {
      status?: unknown;
      error?: unknown;
      code?: unknown;
    } | null;
    if (!response.ok) {
      console.warn("buyer_quote_observation_sync_rejected", {
        status: response.status,
        ...(safeDiagnostic(body?.error) ? { error: safeDiagnostic(body?.error) } : {}),
        ...(safeDiagnostic(body?.code) ? { code: safeDiagnostic(body?.code) } : {}),
      });
      return { status: "failed" };
    }
    return body?.status === "duplicate" ? { status: "duplicate" } : body?.status === "verified" ? { status: "synced" } : { status: "failed" };
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
