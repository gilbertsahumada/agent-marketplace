import { and, eq } from "drizzle-orm";

import type { WorkerConfig } from "../config";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import { probeObservations, probeTargets } from "../db/schema";
import {
  BSC_COMMERCE,
  BSC_PAYMENT_TOKEN,
  BSC_POLICY,
  BSC_ROUTER,
} from "../lib/chain";
import type { D1Database } from "../types";

const MAX_BODY_BYTES = 8_192;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_QUOTE_TTL_MS = 900_000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const PRICE = /^[1-9]\d{0,77}$/;
const CATEGORIES = new Set([
  "rebalancing",
  "grid_trading",
  "yield_optimisation",
  "health_factor_monitoring",
]);
const KEYS = [
  "agentId", "chainId", "commerce", "currency", "decimals", "durationMs",
  "endpoint", "negotiationHash", "observedWallet", "policy", "priceRaw",
  "probeCategory", "probedAt", "quoteExpiresAt", "quoteNegotiatedAt",
  "requestHash", "router", "schemaVersion", "signer", "source", "transport",
] as const;

type BuyerRefresh = {
  schemaVersion: 1;
  source: "buyer_refresh";
  agentId: string;
  chainId: 56;
  transport: "a2a" | "erc8183_http";
  endpoint: string;
  probeCategory: "rebalancing" | "grid_trading" | "yield_optimisation" | "health_factor_monitoring";
  probedAt: number;
  durationMs: number;
  observedWallet: string;
  commerce: string;
  router: string;
  policy: string;
  priceRaw: string;
  currency: string;
  decimals: number;
  signer: string;
  requestHash: string;
  negotiationHash: string;
  quoteNegotiatedAt: number;
  quoteExpiresAt: number;
};

class InvalidBuyerRefresh extends Error {}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function parseBuyerRefresh(raw: unknown, now: number): BuyerRefresh {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new InvalidBuyerRefresh();
  const value = raw as Record<string, unknown>;
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== KEYS.length || actualKeys.some((key, index) => key !== [...KEYS].sort()[index])) {
    throw new InvalidBuyerRefresh();
  }
  if (
    value.schemaVersion !== 1
    || value.source !== "buyer_refresh"
    || typeof value.agentId !== "string" || !/^[1-9]\d*$/.test(value.agentId)
    || value.chainId !== 56
    || (value.transport !== "a2a" && value.transport !== "erc8183_http")
    || typeof value.endpoint !== "string"
    || typeof value.probeCategory !== "string" || !CATEGORIES.has(value.probeCategory)
    || !integer(value.probedAt) || Math.abs(value.probedAt - now) > MAX_CLOCK_SKEW_MS
    || !integer(value.durationMs) || value.durationMs > 60_000
    || typeof value.observedWallet !== "string" || !ADDRESS.test(value.observedWallet)
    || typeof value.commerce !== "string" || !ADDRESS.test(value.commerce)
    || typeof value.router !== "string" || !ADDRESS.test(value.router)
    || typeof value.policy !== "string" || !ADDRESS.test(value.policy)
    || typeof value.priceRaw !== "string" || !PRICE.test(value.priceRaw)
    || typeof value.currency !== "string" || !ADDRESS.test(value.currency)
    || !integer(value.decimals) || value.decimals > 255
    || typeof value.signer !== "string" || !ADDRESS.test(value.signer)
    || typeof value.requestHash !== "string" || !HASH.test(value.requestHash)
    || typeof value.negotiationHash !== "string" || !HASH.test(value.negotiationHash)
    || !integer(value.quoteNegotiatedAt)
    || !integer(value.quoteExpiresAt)
    || Math.abs(value.quoteNegotiatedAt - now) > MAX_CLOCK_SKEW_MS
    || value.quoteExpiresAt <= now
    || value.quoteExpiresAt <= value.quoteNegotiatedAt
    || value.quoteExpiresAt - value.quoteNegotiatedAt > MAX_QUOTE_TTL_MS
    || value.signer.toLowerCase() !== value.observedWallet.toLowerCase()
    || value.commerce.toLowerCase() !== BSC_COMMERCE.toLowerCase()
    || value.router.toLowerCase() !== BSC_ROUTER.toLowerCase()
    || value.policy.toLowerCase() !== BSC_POLICY.toLowerCase()
    || value.currency.toLowerCase() !== BSC_PAYMENT_TOKEN.toLowerCase()
    || value.decimals !== 18
  ) throw new InvalidBuyerRefresh();
  let endpoint: string;
  try {
    const url = new URL(value.endpoint);
    if (url.protocol !== "https:") throw new InvalidBuyerRefresh();
    endpoint = url.toString();
  } catch { throw new InvalidBuyerRefresh(); }
  return { ...value, endpoint } as BuyerRefresh;
}

async function boundedJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new InvalidBuyerRefresh();
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new InvalidBuyerRefresh();
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new InvalidBuyerRefresh();
  try { return JSON.parse(text); } catch { throw new InvalidBuyerRefresh(); }
}

export async function onDemandObservationResponse(
  request: Request,
  d1: D1Database,
  config: WorkerConfig,
  now: number,
): Promise<Response> {
  let input: BuyerRefresh;
  try { input = parseBuyerRefresh(await boundedJson(request), now); } catch {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (
    config.probeAgentAllowlist.length === 0
    || config.probeEndpointAllowlist.length === 0
    || !config.probeAgentAllowlist.includes(input.agentId)
    || !config.probeEndpointAllowlist.includes(input.endpoint)
  ) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: { "cache-control": "no-store" } });
  }

  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const targets = await db.select({
    currentMetadataUpdatedAt: probeTargets.currentMetadataUpdatedAt,
  }).from(probeTargets).where(and(
    eq(probeTargets.chainId, 56),
    eq(probeTargets.agentId, input.agentId),
    eq(probeTargets.transport, input.transport),
    eq(probeTargets.endpoint, input.endpoint),
    eq(probeTargets.declarationState, "current"),
  )).limit(1);
  const target = targets[0];
  if (!target) {
    return Response.json(
      { error: "target_unavailable" },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }
  const inserted = await db.insert(probeObservations).values({
    agentId: input.agentId,
    chainId: 56,
    transport: input.transport,
    endpoint: input.endpoint,
    probedAt: input.probedAt,
    probeCategory: input.probeCategory,
    outcome: "quote_verified",
    observedMetadataUpdatedAt: target.currentMetadataUpdatedAt,
    observedWallet: input.observedWallet.toLowerCase(),
    observedWalletSource: "agentWallet",
    observedBlockNumber: null,
    onchainObservedAt: input.probedAt,
    commerce: input.commerce.toLowerCase(),
    router: input.router.toLowerCase(),
    policy: input.policy.toLowerCase(),
    priceRaw: input.priceRaw,
    currency: input.currency.toLowerCase(),
    decimals: input.decimals,
    signatureMethod: null,
    signer: input.signer.toLowerCase(),
    requestHash: input.requestHash.toLowerCase(),
    negotiationHash: input.negotiationHash.toLowerCase(),
    source: "buyer_refresh",
    quoteNegotiatedAt: input.quoteNegotiatedAt,
    quoteExpiresAt: input.quoteExpiresAt,
    httpStatus: null,
    errorCode: null,
    durationMs: input.durationMs,
  }).onConflictDoNothing().returning({ id: probeObservations.id });
  if (inserted.length === 0) {
    return Response.json({ status: "duplicate" }, { status: 200, headers: { "cache-control": "no-store" } });
  }
  return Response.json({ status: "synced" }, { status: 201, headers: { "cache-control": "no-store" } });
}
