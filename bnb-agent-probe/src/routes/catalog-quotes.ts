import { and, count, desc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { NegotiationRequest, buildJobDescription, verifyQuoteSignature } from "@bnbagent/sdk/erc8183";
import { formatUnits, parseAbi, type PublicClient } from "viem";
import { createDatabase } from "../db/orm";
import {
  catalogAgentEndpoints,
  catalogAgents,
  catalogEndpoints,
  catalogObservations,
  catalogQuoteAttempts,
  catalogQuoteRequests,
  catalogSellerCapabilities,
} from "../db/schema";
import type { D1Database, Env } from "../types";
import type { WorkerConfig } from "../config";
import { createCountedBscClient, readProbeChainContext, type ProbeChainContext } from "../lib/chain";
import { validateProbeQuote, QuoteValidationError } from "../lib/quote";
import { buildBuyerQuoteRequest } from "../lib/terms";
import { discoverNegotiationInput, probeA2aSeller, probeErc8183HttpSeller, probeMcpSeller, SellerProbeError } from "../lib/seller-client";
import { buildContractRequest } from "../../../src/shared/negotiation-input";
import { callerKey } from "../lib/caller-key";
import { recordCompatibility } from "../catalog/compatibility";

const MAX_BODY_BYTES = 16 * 1_024;
const MAX_BRIEF_LENGTH = 500;
const AGENT_ID = /^[1-9]\d{0,19}$/;
const ATTEMPT_ID = /^[0-9a-f-]{16,80}$/i;
const REQUEST_HASH = /^0x[0-9a-f]{64}$/i;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const DEDUPE_WINDOW_MS = 60_000;
const CAPABILITY_TTL_MS = 24 * 60 * 60 * 1_000;
const CHAIN_EVIDENCE_TTL_MS = 120_000;
// This is a public UI guardrail as well as a server-side economic limit. The
// browser receives it with a verified quote so it never has to guess a
// deployment-specific value while building the transaction review.
const MAX_MARKETPLACE_BUDGET_RAW = 10_000_000_000_000_000n;
const tokenSymbolAbi = parseAbi(["function symbol() view returns (string)"]);

type ChainContext = ProbeChainContext & { readonly publicClient: PublicClient; readonly tokenSymbol: string };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  throw new Error("QUOTE_CANONICAL_INVALID");
}

export async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function briefInput(value: Record<string, unknown>) {
  if (Object.keys(value).sort().join(",") !== "acceptanceCriteria,deliverable,objective,schemaVersion"
    || value.schemaVersion !== 1
    || typeof value.objective !== "string" || typeof value.deliverable !== "string"
    || typeof value.acceptanceCriteria !== "string"
    || [value.objective, value.deliverable, value.acceptanceCriteria].some((entry) => (
      entry.trim().length < 1 || entry.length > MAX_BRIEF_LENGTH
    ))) return null;
  try {
    return buildBuyerQuoteRequest({
      objective: value.objective,
      deliverable: value.deliverable,
      acceptanceCriteria: value.acceptanceCriteria,
    });
  } catch { return null; }
}

export async function targetFor(
  db: ReturnType<typeof createDatabase>,
  agentId: string,
  endpointKey?: string,
  transports: readonly ("a2a" | "mcp" | "erc8183_http")[] = ["a2a", "mcp", "erc8183_http"],
) {
  const rows = await db.select({
    agentKey: catalogAgents.agentKey,
    endpointKey: catalogEndpoints.endpointKey,
    endpoint: catalogEndpoints.endpoint,
    transport: catalogEndpoints.validationProtocol,
    originKey: catalogEndpoints.originKey,
    categoriesJson: catalogAgents.categoriesJson,
  }).from(catalogAgents)
    .innerJoin(catalogAgentEndpoints, eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey))
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgents.agentId, agentId),
      eq(catalogAgents.chainId, 56),
      eq(catalogAgents.indexState, "current"),
      eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
      eq(catalogEndpoints.safety, "safe"),
      inArray(catalogEndpoints.validationProtocol, transports),
      endpointKey ? eq(catalogEndpoints.endpointKey, endpointKey) : undefined,
    ))
    .orderBy(desc(catalogAgentEndpoints.priority), catalogEndpoints.endpointKey)
    .limit(1);
  const target = rows[0];
  return target && target.endpoint !== null && target.transport !== null
    ? { ...target, endpoint: target.endpoint, transport: target.transport }
    : null;
}

export async function readContext(env: Env, config: WorkerConfig, agentId: string, nowMs: number): Promise<ChainContext> {
  if (!env.BSC_RPC_URL) throw new Error("BSC_RPC_URL_REQUIRED");
  const client = createCountedBscClient({
    rpcUrl: env.BSC_RPC_URL,
    fetch,
    deadlineMs: nowMs + config.probeTimeoutMs,
    now: Date.now,
  });
  const context = await readProbeChainContext(client, { agentId, nowSeconds: Math.floor(nowMs / 1_000) });
  const tokenSymbol = await client.readContract({
    address: context.paymentToken,
    abi: tokenSymbolAbi,
    functionName: "symbol",
  });
  if (typeof tokenSymbol !== "string" || tokenSymbol.trim().length < 1 || tokenSymbol.length > 32) {
    throw new Error("BSC_TOKEN_SYMBOL");
  }
  return { ...context, tokenSymbol, publicClient: client };
}

function metadata(input: { requestHash: string; transport: string; endpoint: string }) {
  return JSON.stringify({ requestHash: input.requestHash, transport: input.transport, endpoint: input.endpoint });
}

type QuoteRateLimitOptions = {
  /** Limits are intentionally supplied by the Worker config so this route is
   * also usable from a test or another private Worker without global state. */
  dailyLimit?: number;
  callerDailyLimit?: number;
  agentDailyLimit?: number;
  originDailyLimit?: number;
};

async function quoteRateLimit(
  db: ReturnType<typeof createDatabase>,
  input: { agentKey: string; originKey: string | null; caller: string; nowMs: number },
  limits: QuoteRateLimitOptions,
): Promise<{ code: string; retryAfterSeconds: number } | null> {
  const configured = [limits.dailyLimit, limits.callerDailyLimit, limits.agentDailyLimit, limits.originDailyLimit]
    .filter((value): value is number => value !== undefined);
  if (configured.length === 0) return null;
  if (configured.some((value) => !Number.isSafeInteger(value) || value < 1)) return { code: "quote_rate_limit_invalid", retryAfterSeconds: 60 };
  const dayStart = input.nowMs - 24 * 60 * 60 * 1_000;
  const base = and(
    eq(catalogQuoteRequests.kind, "buyer_quote"),
    gte(catalogQuoteRequests.createdAt, dayStart),
  );
  const [globalRows, callerRows, agentRows, originRows] = await Promise.all([
    limits.dailyLimit === undefined ? Promise.resolve([{ total: 0 }]) : db.select({ total: count() })
      .from(catalogQuoteRequests).where(base),
    limits.callerDailyLimit === undefined ? Promise.resolve([{ total: 0 }]) : db.select({ total: count() })
      .from(catalogQuoteRequests).where(and(base, eq(catalogQuoteRequests.callerKey, input.caller))),
    limits.agentDailyLimit === undefined ? Promise.resolve([{ total: 0 }]) : db.select({ total: count() })
      .from(catalogQuoteRequests).where(and(base, eq(catalogQuoteRequests.agentKey, input.agentKey))),
    limits.originDailyLimit === undefined || input.originKey === null
      ? Promise.resolve([{ total: 0 }])
      : db.select({ total: count() }).from(catalogQuoteRequests)
        .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogQuoteRequests.endpointKey))
        .where(and(base, eq(catalogEndpoints.originKey, input.originKey))),
  ]);
  const global = Number(globalRows[0]?.total ?? 0);
  const caller = Number(callerRows[0]?.total ?? 0);
  const agent = Number(agentRows[0]?.total ?? 0);
  const origin = Number(originRows[0]?.total ?? 0);
  if (limits.dailyLimit !== undefined && global >= limits.dailyLimit) return { code: "daily_quote_rate_limit", retryAfterSeconds: 60 };
  if (limits.callerDailyLimit !== undefined && caller >= limits.callerDailyLimit) return { code: "caller_quote_rate_limit", retryAfterSeconds: 60 };
  if (limits.agentDailyLimit !== undefined && agent >= limits.agentDailyLimit) return { code: "agent_quote_rate_limit", retryAfterSeconds: 60 };
  if (limits.originDailyLimit !== undefined && origin >= limits.originDailyLimit) return { code: "origin_quote_rate_limit", retryAfterSeconds: 60 };
  return null;
}

async function updateAttempt(
  db: ReturnType<typeof createDatabase>,
  attemptId: string,
  requestId: number,
  status: "running" | "succeeded" | "rejected" | "failed",
  nowMs: number,
  fields: { outcome?: string; errorCode?: string; httpStatus?: number; metadataJson?: string } = {},
) {
  const rows = await db.select({ startedAt: catalogQuoteAttempts.startedAt })
    .from(catalogQuoteAttempts).where(and(eq(catalogQuoteAttempts.id, attemptId), eq(catalogQuoteAttempts.requestId, requestId))).limit(1);
  const startedAt = rows[0]?.startedAt ?? nowMs;
  await db.update(catalogQuoteAttempts).set({
    status,
    finishedAt: status === "running" ? null : nowMs,
    durationMs: status === "running" ? null : Math.max(0, nowMs - startedAt),
    ...(fields.outcome === undefined ? {} : { outcome: fields.outcome }),
    ...(fields.errorCode === undefined ? {} : { errorCode: fields.errorCode }),
    ...(fields.httpStatus === undefined ? {} : { httpStatus: fields.httpStatus }),
    ...(fields.metadataJson === undefined ? {} : { metadataJson: fields.metadataJson }),
  }).where(eq(catalogQuoteAttempts.id, attemptId));
}

async function discoveryAllowance(d1: D1Database, key: string, limit: number, nowMs: number): Promise<boolean> {
  const row = await createDatabase(d1 as never).get(sql`INSERT INTO runtime_state (key, integerValue, updatedAt) VALUES (${`negotiation-discovery:${key}`}, 1, ${nowMs})
    ON CONFLICT(key) DO UPDATE SET
      integerValue = CASE WHEN updatedAt <= ${nowMs - 60_000} THEN 1 ELSE integerValue + 1 END,
      updatedAt = CASE WHEN updatedAt <= ${nowMs - 60_000} THEN excluded.updatedAt ELSE updatedAt END
    WHERE updatedAt <= ${nowMs - 60_000} OR integerValue < ${limit} RETURNING integerValue`);
  return row != null;
}

export async function catalogNegotiationInputResponse(d1: D1Database, agentId: string, options: { caller?: string; nowMs?: number } = {}): Promise<Response> {
  if (!AGENT_ID.test(agentId)) return json({ error: "invalid_request" }, 400);
  const nowMs = options.nowMs ?? Date.now();
  if (!await discoveryAllowance(d1, "global", 120, nowMs)
    || !await discoveryAllowance(d1, await sha256(options.caller ?? "anonymous"), 10, nowMs)) return json({ error: "quote_rate_limited" }, 429, { "retry-after": "60" });
  const db = createDatabase(d1 as never);
  const endpoints = await db.select({ endpointKey: catalogAgentEndpoints.endpointKey }).from(catalogAgentEndpoints)
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(eq(catalogAgentEndpoints.agentKey, `eip155:56:${agentId}`), eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.role, "operational"), eq(catalogEndpoints.eligibility, "eligible"), eq(catalogEndpoints.safety, "safe"),
      inArray(catalogEndpoints.validationProtocol, ["a2a", "mcp", "erc8183_http"])))
    .orderBy(desc(catalogAgentEndpoints.priority), catalogAgentEndpoints.endpointKey).limit(4);
  const results = await Promise.all(endpoints.map(async ({ endpointKey }) => {
    const target = await targetFor(db, agentId, endpointKey);
    if (!target) return { error: "quote_transport_unavailable" };
    if (!await discoveryAllowance(d1, await sha256(new URL(target.endpoint).origin), 25, nowMs)) return { error: "quote_rate_limited" };
    try {
      const contract = await discoverNegotiationInput({ ...target, request: {}, fetch, timeoutMs: 5000, maxResponseBytes: 32768 });
      const contractHash = await sha256(contract);
      await recordCompatibility(db, target, nowMs, { schemaHash: contractHash, provenance: contract.provenance });
      return { contract, contractHash, endpointKey: target.endpointKey, transport: target.transport };
    } catch (error) {
      const errorCode = error instanceof Error && ERROR_CODE.test(error.message) ? error.message : "NEGOTIATION_DISCOVERY_FAILED";
      await recordCompatibility(db, target, nowMs, { errorCode });
      return { error: errorCode };
    }
  }));
  const found = results.find(result => result.contract);
  return found ? json(found) : json({ error: results.find(result => result.error !== "quote_transport_unavailable")?.error ?? "quote_transport_unavailable" }, 409);
}

export async function createCatalogQuoteRequestResponse(
  request: Request,
  d1: D1Database,
  options: { nowMs: number; caller?: string } & QuoteRateLimitOptions,
): Promise<Response> {
  const url = new URL(request.url);
  const agentId = url.pathname.split("/").at(-1) ?? "";
  if (!AGENT_ID.test(agentId)) return json({ error: "invalid_request" }, 400);
  const input = await body(request);
  let template = input ? briefInput(input) : null;
  const structured = input?.schemaVersion === 2;
  if (!template && !structured) return json({ error: "invalid_brief" }, 400);
  if (structured && (Object.keys(input!).sort().join(",") !== "contractHash,endpointKey,parameters,schemaVersion"
    || typeof input!.endpointKey !== "string" || !/^[a-f0-9]{64}$/.test(input!.endpointKey)
    || typeof input!.contractHash !== "string" || !/^[a-f0-9]{64}$/.test(input!.contractHash))) return json({ error: "invalid_parameters" }, 400);
  const db = createDatabase(d1 as never);
  // If the scheduler has recently proved a capability, keep a buyer request
  // on that same endpoint. This prevents a multi-endpoint seller from showing
  // Ready to quote while the interactive flow silently negotiates elsewhere.
  const readyCapability = await db.select({ endpointKey: catalogSellerCapabilities.endpointKey })
    .from(catalogSellerCapabilities)
    .where(and(
      eq(catalogSellerCapabilities.agentKey, `eip155:56:${agentId}`),
      eq(catalogSellerCapabilities.state, "ready"),
      gt(catalogSellerCapabilities.capabilityExpiresAt, options.nowMs),
    ))
    .orderBy(desc(catalogSellerCapabilities.updatedAt), catalogSellerCapabilities.endpointKey)
    .limit(1);
  const target = await targetFor(
    db,
    agentId,
    structured ? input!.endpointKey as string : readyCapability[0]?.endpointKey,
    structured || readyCapability[0] ? undefined : ["a2a", "erc8183_http"],
  );
  if (!target) return json({ error: "quote_transport_unavailable" }, 409);
  const caller = options.caller ?? "anonymous";
  const limited = await quoteRateLimit(db, {
    agentKey: target.agentKey,
    originKey: target.originKey,
    caller,
    nowMs: options.nowMs,
  }, options);
  if (limited) return json({ error: "quote_rate_limited", code: limited.code, retryAfterSeconds: limited.retryAfterSeconds }, 429, {
    "retry-after": String(limited.retryAfterSeconds),
  });
  if (structured) {
    try {
      const contract = await discoverNegotiationInput({ ...target, request: {}, fetch, timeoutMs: 5000, maxResponseBytes: 32768 });
      const schemaHash = await sha256(contract);
      await recordCompatibility(db, target, options.nowMs, { schemaHash, provenance: contract.provenance });
      if (schemaHash !== input!.contractHash) return json({ error: "NEGOTIATION_SCHEMA_CHANGED" }, 409);
      const value = buildContractRequest(contract, input!.parameters);
      const negotiated = NegotiationRequest.fromDict(value);
      template = { category: null, request: negotiated, requestHash: negotiated.computeHash().toLowerCase(), deliverables: String(value.terms.deliverables), qualityStandards: String(value.terms.quality_standards) };
    } catch (error) {
      const code = error instanceof Error && ERROR_CODE.test(error.message) ? error.message : "NEGOTIATION_DISCOVERY_FAILED";
      return json({ error: code }, 409);
    }
  }
  if (!template) return json({ error: "invalid_parameters" }, 400);
  const requestHash = template.requestHash;
  const existing = await db.select().from(catalogQuoteRequests).where(and(
    eq(catalogQuoteRequests.agentKey, target.agentKey),
    eq(catalogQuoteRequests.endpointKey, target.endpointKey),
    eq(catalogQuoteRequests.callerKey, caller),
    eq(catalogQuoteRequests.requestHash, requestHash),
    lt(catalogQuoteRequests.createdAt, options.nowMs + 1),
  )).orderBy(desc(catalogQuoteRequests.createdAt), desc(catalogQuoteRequests.id)).limit(1);
  if (existing[0] && existing[0].createdAt >= options.nowMs - DEDUPE_WINDOW_MS) {
    const attempt = await db.select().from(catalogQuoteAttempts).where(eq(catalogQuoteAttempts.requestId, existing[0].id))
      .orderBy(desc(catalogQuoteAttempts.startedAt)).limit(1);
    if (attempt[0]) return json({
      requestId: existing[0].id,
      attemptId: attempt[0].id,
      reused: true,
      requestHash,
      transport: target.transport,
      target: target.endpoint,
      request: template.request.toDict(),
    });
  }
  const inserted = await db.insert(catalogQuoteRequests).values({
    requestHash,
    agentKey: target.agentKey,
    endpointKey: target.endpointKey,
    transport: target.transport,
    kind: "buyer_quote",
    status: "running",
    callerKey: caller,
    createdAt: options.nowMs,
    metadataJson: metadata({ requestHash, transport: target.transport, endpoint: target.endpoint }),
  }).returning({ id: catalogQuoteRequests.id });
  const requestId = inserted[0]?.id;
  if (requestId === undefined) return json({ error: "quote_request_failed" }, 500);
  const attemptId = crypto.randomUUID();
  await db.insert(catalogQuoteAttempts).values({
    id: attemptId,
    requestId,
    executor: "browser",
    status: "pending",
    startedAt: options.nowMs,
    metadataJson: metadata({ requestHash, transport: target.transport, endpoint: target.endpoint }),
  });
  return json({
    requestId,
    attemptId,
    reused: false,
    requestHash,
    transport: target.transport,
    target: target.endpoint,
    request: template.request.toDict(),
  }, 201);
}

async function findAttempt(db: ReturnType<typeof createDatabase>, attemptId: string) {
  const rows = await db.select({
    request: catalogQuoteRequests,
    attempt: catalogQuoteAttempts,
  }).from(catalogQuoteAttempts)
    .innerJoin(catalogQuoteRequests, eq(catalogQuoteRequests.id, catalogQuoteAttempts.requestId))
    .where(eq(catalogQuoteAttempts.id, attemptId)).limit(1);
  return rows[0] ?? null;
}

function requestPayload(requestRow: typeof catalogQuoteRequests.$inferSelect): Record<string, unknown> | null {
  // The brief itself is intentionally not persisted. The browser keeps the
  // canonical request for the session and sends it back only to the fallback;
  // this parser gives the fallback a strict, bounded shape to validate before
  // it calls a seller.
  try {
    const parsed: unknown = JSON.parse(requestRow.metadataJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    return typeof value.requestHash === "string" && REQUEST_HASH.test(value.requestHash)
      && typeof value.transport === "string" && typeof value.endpoint === "string"
      ? value : null;
  } catch { return null; }
}

function browserFallbackErrorCode(request: Request): string {
  const value = request.headers.get("x-marketplace-browser-error")?.trim().toUpperCase();
  return value && ERROR_CODE.test(value) ? value : "BROWSER_FALLBACK";
}

function canonicalRequestFromBody(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value || Object.keys(value).sort().join(",") !== "task_description,terms"
    || typeof value.task_description !== "string" || value.task_description.length < 1
    || value.task_description.length > MAX_BRIEF_LENGTH * 3
    || !value.terms || typeof value.terms !== "object" || Array.isArray(value.terms)) return null;
  const terms = value.terms as Record<string, unknown>;
  if (Object.keys(terms).sort().join(",") !== "deliverables,evaluation_required,evaluator_type,quality_standards"
    || typeof terms.deliverables !== "string" || typeof terms.quality_standards !== "string"
    || terms.evaluation_required !== true || terms.evaluator_type !== "uma_oov3"
    || terms.deliverables.trim().length < 1 || terms.quality_standards.trim().length < 1
    || terms.deliverables.length > MAX_BRIEF_LENGTH || terms.quality_standards.length > MAX_BRIEF_LENGTH) return null;
  return {
    task_description: value.task_description,
    terms: {
      deliverables: terms.deliverables,
      quality_standards: terms.quality_standards,
      evaluation_required: true,
      evaluator_type: "uma_oov3",
    },
  };
}

export async function persistQuoteResult(
  db: ReturnType<typeof createDatabase>,
  env: Env,
  config: WorkerConfig,
  requestRow: typeof catalogQuoteRequests.$inferSelect,
  attemptId: string,
  envelope: Record<string, unknown>,
  executor: "browser" | "worker",
  nowMs: number,
): Promise<Response> {
  // The route receives the completion timestamp, while the attempt row owns
  // the physical start time. Read it before doing RPC/verification work so
  // public durations reflect the actual browser/Worker operation instead of
  // collapsing to zero when a result is reported quickly.
  const attemptRows = await db.select({ startedAt: catalogQuoteAttempts.startedAt })
    .from(catalogQuoteAttempts)
    .where(and(
      eq(catalogQuoteAttempts.id, attemptId),
      eq(catalogQuoteAttempts.requestId, requestRow.id),
    ))
    .limit(1);
  const started = attemptRows[0]?.startedAt ?? nowMs;
  let context: ChainContext;
  let verdict: Awaited<ReturnType<typeof validateProbeQuote>>;
  try {
    context = await readContext(env, config, requestRow.agentKey.split(":").at(-1)!, nowMs);
    const request = NegotiationRequest.fromDict((envelope.request ?? {}) as Record<string, unknown>);
    verdict = await validateProbeQuote(envelope, {
      ...context,
      nowSeconds: Math.floor(nowMs / 1_000),
      expectedRequest: request,
      expectedRequestHash: requestRow.requestHash,
      expectedDeliverables: request.terms.deliverables,
      expectedQualityStandards: request.terms.qualityStandards,
      maximumPriceRaw: MAX_MARKETPLACE_BUDGET_RAW,
    }, verifyQuoteSignature);
  } catch (error) {
    const code = error instanceof QuoteValidationError || error instanceof SellerProbeError
      ? error.code : error instanceof Error ? error.message.slice(0, 64) : "QUOTE_REJECTED";
    await updateAttempt(db, attemptId, requestRow.id, "rejected", nowMs, { errorCode: code, outcome: "quote_rejected" });
    await db.update(catalogQuoteRequests).set({ status: "rejected", completedAt: nowMs, errorCode: code })
      .where(eq(catalogQuoteRequests.id, requestRow.id));
    return json({ error: "quote_rejected", code, requestId: requestRow.id, attemptId }, 422);
  }
  const artifactHash = await sha256(envelope);
  if (verdict.outcome !== "quote_verified") {
    await updateAttempt(db, attemptId, requestRow.id, "rejected", nowMs, { outcome: "quote_rejected", errorCode: verdict.errorCode });
    await db.update(catalogQuoteRequests).set({ status: "rejected", completedAt: nowMs, errorCode: verdict.errorCode, artifactHash })
      .where(eq(catalogQuoteRequests.id, requestRow.id));
    return json({ status: "rejected", requestId: requestRow.id, attemptId, code: verdict.errorCode }, 422);
  }
  let jobDescription: string;
  try {
    // Validate this before any success/observation writes. A malformed seller
    // envelope must never leave a request marked succeeded while the hire
    // flow cannot build the public ERC-8183 description.
    jobDescription = buildJobDescription(envelope);
  } catch {
    const code = "QUOTE_DESCRIPTION_INVALID";
    await updateAttempt(db, attemptId, requestRow.id, "rejected", nowMs, { outcome: "quote_rejected", errorCode: code });
    await db.update(catalogQuoteRequests).set({ status: "rejected", completedAt: nowMs, errorCode: code })
      .where(eq(catalogQuoteRequests.id, requestRow.id));
    return json({ error: "quote_rejected", code, requestId: requestRow.id, attemptId }, 422);
  }
  const observation = await db.insert(catalogObservations).values({
    agentKey: requestRow.agentKey,
    endpointKey: requestRow.endpointKey,
    protocol: requestRow.transport,
    source: executor === "browser" ? "browser_reported" : "worker_probe",
    outcome: "quote_verified",
    observedAt: nowMs,
    expiresAt: verdict.quoteExpiresAt,
    durationMs: Math.max(0, nowMs - started),
    detailsJson: JSON.stringify({
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
      quoteKind: requestRow.kind,
      commerce: context.commerce,
      router: context.router,
      policy: context.policy,
    }),
    attemptId,
    validationKind: "quote",
    verificationLevel: "cryptographic",
    artifactHash,
  }).onConflictDoNothing().returning({ id: catalogObservations.id });
  const observationId = observation[0]?.id ?? null;
  // Quote verification reads the fixed ERC-8183 deployment, provider wallet,
  // token and policy before accepting the seller envelope. Persist that read
  // as a short-lived onchain observation so the UI can explain why Review is
  // unlocked without requiring a second RPC round trip.
  await db.insert(catalogObservations).values({
    agentKey: requestRow.agentKey,
    endpointKey: requestRow.endpointKey,
    protocol: "erc8183",
    source: "chain_read",
    outcome: "erc8183_detected",
    observedAt: nowMs,
    expiresAt: nowMs + CHAIN_EVIDENCE_TTL_MS,
    durationMs: Math.max(0, nowMs - started),
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
      quoteKind: requestRow.kind,
    }),
    // An attempt may have one quote observation and one chain-read
    // observation; suffixing keeps the append-only attempt index unique.
    attemptId: `${attemptId}:chain`,
    validationKind: "chain",
    verificationLevel: "onchain",
    artifactHash,
  }).onConflictDoNothing();
  await db.update(catalogQuoteAttempts).set({
    executor,
    status: "succeeded",
    finishedAt: nowMs,
    durationMs: Math.max(0, nowMs - started),
    outcome: "quote_verified",
  }).where(eq(catalogQuoteAttempts.id, attemptId));
  await db.update(catalogQuoteRequests).set({
    status: "succeeded",
    completedAt: nowMs,
    quoteExpiresAt: verdict.quoteExpiresAt,
    resultObservationId: observationId,
    artifactHash,
  }).where(eq(catalogQuoteRequests.id, requestRow.id));
  await db.insert(catalogSellerCapabilities).values({
    agentKey: requestRow.agentKey,
    endpointKey: requestRow.endpointKey,
    transport: requestRow.transport,
    state: "ready",
    lastSuccessAt: nowMs,
    capabilityExpiresAt: nowMs + CAPABILITY_TTL_MS,
    nextProbeAt: nowMs + CAPABILITY_TTL_MS,
    consecutiveFailures: 0,
    lastAttemptAt: nowMs,
    lastAttemptId: attemptId,
    lastErrorCode: null,
    createdAt: nowMs,
    updatedAt: nowMs,
  }).onConflictDoUpdate({ target: [catalogSellerCapabilities.agentKey, catalogSellerCapabilities.endpointKey], set: {
    state: "ready", lastSuccessAt: nowMs, capabilityExpiresAt: nowMs + CAPABILITY_TTL_MS,
    nextProbeAt: nowMs + CAPABILITY_TTL_MS, consecutiveFailures: 0,
    lastAttemptAt: nowMs, lastAttemptId: attemptId, lastErrorCode: null, updatedAt: nowMs,
  }});
  const endpoint = (() => {
    try {
      const parsed = JSON.parse(requestRow.metadataJson) as { endpoint?: unknown };
      return typeof parsed.endpoint === "string" ? parsed.endpoint : null;
    } catch { return null; }
  })();
  const normalizedQuote = {
    envelope,
    agentId: Number(requestRow.agentKey.split(":").at(-1)),
    chainId: 56 as const,
    provider: verdict.provider,
    ...(endpoint ? { endpoint } : {}),
    commerce: context.commerce,
    router: context.router,
    policy: context.policy,
    token: verdict.currency,
    tokenSymbol: context.tokenSymbol,
    tokenDecimals: verdict.decimals,
    priceRaw: verdict.priceRaw,
    priceDisplay: formatUnits(BigInt(verdict.priceRaw), verdict.decimals),
    negotiatedAt: Math.floor(verdict.quoteNegotiatedAt / 1_000),
    quoteExpiresAt: Math.floor(verdict.quoteExpiresAt / 1_000),
    maximumBudgetRaw: MAX_MARKETPLACE_BUDGET_RAW.toString(),
    description: jobDescription,
    observationId,
  };
  return json({
    status: "succeeded",
    requestId: requestRow.id,
    attemptId,
    quote: normalizedQuote,
    capability: { state: "ready", expiresAt: nowMs + CAPABILITY_TTL_MS },
  }, 201);
}

export async function catalogQuoteBrowserResultResponse(request: Request, d1: D1Database, attemptId: string, options: { nowMs: number; env: Env; config: WorkerConfig; expectedAgentId?: string }): Promise<Response> {
  if (!ATTEMPT_ID.test(attemptId)) return json({ error: "invalid_request" }, 400);
  const input = await body(request);
  if (!input || input.schemaVersion !== 1) return json({ error: "invalid_request" }, 400);
  const db = createDatabase(d1 as never);
  const found = await findAttempt(db, attemptId);
  if (!found) return json({ error: "not_found" }, 404);
  if (options.expectedAgentId !== undefined && found.request.agentKey !== `eip155:56:${options.expectedAgentId}`) return json({ error: "not_found" }, 404);
  if (found.attempt.executor !== "browser") return json({ error: "invalid_executor" }, 409);
  if (found.attempt.status === "succeeded" || found.attempt.status === "rejected" || found.attempt.status === "failed") {
    return json({ error: "attempt_completed" }, 409);
  }
  // A browser can report a deterministic seller rejection/invalid response
  // without asking the Worker to repeat the same call. Keep the code short and
  // sanitized because it is public diagnostic metadata.
  if (Object.keys(input).sort().join(",") === "errorCode,schemaVersion") {
    if (typeof input.errorCode !== "string" || !ERROR_CODE.test(input.errorCode)) return json({ error: "invalid_request" }, 400);
    await updateAttempt(db, attemptId, found.request.id, "failed", options.nowMs, {
      errorCode: input.errorCode,
      outcome: "error",
    });
    await db.update(catalogQuoteRequests).set({
      status: "failed",
      completedAt: options.nowMs,
      errorCode: input.errorCode,
    }).where(eq(catalogQuoteRequests.id, found.request.id));
    return json({ status: "failed", requestId: found.request.id, attemptId, code: input.errorCode }, 201);
  }
  if (Object.keys(input).sort().join(",") !== "envelope,schemaVersion"
    || !input.envelope || typeof input.envelope !== "object" || Array.isArray(input.envelope)) return json({ error: "invalid_request" }, 400);
  return persistQuoteResult(db, options.env, options.config, found.request, attemptId, input.envelope as Record<string, unknown>, "browser", options.nowMs);
}

export async function catalogQuoteFallbackResponse(request: Request, d1: D1Database, attemptId: string, options: { nowMs: number; env: Env; config: WorkerConfig; expectedAgentId?: string }): Promise<Response> {
  if (!ATTEMPT_ID.test(attemptId)) return json({ error: "invalid_request" }, 400);
  const db = createDatabase(d1 as never);
  const found = await findAttempt(db, attemptId);
  if (!found) return json({ error: "not_found" }, 404);
  if (options.expectedAgentId !== undefined && found.request.agentKey !== `eip155:56:${options.expectedAgentId}`) return json({ error: "not_found" }, 404);
  if (found.attempt.status === "succeeded" || found.attempt.status === "rejected" || found.attempt.status === "failed") {
    return json({ error: "attempt_completed" }, 409);
  }
  if (found.request.kind !== "buyer_quote") return json({ error: "invalid_request_kind" }, 409);
  const requestData = requestPayload(found.request) as { requestHash: string; transport: string; endpoint: string } | null;
  if (!requestData || !REQUEST_HASH.test(requestData.requestHash)) return json({ error: "request_metadata_invalid" }, 500);
  const requestObject = await body(request);
  const canonicalRequest = canonicalRequestFromBody(requestObject);
  if (!canonicalRequest) {
    await updateAttempt(db, attemptId, found.request.id, "failed", options.nowMs, { errorCode: "QUOTE_REQUEST_INVALID", outcome: "error" });
    await db.update(catalogQuoteRequests).set({ status: "failed", completedAt: options.nowMs, errorCode: "QUOTE_REQUEST_INVALID" })
      .where(eq(catalogQuoteRequests.id, found.request.id));
    return json({ error: "quote_attempt_failed", code: "QUOTE_REQUEST_INVALID", requestId: found.request.id, attemptId }, 400);
  }
  const taskDescription = canonicalRequest.task_description as string;
  const terms = canonicalRequest.terms as Record<string, unknown>;
  // Validate the actual canonical request hash through the SDK instead of
  // trusting arbitrary fallback input.
  const expectedHash = (() => {
    try {
      const parsed = NegotiationRequest.fromDict(canonicalRequest);
      return parsed.computeHash().toLowerCase();
    } catch { return null; }
  })();
  if (expectedHash !== found.request.requestHash) {
    await updateAttempt(db, attemptId, found.request.id, "failed", options.nowMs, { errorCode: "QUOTE_REQUEST_HASH_MISMATCH", outcome: "error" });
    await db.update(catalogQuoteRequests).set({ status: "failed", completedAt: options.nowMs, errorCode: "QUOTE_REQUEST_HASH_MISMATCH" })
      .where(eq(catalogQuoteRequests.id, found.request.id));
    return json({ error: "quote_attempt_failed", code: "QUOTE_REQUEST_HASH_MISMATCH", requestId: found.request.id, attemptId }, 400);
  }
  // Browser-first is a single logical request, but every physical execution
  // must remain auditable. Close the browser attempt as a fallback event and
  // create a separate Worker attempt instead of mutating its executor.
  const browserErrorCode = browserFallbackErrorCode(request);
  await updateAttempt(db, attemptId, found.request.id, "failed", options.nowMs, {
    errorCode: browserErrorCode,
    outcome: "fallback",
    metadataJson: JSON.stringify({
      requestHash: found.request.requestHash,
      transport: found.request.transport,
      endpoint: requestData.endpoint,
      fallback: "worker",
    }),
  });
  const workerAttemptId = crypto.randomUUID();
  await db.insert(catalogQuoteAttempts).values({
    id: workerAttemptId,
    requestId: found.request.id,
    executor: "worker",
    status: "running",
    startedAt: options.nowMs,
    metadataJson: JSON.stringify({
      requestHash: found.request.requestHash,
      transport: found.request.transport,
      endpoint: requestData.endpoint,
      fallbackFromAttemptId: attemptId,
    }),
  });
  const deliverables = terms.deliverables as string;
  const qualityStandards = terms.quality_standards as string;
  const probeInput = {
    endpoint: requestData.endpoint,
    request: canonicalRequest,
    timeoutMs: options.config.probeTimeoutMs,
    maxResponseBytes: options.config.maxSellerResponseBytes,
    fetch,
    taskDescription,
    terms: {
      deliverables,
      quality_standards: qualityStandards,
      evaluation_required: true as const,
      evaluator_type: "uma_oov3" as const,
    },
    ...(found.request.transport === "a2a" ? { requireNotifyFunded: false } : {}),
  };
  try {
    const result = found.request.transport === "a2a"
      ? await probeA2aSeller(probeInput)
      : found.request.transport === "mcp"
        ? await probeMcpSeller(probeInput)
      : await (async () => {
        const context = await readContext(options.env, options.config, found.request.agentKey.split(":").at(-1)!, options.nowMs);
        return probeErc8183HttpSeller({
          ...probeInput,
          expectedHttpStatus: {
            provider: context.provider,
            commerce: context.commerce,
            router: context.router,
            policy: context.policy,
            currency: context.paymentToken,
            decimals: context.tokenDecimals,
          },
        });
      })();
    return persistQuoteResult(
      db,
      options.env,
      options.config,
      found.request,
      workerAttemptId,
      { ...result.quote, request: result.quote.request ?? canonicalRequest },
      "worker",
      options.nowMs,
    );
  } catch (error) {
    const code = error instanceof SellerProbeError ? error.code : "SELLER_UNREACHABLE";
    await updateAttempt(db, workerAttemptId, found.request.id, "failed", options.nowMs, { errorCode: code, outcome: "error" });
    await db.update(catalogQuoteRequests).set({ status: "failed", completedAt: options.nowMs, errorCode: code }).where(eq(catalogQuoteRequests.id, found.request.id));
    return json({ error: "quote_attempt_failed", code, requestId: found.request.id, attemptId: workerAttemptId, browserAttemptId: attemptId }, 502);
  }
}

export async function catalogQuoteHistoryResponse(request: Request, d1: D1Database, agentId: string, nowMs = Date.now()): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const pageValue = params.get("page");
  if (!AGENT_ID.test(agentId) || [...params.keys()].some(key => key !== "page") || params.getAll("page").length > 1
    || (pageValue !== null && !/^[1-9]\d{0,5}$/.test(pageValue))) return json({ error: "invalid_request" }, 400);
  const page = pageValue === null ? null : Number(pageValue);
  const db = createDatabase(d1 as never);
  // Page logical requests first. A browser-first request may have a failed
  // browser attempt followed by a Worker fallback, so applying LIMIT to a
  // joined request/attempt query can silently drop older logical requests.
  // The public history is capped at 100 requests, never at 100 physical tries.
  const requestRows = await db.select({
    id: catalogQuoteRequests.id,
    requestHash: catalogQuoteRequests.requestHash,
    kind: catalogQuoteRequests.kind,
    status: catalogQuoteRequests.status,
    transport: catalogQuoteRequests.transport,
    requestMetadataJson: catalogQuoteRequests.metadataJson,
    createdAt: catalogQuoteRequests.createdAt,
    completedAt: catalogQuoteRequests.completedAt,
    quoteExpiresAt: catalogQuoteRequests.quoteExpiresAt,
    errorCode: catalogQuoteRequests.errorCode,
    resultObservationId: catalogQuoteRequests.resultObservationId,
  }).from(catalogQuoteRequests)
    .where(and(eq(catalogQuoteRequests.agentKey, `eip155:56:${agentId}`), sql`${catalogQuoteRequests.callerKey} <> 'migration'`))
    .orderBy(desc(catalogQuoteRequests.createdAt), desc(catalogQuoteRequests.id)).limit(page === null ? 100 : 5).offset(page === null ? 0 : (page - 1) * 5);
  const requestIds = requestRows.map((row) => row.id);
  const attempts = requestIds.length === 0 ? [] : await db.select({
    id: catalogQuoteAttempts.id,
    requestId: catalogQuoteAttempts.requestId,
    executor: catalogQuoteAttempts.executor,
    status: catalogQuoteAttempts.status,
    durationMs: catalogQuoteAttempts.durationMs,
    httpStatus: catalogQuoteAttempts.httpStatus,
    outcome: catalogQuoteAttempts.outcome,
    errorCode: catalogQuoteAttempts.errorCode,
    startedAt: catalogQuoteAttempts.startedAt,
  }).from(catalogQuoteAttempts)
    .where(inArray(catalogQuoteAttempts.requestId, requestIds))
    .orderBy(desc(catalogQuoteAttempts.startedAt), desc(catalogQuoteAttempts.id));
  const observationIds = requestRows.flatMap((row) => row.resultObservationId === null ? [] : [row.resultObservationId]);
  const observations = observationIds.length === 0 ? [] : await db.select({
    id: catalogObservations.id,
    detailsJson: catalogObservations.detailsJson,
  }).from(catalogObservations).where(inArray(catalogObservations.id, observationIds));
  const observationById = new Map(observations.map((row) => [row.id, row.detailsJson]));
  const attemptsByRequest = new Map<number, typeof attempts>();
  for (const attempt of attempts) {
    const list = attemptsByRequest.get(attempt.requestId) ?? [];
    list.push(attempt);
    attemptsByRequest.set(attempt.requestId, list);
  }
  const requests = new Map<number, { id: number; requestHash: string; kind: string; status: string; transport: string; endpoint: string | null; provider: string | null; createdAt: number; completedAt: number | null; quoteExpiresAt: number | null; errorCode: string | null; resultObservationId: number | null; attempts: Array<{ id: string; executor: string; status: string; durationMs: number | null; httpStatus: number | null; outcome: string | null; errorCode: string | null }> }>();
  for (const row of requestRows) {
    const status = row.status === "succeeded" && row.quoteExpiresAt !== null && row.quoteExpiresAt <= nowMs
      ? "expired" : row.status;
    const observationMetadata = (() => {
      try {
        const value = JSON.parse(row.resultObservationId === null ? "{}" : observationById.get(row.resultObservationId) ?? "{}") as { provider?: unknown };
        return typeof value.provider === "string" ? value.provider : null;
      } catch { return null; }
    })();
    const requestMetadata = (() => {
      try {
        const value = JSON.parse(row.requestMetadataJson ?? "{}") as { endpoint?: unknown };
        return typeof value.endpoint === "string" ? value.endpoint : null;
      } catch { return null; }
    })();
    const current = requests.get(row.id) ?? { id: row.id, requestHash: row.requestHash, kind: row.kind, status, transport: row.transport, endpoint: requestMetadata, provider: observationMetadata, createdAt: row.createdAt, completedAt: row.completedAt, quoteExpiresAt: row.quoteExpiresAt, errorCode: row.errorCode, resultObservationId: row.resultObservationId, attempts: [] };
    if (current.provider === null && observationMetadata !== null) current.provider = observationMetadata;
    if (current.endpoint === null && requestMetadata !== null) current.endpoint = requestMetadata;
    current.attempts = (attemptsByRequest.get(row.id) ?? []).map((attempt) => ({
      id: attempt.id,
      executor: attempt.executor,
      status: attempt.status,
      durationMs: attempt.durationMs,
      httpStatus: attempt.httpStatus,
      outcome: attempt.outcome,
      errorCode: attempt.errorCode,
    }));
    requests.set(row.id, current);
  }
  const allRequests = [...requests.values()];
  const effectiveStatus = sql<string>`CASE WHEN ${catalogQuoteRequests.status} = 'succeeded' AND ${catalogQuoteRequests.quoteExpiresAt} <= ${nowMs} THEN 'expired' ELSE ${catalogQuoteRequests.status} END`;
  const totals = await db.select({ kind: catalogQuoteRequests.kind, status: effectiveStatus, total: count(), verified: sql<number>`SUM(CASE WHEN ${catalogQuoteRequests.status} = 'succeeded' THEN 1 ELSE 0 END)` }).from(catalogQuoteRequests)
    .where(and(eq(catalogQuoteRequests.agentKey, `eip155:56:${agentId}`), sql`${catalogQuoteRequests.callerKey} <> 'migration'`)).groupBy(catalogQuoteRequests.kind, effectiveStatus);
  const migrated = await db.select({ total: count() }).from(catalogQuoteRequests).where(and(eq(catalogQuoteRequests.agentKey, `eip155:56:${agentId}`), eq(catalogQuoteRequests.callerKey, "migration")));
  const buyerRequests = totals.filter((entry) => entry.kind === "buyer_quote");
  const capabilityProbes = totals.filter((entry) => entry.kind === "capability_probe");
  const sum = (rows: typeof totals) => rows.reduce((total, row) => total + row.total, 0);
  const byStatus = (rows: typeof totals, status: string) => sum(rows.filter((entry) => entry.status === status));
  return json({ schemaVersion: 1, agentId, counts: {
    importedObservations: Number(migrated[0]?.total ?? 0),
    // Keep the aggregate fields for older clients, but expose kind-specific
    // totals so a capacity probe is never presented as a buyer quote.
    requests: sum(totals),
    succeeded: byStatus(totals, "succeeded"),
    rejected: byStatus(totals, "rejected"),
    failed: byStatus(totals, "failed"),
    expired: byStatus(totals, "expired"),
    buyerRequests: sum(buyerRequests),
    buyerSucceeded: byStatus(buyerRequests, "succeeded"),
    buyerVerified: buyerRequests.reduce((total, row) => total + Number(row.verified), 0),
    buyerRejected: byStatus(buyerRequests, "rejected"),
    buyerFailed: byStatus(buyerRequests, "failed"),
    buyerExpired: byStatus(buyerRequests, "expired"),
    capabilityProbes: sum(capabilityProbes),
    capabilitySucceeded: byStatus(capabilityProbes, "succeeded"),
  }, requests: allRequests, ...(page === null ? {} : { pagination: { page, pageSize: 5, total: sum(totals), hasMore: page * 5 < sum(totals) } }) });
}

export function callerForQuote(request: Request): string {
  return callerKey(request) ?? "anonymous";
}
