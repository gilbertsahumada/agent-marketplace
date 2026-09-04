import { and, eq } from "drizzle-orm";
import { type PublicClient } from "viem";
import type { QuoteSigVerdict, VerifyQuoteSignatureOpts } from "@bnbagent/sdk/erc8183";

import type { D1DatabaseLike } from "../db/client";
import { createDatabase, readCatalogAgentEvidence } from "../db/orm";
import {
  catalogAgentEndpoints,
  catalogAgents,
  catalogEndpoints,
  catalogObservations,
  catalogQuoteAttempts,
  catalogQuoteRequests,
  catalogSellerCapabilities,
} from "../db/schema";
import {
  BscProbeError,
  createCountedBscClient,
  readProbeChainContext,
  type ProbeChainContext,
} from "../lib/chain";
import {
  QuoteValidationError,
  validateProbeQuote,
  type ProbeQuoteVerdict,
} from "../lib/quote";
import { PROBE_CATEGORIES, type ProbeCategory } from "../lib/terms";
import { deriveCatalogEvidenceState } from "../catalog/evidence-policy";
import type { D1Database } from "../types";

const MAX_BODY_BYTES = 64 * 1_024;
const AGENT_ID = /^[1-9]\d*$/;
const ENDPOINT_KEY = /^[0-9a-f]{64}$/;
const CHAIN_EVIDENCE_TTL_MS = 120_000;

type QuoteVerifier = (options: VerifyQuoteSignatureOpts) => Promise<QuoteSigVerdict>;
type ChainContext = ProbeChainContext & { readonly publicClient: PublicClient };

export interface CatalogQuoteEvidenceDependencies {
  readonly readChainContext?: (agentId: string) => Promise<ChainContext>;
  readonly verifyQuote?: QuoteVerifier;
  readonly fetchImpl?: typeof fetch;
  readonly clock?: () => number;
}

class InvalidQuoteEvidenceRequest extends Error {}

interface QuoteEvidenceInput {
  readonly agentId: string;
  readonly endpointKey: string;
  readonly probeCategory: ProbeCategory | null;
  readonly envelope: Record<string, unknown>;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

async function parseInput(request: Request): Promise<QuoteEvidenceInput> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new InvalidQuoteEvidenceRequest();
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new InvalidQuoteEvidenceRequest();
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new InvalidQuoteEvidenceRequest();
  let value: unknown;
  try { value = JSON.parse(body) as unknown; } catch { throw new InvalidQuoteEvidenceRequest(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidQuoteEvidenceRequest();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "agentId,endpointKey,envelope,probeCategory,schemaVersion"
    || record.schemaVersion !== 2
    || typeof record.agentId !== "string" || !AGENT_ID.test(record.agentId)
    || typeof record.endpointKey !== "string" || !ENDPOINT_KEY.test(record.endpointKey)
    || (record.probeCategory !== null
      && (typeof record.probeCategory !== "string"
        || !PROBE_CATEGORIES.includes(record.probeCategory as ProbeCategory)))
    || !record.envelope || typeof record.envelope !== "object" || Array.isArray(record.envelope)) {
    throw new InvalidQuoteEvidenceRequest();
  }
  return {
    agentId: record.agentId,
    endpointKey: record.endpointKey,
    probeCategory: record.probeCategory as ProbeCategory | null,
    envelope: record.envelope as Record<string, unknown>,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  throw new InvalidQuoteEvidenceRequest();
}

async function artifactHash(envelope: Record<string, unknown>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(envelope)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parsedCategories(value: string): string[] {
  try {
    const categories: unknown = JSON.parse(value);
    return Array.isArray(categories) && categories.every((entry) => typeof entry === "string") ? categories : [];
  } catch { return []; }
}

function quoteDetails(verdict: Extract<ProbeQuoteVerdict, { outcome: "quote_verified" }>, context: ChainContext) {
  return {
    provider: verdict.provider,
    signer: verdict.signer,
    signatureMethod: verdict.signatureMethod,
    requestHash: verdict.requestHash,
    negotiationHash: verdict.negotiationHash,
    priceRaw: verdict.priceRaw,
    currency: verdict.currency,
    decimals: verdict.decimals,
    quoteNegotiatedAt: verdict.quoteNegotiatedAt,
    quoteExpiresAt: verdict.quoteExpiresAt,
    chainId: 56,
    blockNumber: context.blockNumber.toString(),
    blockTimestamp: context.blockTimestamp.toString(),
    commerce: context.commerce,
    router: context.router,
    policy: context.policy,
  };
}

export async function catalogQuoteEvidenceResponse(
  request: Request,
  d1: D1Database,
  options: {
    readonly rpcUrl?: string;
    readonly nowMs: number;
    readonly timeoutMs: number;
    readonly dependencies?: CatalogQuoteEvidenceDependencies;
  },
): Promise<Response> {
  let input: QuoteEvidenceInput;
  try { input = await parseInput(request); } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const agentKey = `eip155:56:${input.agentId}`;
  const rows = await db.select({
    categoriesJson: catalogAgents.categoriesJson,
    endpoint: catalogEndpoints.endpoint,
    endpointProtocol: catalogEndpoints.validationProtocol,
  }).from(catalogAgents)
    .innerJoin(catalogAgentEndpoints, eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey))
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgents.agentKey, agentKey),
      eq(catalogAgents.indexState, "current"),
      eq(catalogAgentEndpoints.endpointKey, input.endpointKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
    )).limit(1);
  const target = rows[0];
  if (!target
    || (target.endpointProtocol !== "a2a" && target.endpointProtocol !== "erc8183_http")) {
    return jsonResponse({ error: "target_not_quote_compatible" }, 409);
  }
  const categories = parsedCategories(target.categoriesJson);
  if (input.probeCategory !== null && !categories.includes(input.probeCategory)) {
    return jsonResponse({ error: "requirements_not_admitted" }, 409);
  }

  const hash = await artifactHash(input.envelope);
  const existing = await db.select({ id: catalogObservations.id })
    .from(catalogObservations)
    .where(and(
      eq(catalogObservations.agentKey, agentKey),
      eq(catalogObservations.endpointKey, input.endpointKey),
      eq(catalogObservations.validationKind, "quote"),
      eq(catalogObservations.artifactHash, hash),
    )).limit(1);
  if (existing[0]) return jsonResponse({ status: "duplicate", observationId: existing[0].id }, 200);
  const existingRequest = await db.select({ id: catalogQuoteRequests.id, resultObservationId: catalogQuoteRequests.resultObservationId })
    .from(catalogQuoteRequests)
    .where(and(
      eq(catalogQuoteRequests.agentKey, agentKey),
      eq(catalogQuoteRequests.artifactHash, hash),
    )).limit(1);
  if (existingRequest[0]) {
    return jsonResponse({
      status: "duplicate",
      requestId: existingRequest[0].id,
      observationId: existingRequest[0].resultObservationId,
    }, 200);
  }

  const dependencies = options.dependencies ?? {};
  const clock = dependencies.clock ?? (() => performance.now());
  const startedAt = clock();
  let context: ChainContext;
  try {
    if (dependencies.readChainContext) context = await dependencies.readChainContext(input.agentId);
    else {
      if (!options.rpcUrl) return jsonResponse({ error: "chain_unavailable", code: "BSC_RPC_URL_REQUIRED" }, 503);
      const client = createCountedBscClient({
        rpcUrl: options.rpcUrl,
        fetch: dependencies.fetchImpl ?? fetch,
        deadlineMs: options.nowMs + options.timeoutMs,
        now: Date.now,
      });
      context = {
        ...await readProbeChainContext(client, {
          agentId: input.agentId,
          nowSeconds: Math.floor(options.nowMs / 1_000),
        }),
        publicClient: client,
      };
    }
    const quoteContext = {
      ...context,
      nowSeconds: Math.floor(options.nowMs / 1_000),
      probeCategory: input.probeCategory,
    };
    const verdict = dependencies.verifyQuote
      ? await validateProbeQuote(input.envelope, quoteContext, dependencies.verifyQuote)
      : await validateProbeQuote(input.envelope, quoteContext);
    if (verdict.outcome !== "quote_verified") {
      return jsonResponse({ error: "quote_rejected", code: verdict.errorCode }, 422);
    }
    const durationMs = Math.max(0, Math.round(clock() - startedAt));
    const requestHash = verdict.requestHash;
    const requestRows = await db.insert(catalogQuoteRequests).values({
      requestHash,
      artifactHash: hash,
      agentKey,
      endpointKey: input.endpointKey,
      transport: target.endpointProtocol,
      kind: "buyer_quote",
      status: "succeeded",
      callerKey: "browser",
      createdAt: options.nowMs,
      completedAt: options.nowMs,
      quoteExpiresAt: verdict.quoteExpiresAt,
      metadataJson: JSON.stringify({
        requestHash,
        transport: target.endpointProtocol,
        ...(target.endpoint ? { endpoint: target.endpoint } : {}),
        source: "legacy_browser_report",
      }),
    }).returning({ id: catalogQuoteRequests.id });
    const requestId = requestRows[0]?.id;
    if (requestId === undefined) return jsonResponse({ error: "quote_request_failed" }, 500);
    const attemptId = crypto.randomUUID();
    const results = await db.batch([
      db.insert(catalogObservations).values({
        agentKey,
        endpointKey: input.endpointKey,
        protocol: target.endpointProtocol,
        source: "browser_reported",
        outcome: "quote_verified",
        observedAt: options.nowMs,
        expiresAt: verdict.quoteExpiresAt,
        durationMs,
        detailsJson: JSON.stringify(quoteDetails(verdict, context)),
        attemptId,
        validationKind: "quote",
        verificationLevel: "cryptographic",
        artifactHash: hash,
      }).onConflictDoNothing().returning({ id: catalogObservations.id }),
      db.insert(catalogObservations).values({
        agentKey,
        endpointKey: input.endpointKey,
        protocol: "erc8183",
        source: "chain_read",
        outcome: "erc8183_detected",
        observedAt: options.nowMs,
        expiresAt: options.nowMs + CHAIN_EVIDENCE_TTL_MS,
        durationMs,
        detailsJson: JSON.stringify({
          chainId: 56,
          blockNumber: context.blockNumber.toString(),
          blockTimestamp: context.blockTimestamp.toString(),
          provider: context.provider,
          walletSource: context.walletSource,
          commerce: context.commerce,
          router: context.router,
          policy: context.policy,
          paymentToken: context.paymentToken,
          tokenDecimals: context.tokenDecimals,
          policyAllowlisted: context.policyAllowlisted,
        }),
        attemptId: `${attemptId}:chain`,
        validationKind: "chain",
        verificationLevel: "onchain",
        artifactHash: hash,
      }).onConflictDoNothing().returning({ id: catalogObservations.id }),
      db.insert(catalogQuoteAttempts).values({
        id: attemptId,
        requestId,
        executor: "browser",
        status: "succeeded",
        startedAt: options.nowMs,
        finishedAt: options.nowMs,
        durationMs,
        outcome: "quote_verified",
        metadataJson: JSON.stringify({
          requestHash,
          transport: target.endpointProtocol,
          ...(target.endpoint ? { endpoint: target.endpoint } : {}),
        }),
      }),
      db.insert(catalogSellerCapabilities).values({
        agentKey,
        endpointKey: input.endpointKey,
        transport: target.endpointProtocol,
        state: "ready",
        lastSuccessAt: options.nowMs,
        capabilityExpiresAt: options.nowMs + 24 * 60 * 60 * 1_000,
        nextProbeAt: options.nowMs + 24 * 60 * 60 * 1_000,
        consecutiveFailures: 0,
        lastAttemptAt: options.nowMs,
        lastAttemptId: attemptId,
        lastErrorCode: null,
        createdAt: options.nowMs,
        updatedAt: options.nowMs,
      }).onConflictDoUpdate({
        target: [catalogSellerCapabilities.agentKey, catalogSellerCapabilities.endpointKey],
        set: {
          transport: target.endpointProtocol,
          state: "ready",
          lastSuccessAt: options.nowMs,
          capabilityExpiresAt: options.nowMs + 24 * 60 * 60 * 1_000,
          nextProbeAt: options.nowMs + 24 * 60 * 60 * 1_000,
          consecutiveFailures: 0,
          lastAttemptAt: options.nowMs,
          lastAttemptId: attemptId,
          lastErrorCode: null,
          updatedAt: options.nowMs,
        },
      }),
    ]);
    const quoteRows = results[0] as Array<{ id: number }>;
    if (!quoteRows[0]) {
      const raced = await db.select({ id: catalogObservations.id }).from(catalogObservations)
        .where(and(
          eq(catalogObservations.agentKey, agentKey),
          eq(catalogObservations.endpointKey, input.endpointKey),
          eq(catalogObservations.validationKind, "quote"),
          eq(catalogObservations.artifactHash, hash),
        )).limit(1);
      return jsonResponse({ status: "duplicate", observationId: raced[0]?.id ?? null }, 200);
    }
    const evidence = await readCatalogAgentEvidence(db, input.agentId);
    return jsonResponse({
      schemaVersion: 2,
      status: "verified",
      observationId: quoteRows[0].id,
      artifactHash: hash,
      quote: quoteDetails(verdict, context),
      capabilities: deriveCatalogEvidenceState({
        endpoints: evidence.endpoints,
        observations: evidence.observations,
        admission: evidence.admission,
        capability: {
          endpointKey: input.endpointKey,
          transport: target.endpointProtocol,
          state: "ready",
          lastSuccessAt: options.nowMs,
          capabilityExpiresAt: options.nowMs + 24 * 60 * 60 * 1_000,
          lastAttemptAt: options.nowMs,
          consecutiveFailures: 0,
          lastErrorCode: null,
        },
        quoteStats: evidence.quoteStats,
        nowMs: options.nowMs,
      }),
    }, 201);
  } catch (error) {
    if (error instanceof QuoteValidationError) {
      return jsonResponse({ error: "quote_invalid", code: error.code }, 422);
    }
    if (error instanceof BscProbeError) {
      return jsonResponse({ error: "chain_unavailable", code: error.code }, 503);
    }
    throw error;
  }
}
