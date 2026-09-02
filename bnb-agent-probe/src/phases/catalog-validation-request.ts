import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { WorkerConfig } from "../config";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import { catalogAgentEndpoints, catalogEndpoints, catalogObservations, catalogValidationRequests } from "../db/schema";
import { catalogProbeFreshnessMs, catalogProbeSchedulePolicy, catalogProbeTimeoutMs } from "../catalog/probe-policy";
import { catalogProbeCommitStatements } from "./catalog-probe-d1";
import { probeCatalogEndpoint, type CatalogProbeTarget } from "./catalog-probe";

const LEASE_MS = 30_000;
type CatalogValidationLogger = Pick<Console, "info" | "error">;

export async function runCatalogValidationRequest(
  d1: D1DatabaseLike,
  validationId: number,
  config: WorkerConfig,
  now: () => number = Date.now,
  fetchImpl?: typeof fetch,
  logger: CatalogValidationLogger = console,
): Promise<"completed" | "duplicate"> {
  const requestFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const db = createDatabase(d1);
  const nowMs = now();
  const requests = await db.select().from(catalogValidationRequests)
    .where(eq(catalogValidationRequests.id, validationId)).limit(1);
  const request = requests[0];
  if (!request || request.status === "completed" || request.status === "cancelled") return "duplicate";
  const requestLeaseOwner = crypto.randomUUID();
  const claimed = await db.update(catalogValidationRequests).set({
    status: "running",
    startedAt: request.startedAt ?? nowMs,
    attemptCount: sql`${catalogValidationRequests.attemptCount} + 1`,
    leaseOwner: requestLeaseOwner,
    leaseExpiresAt: nowMs + LEASE_MS,
  }).where(and(
    eq(catalogValidationRequests.id, validationId),
    or(
      inArray(catalogValidationRequests.status, ["queued", "failed"]),
      and(
        eq(catalogValidationRequests.status, "running"),
        lte(catalogValidationRequests.leaseExpiresAt, nowMs),
      ),
    ),
  )).returning({ id: catalogValidationRequests.id });
  if (claimed.length === 0) return "duplicate";

  const rows = await db.select({
    agentKey: catalogAgentEndpoints.agentKey,
    endpointKey: catalogEndpoints.endpointKey,
    protocol: catalogEndpoints.validationProtocol,
    endpoint: catalogEndpoints.endpoint,
    priority: catalogAgentEndpoints.priority,
    consecutiveFailures: catalogEndpoints.consecutiveFailures,
    representativeAgentKey: catalogEndpoints.representativeAgentKey,
  }).from(catalogAgentEndpoints)
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgentEndpoints.agentKey, request.agentKey),
      eq(catalogAgentEndpoints.endpointKey, request.endpointKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
    )).limit(1);
  const row = rows[0];
  if (!row?.endpoint || !row.protocol) {
    await db.update(catalogValidationRequests).set({
      status: "failed", completedAt: now(), errorCode: "TARGET_UNAVAILABLE",
      leaseOwner: null, leaseExpiresAt: null,
    }).where(and(
      eq(catalogValidationRequests.id, validationId),
      eq(catalogValidationRequests.leaseOwner, requestLeaseOwner),
    ));
    return "completed";
  }
  const endpointLeaseOwner = `validation:${validationId}:${crypto.randomUUID()}`;
  const leaseStarted = performance.now();
  const endpointClaim = await db.update(catalogEndpoints).set({
    leaseOwner: endpointLeaseOwner,
    leaseExpiresAt: nowMs + LEASE_MS,
  }).where(and(
    eq(catalogEndpoints.endpointKey, row.endpointKey),
    or(isNull(catalogEndpoints.leaseOwner), lte(catalogEndpoints.leaseExpiresAt, nowMs)),
  )).returning({ endpointKey: catalogEndpoints.endpointKey });
  if (endpointClaim.length === 0) {
    await db.update(catalogValidationRequests).set({
      status: "queued", leaseOwner: null, leaseExpiresAt: null, errorCode: "TARGET_BUSY",
    }).where(and(
      eq(catalogValidationRequests.id, validationId),
      eq(catalogValidationRequests.leaseOwner, requestLeaseOwner),
    ));
    throw new Error("CATALOG_ENDPOINT_BUSY");
  }
  const target: CatalogProbeTarget = {
    agentKey: row.agentKey,
    endpointKey: row.endpointKey,
    protocol: row.protocol as CatalogProbeTarget["protocol"],
    endpoint: row.endpoint,
    priority: row.priority,
    consecutiveFailures: row.consecutiveFailures,
    // A null representative is an unassigned/non-representative path. Buyer
    // refreshes still append agent-scoped evidence, but must not mutate the
    // shared projection owned by the selected representative.
    isRepresentative: row.representativeAgentKey === row.agentKey,
    leaseOwner: endpointLeaseOwner,
    queueDelayMs: Math.max(0, nowMs - request.createdAt),
    leaseWaitMs: Math.max(0, Math.round(performance.now() - leaseStarted)),
  };
  try {
    const observation = {
      ...await probeCatalogEndpoint(target, {
        timeoutMs: catalogProbeTimeoutMs(config, target.protocol),
        maxResponseBytes: config.maxSellerResponseBytes,
        freshnessMs: catalogProbeFreshnessMs(config, target),
        fetchImpl: requestFetch,
        now,
      }),
      attemptId: crypto.randomUUID(),
    };
    const statements = catalogProbeCommitStatements(
      db,
      target,
      observation,
      "buyer_refresh",
      catalogProbeSchedulePolicy(config),
    );
    const results = await db.batch([
      ...statements,
      db.update(catalogValidationRequests).set({
        status: "completed", completedAt: now(), errorCode: observation.errorCode,
        resultObservationId: sql`(SELECT ${catalogObservations.id} FROM ${catalogObservations}
          WHERE ${catalogObservations.attemptId} = ${observation.attemptId} LIMIT 1)`,
        leaseOwner: null, leaseExpiresAt: null,
      }).where(and(
        eq(catalogValidationRequests.id, validationId),
        eq(catalogValidationRequests.leaseOwner, requestLeaseOwner),
      )),
    ] as unknown as Parameters<typeof db.batch>[0]);
    const inserted = results[0] as Array<{ id: number }>;
    if (!inserted[0]?.id) throw new Error("CATALOG_VALIDATION_RESULT_MISSING");
    logger.info("catalog.probe.attempt", {
      attemptId: observation.attemptId,
      validationId,
      agentKey: target.agentKey,
      endpointKey: target.endpointKey,
      protocol: target.protocol,
      priority: target.priority,
      source: "buyer_refresh",
      outcome: observation.outcome,
      errorCode: observation.errorCode,
      durationMs: observation.durationMs,
      stageDurationsMs: observation.stageDurationsMs ?? {},
      queueDelayMs: target.queueDelayMs,
      leaseWaitMs: target.leaseWaitMs,
      retryDecision: observation.outcome === "protocol_valid" ? "refresh_scheduled" : "backoff_scheduled",
    });
    return "completed";
  } catch (error) {
    const releaseEndpoint = () => db.update(catalogEndpoints).set({
      leaseOwner: null,
      leaseExpiresAt: null,
    }).where(and(
      eq(catalogEndpoints.endpointKey, row.endpointKey),
      eq(catalogEndpoints.leaseOwner, endpointLeaseOwner),
    ));
    const failRequest = () => db.update(catalogValidationRequests).set({
      status: "failed",
      completedAt: now(),
      errorCode: "CATALOG_VALIDATION_RUN_FAILED",
      leaseOwner: null,
      leaseExpiresAt: null,
    }).where(and(
      eq(catalogValidationRequests.id, validationId),
      eq(catalogValidationRequests.leaseOwner, requestLeaseOwner),
    ));
    try {
      await db.batch([releaseEndpoint(), failRequest()] as unknown as Parameters<typeof db.batch>[0]);
    } catch {
      await Promise.allSettled([releaseEndpoint().run(), failRequest().run()]);
    }
    throw error;
  }
}
