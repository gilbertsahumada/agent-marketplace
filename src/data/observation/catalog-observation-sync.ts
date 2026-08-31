import "server-only";
import { createHash } from "node:crypto";
import type {
  BrowserValidationProtocol,
  BrowserValidationResult,
} from "../../business/entities/browser-validation.ts";

export type CatalogObservationSource = "browser_reported" | "marketplace_probe";
export type CatalogObservationSyncStatus = "recorded" | "failed" | "not_configured";

type Environment = Readonly<Record<string, string | undefined>>;

export interface CatalogObservationSyncInput {
  source: CatalogObservationSource;
  agentId: string;
  protocol: BrowserValidationProtocol | "erc8183";
  endpoint: string;
  outcome:
    | BrowserValidationResult["outcome"]
    | "erc8183_detected"
    | "quote_verified"
    | "quote_rejected"
    | "unreachable"
    | "error";
  observedAt: string;
  expiresAt: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  durationMs: number;
  details: { capabilityCount?: number; cors?: boolean; method?: "GET" | "POST" };
}

function destinationUrl(env: Environment): URL | null {
  const raw = env.OBSERVATIONS_URL?.trim();
  const allowedRaw = env.BUYER_OBSERVATION_ALLOWED_ORIGIN?.trim();
  if (!raw || !allowedRaw) return null;
  try {
    const url = new URL(raw);
    const allowed = new URL(allowedRaw);
    if (url.protocol !== "https:" || url.username || url.password
      || allowed.protocol !== "https:" || allowed.username || allowed.password
      || allowed.pathname !== "/" || allowed.search || allowed.hash
      || url.origin !== allowed.origin) return null;
    url.pathname = "/__internal/catalog-observation";
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function catalogEndpointKey(protocol: CatalogObservationSyncInput["protocol"], endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Unsafe catalog endpoint");
  }
  return createHash("sha256").update(`${protocol}\n${url.toString()}`).digest("hex");
}

export async function syncCatalogObservation(
  input: CatalogObservationSyncInput,
  options: { env?: Environment; fetchImpl?: typeof fetch } = {},
): Promise<{ status: CatalogObservationSyncStatus }> {
  const env = options.env ?? process.env;
  const destination = destinationUrl(env);
  const secret = env.BUYER_OBSERVATION_SECRET?.trim();
  if (!destination || !secret) return { status: "not_configured" };
  let payload: Record<string, unknown>;
  try {
    payload = {
      schemaVersion: 1,
      source: input.source,
      agentId: input.agentId,
      endpointKey: catalogEndpointKey(input.protocol, input.endpoint),
      protocol: input.protocol,
      outcome: input.outcome,
      observedAt: Date.parse(input.observedAt),
      expiresAt: input.expiresAt ? Date.parse(input.expiresAt) : null,
      httpStatus: input.httpStatus,
      errorCode: input.errorCode,
      durationMs: Math.max(0, Math.min(60_000, Math.trunc(input.durationMs))),
      details: input.details,
    };
  } catch {
    return { status: "failed" };
  }
  if (!Number.isSafeInteger(payload.observedAt)
    || (payload.expiresAt !== null && !Number.isSafeInteger(payload.expiresAt))) return { status: "failed" };
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > 4_096) return { status: "failed" };
  try {
    const response = await (options.fetchImpl ?? fetch)(destination, {
      method: "POST",
      cache: "no-store",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    return response.status === 201 ? { status: "recorded" } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
