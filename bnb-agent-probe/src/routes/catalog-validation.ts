import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import {
  catalogAgentEndpoints,
  catalogEndpoints,
  catalogObservations,
  catalogValidationRequests,
} from "../db/schema";
import { publicCatalogObservation } from "../catalog/api-contract";
import { callerKey } from "../lib/caller-key";
import type { D1Database, QueueProducer } from "../types";

const MAX_BODY_BYTES = 1_024;
const AGENT_ID = /^[1-9]\d*$/;
const ENDPOINT_KEY = /^[0-9a-f]{64}$/;
const REQUEST_COOLDOWN_MS = 60_000;

class InvalidValidationRequest extends Error {}

async function input(request: Request): Promise<{ agentId: string; endpointKey: string; validationKind: "protocol" }> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new InvalidValidationRequest();
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new InvalidValidationRequest();
  let value: unknown;
  try { value = JSON.parse(body) as unknown; } catch { throw new InvalidValidationRequest(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidValidationRequest();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "agentId,endpointKey,schemaVersion,validationKind"
    || record.schemaVersion !== 2
    || typeof record.agentId !== "string" || !AGENT_ID.test(record.agentId)
    || typeof record.endpointKey !== "string" || !ENDPOINT_KEY.test(record.endpointKey)
    || record.validationKind !== "protocol") throw new InvalidValidationRequest();
  return record as { agentId: string; endpointKey: string; validationKind: "protocol" };
}

export async function createCatalogValidationResponse(
  request: Request,
  d1: D1Database,
  queue: QueueProducer | undefined,
  nowMs: number,
  dailyLimit: number,
  callerDailyLimit = dailyLimit,
): Promise<Response> {
  let parsed: Awaited<ReturnType<typeof input>>;
  try { parsed = await input(request); } catch {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const caller = callerKey(request);
  if (caller === null) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (!queue) return Response.json({ error: "queue_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const agentKey = `eip155:56:${parsed.agentId}`;
  const targets = await db.select({
    endpointKey: catalogEndpoints.endpointKey,
    validationProtocol: catalogEndpoints.validationProtocol,
    lastSuccessfulAt: catalogEndpoints.lastSuccessfulAt,
    lastAttemptOutcome: catalogEndpoints.lastAttemptOutcome,
    nextProbeAt: catalogEndpoints.nextProbeAt,
  }).from(catalogAgentEndpoints)
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgentEndpoints.agentKey, agentKey),
      eq(catalogAgentEndpoints.endpointKey, parsed.endpointKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
      inArray(catalogEndpoints.validationProtocol, ["a2a", "mcp", "erc8183_http"]),
    )).limit(1);
  const target = targets[0];
  if (!target) return Response.json({ error: "target_unavailable" }, { status: 409, headers: { "cache-control": "no-store" } });
  const expectedProtocol = target.validationProtocol;
  if (!expectedProtocol) return Response.json({ error: "target_unavailable" }, { status: 409, headers: { "cache-control": "no-store" } });
  const latestPlatformObservation = await db.select({
    outcome: catalogObservations.outcome,
    expiresAt: catalogObservations.expiresAt,
  }).from(catalogObservations).where(and(
    eq(catalogObservations.agentKey, agentKey),
    eq(catalogObservations.endpointKey, parsed.endpointKey),
    inArray(catalogObservations.source, ["worker_probe", "buyer_refresh", "migration"]),
    eq(catalogObservations.validationKind, "protocol"),
    eq(catalogObservations.verificationLevel, "platform_observed"),
    eq(catalogObservations.protocol, expectedProtocol),
  )).orderBy(desc(catalogObservations.observedAt), desc(catalogObservations.id)).limit(1);
  if (latestPlatformObservation[0]?.outcome === "protocol_valid"
    && latestPlatformObservation[0].expiresAt !== null
    && latestPlatformObservation[0].expiresAt > nowMs) {
    return Response.json({ status: "completed", reused: true, validationId: null }, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  }

  // Observations are scoped to the declaring agent even when two agents share
  // an origin/path. Do not let one agent reuse a request whose result is
  // committed under another agent key.
  const dedupeKey = `${agentKey}:${parsed.endpointKey}:${parsed.validationKind}`;
  const latest = await db.select().from(catalogValidationRequests)
    .where(eq(catalogValidationRequests.dedupeKey, dedupeKey))
    .orderBy(desc(catalogValidationRequests.createdAt), desc(catalogValidationRequests.id))
    .limit(1);
  if (latest[0] && (latest[0].status === "queued" || latest[0].status === "running")) {
    return Response.json({ status: latest[0].status, reused: true, validationId: latest[0].id }, {
      status: 202,
      headers: { "cache-control": "no-store" },
    });
  }
  if (latest[0] && latest[0].createdAt > nowMs - REQUEST_COOLDOWN_MS) {
    const retryAfterMs = latest[0].createdAt + REQUEST_COOLDOWN_MS - nowMs;
    return Response.json({ error: "rate_limited", validationId: latest[0].id, retryAfterMs }, {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": String(Math.ceil(retryAfterMs / 1_000)) },
    });
  }
  const dayStart = Math.floor(nowMs / 86_400_000) * 86_400_000;
  const dailyRows = await db.select({ total: count() }).from(catalogValidationRequests).where(and(
    eq(catalogValidationRequests.requestedBy, "browser_fallback"),
    eq(catalogValidationRequests.validationKind, "protocol"),
    gte(catalogValidationRequests.createdAt, dayStart),
  ));
  if ((dailyRows[0]?.total ?? 0) >= dailyLimit) {
    const retryAfterMs = dayStart + 86_400_000 - nowMs;
    return Response.json({ error: "daily_budget_exhausted", retryAfterMs }, {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": String(Math.ceil(retryAfterMs / 1_000)) },
    });
  }
  const callerRows = await db.select({ total: count() }).from(catalogValidationRequests).where(and(
    eq(catalogValidationRequests.callerKey, caller),
    eq(catalogValidationRequests.requestedBy, "browser_fallback"),
    eq(catalogValidationRequests.validationKind, "protocol"),
    gte(catalogValidationRequests.createdAt, dayStart),
  ));
  if ((callerRows[0]?.total ?? 0) >= callerDailyLimit) {
    const retryAfterMs = dayStart + 86_400_000 - nowMs;
    return Response.json({ error: "caller_daily_budget_exhausted", retryAfterMs }, {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": String(Math.ceil(retryAfterMs / 1_000)) },
    });
  }
  const inserted = await db.insert(catalogValidationRequests).values({
    dedupeKey,
    agentKey,
    endpointKey: parsed.endpointKey,
    validationKind: parsed.validationKind,
    requestedBy: "browser_fallback",
    callerKey: caller,
    status: "queued",
    priority: 1_000,
    createdAt: nowMs,
  }).onConflictDoNothing().returning({ id: catalogValidationRequests.id });
  const validationId = inserted[0]?.id;
  if (validationId === undefined) {
    const raced = await db.select({ id: catalogValidationRequests.id, status: catalogValidationRequests.status })
      .from(catalogValidationRequests).where(and(
        eq(catalogValidationRequests.dedupeKey, dedupeKey),
        inArray(catalogValidationRequests.status, ["queued", "running"]),
      )).limit(1);
    if (!raced[0]) throw new Error("CATALOG_VALIDATION_DEDUPE_FAILED");
    return Response.json({ status: raced[0].status, reused: true, validationId: raced[0].id }, {
      status: 202, headers: { "cache-control": "no-store" },
    });
  }
  try {
    await queue.send({ schemaVersion: 2, kind: "catalog_validation", validationId, enqueuedAt: nowMs });
  } catch {
    await db.update(catalogValidationRequests).set({
      status: "failed",
      completedAt: nowMs,
      errorCode: "QUEUE_SEND_FAILED",
    }).where(eq(catalogValidationRequests.id, validationId));
    return Response.json({ error: "queue_unavailable", validationId }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  return Response.json({ status: "queued", reused: false, validationId }, {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
}

export async function catalogValidationStatusResponse(request: Request, d1: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const rawId = url.pathname.split("/").at(-1) ?? "";
  if (!/^\d+$/.test(rawId) || url.search !== "") {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const id = Number(rawId);
  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const rows = await db.select().from(catalogValidationRequests).where(eq(catalogValidationRequests.id, id)).limit(1);
  if (!rows[0]) return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  const validation = rows[0];
  // Return only a committed protocol observation for the exact request target.
  // The request row is internal state, so a linked observation is not enough by
  // itself: require the normalized validation kind, platform verification and
  // the endpoint's expected validation protocol before exposing any result.
  const expectedProtocolRows = await db.select({
    protocol: catalogEndpoints.validationProtocol,
  }).from(catalogEndpoints).where(and(
    eq(catalogEndpoints.endpointKey, validation.endpointKey),
    eq(catalogEndpoints.role, "operational"),
    eq(catalogEndpoints.eligibility, "eligible"),
  )).limit(1);
  const expectedProtocol = expectedProtocolRows[0]?.protocol;
  const resultRows = validation.validationKind !== "protocol"
    || validation.resultObservationId === null
    || expectedProtocol === null
    || expectedProtocol === undefined
    ? []
    : await db.select().from(catalogObservations).where(and(
      eq(catalogObservations.id, validation.resultObservationId),
      eq(catalogObservations.agentKey, validation.agentKey),
      eq(catalogObservations.endpointKey, validation.endpointKey),
      eq(catalogObservations.validationKind, "protocol"),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      eq(catalogObservations.protocol, expectedProtocol),
    )).limit(1);
  const publicResult = resultRows[0] ? publicCatalogObservation(resultRows[0]) : null;
  // Keep the polling contract explicitly allowlisted. Dedupe, caller,
  // result-id and lease metadata are internal coordination fields and must
  // never cross the Worker boundary.
  const result = publicResult ? {
    protocol: publicResult.protocol,
    source: publicResult.source,
    outcome: publicResult.outcome,
    observedAt: publicResult.observedAt,
    expiresAt: publicResult.expiresAt,
    httpStatus: publicResult.httpStatus,
    durationMs: publicResult.durationMs,
  } : null;
  return Response.json({ schemaVersion: 2, validation: {
    id: validation.id,
    agentKey: validation.agentKey,
    endpointKey: validation.endpointKey,
    validationKind: validation.validationKind,
    status: validation.status,
    attemptCount: validation.attemptCount,
    createdAt: validation.createdAt,
    startedAt: validation.startedAt,
    completedAt: validation.completedAt,
    errorCode: validation.errorCode,
    hasResult: result !== null,
    result,
  } }, { headers: { "cache-control": "no-store" } });
}
