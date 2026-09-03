import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import { catalogAgentAdmission, catalogAgentEndpoints, catalogEndpoints, catalogObservations } from "../db/schema";
import type { CatalogProbeSchedulePolicy } from "../catalog/probe-policy";
import type {
  CatalogProbeObservation,
  CatalogProbeTarget,
} from "./catalog-probe";

const MINUTE = 60_000;
// Candidate window for target selection: exact ordering is preserved unless
// more than this many endpoints share the boundary nextProbeAt timestamp.
const SELECTION_WINDOW_MULTIPLIER = 25;
const SELECTION_WINDOW_MINIMUM = 100;
const SUCCESS_TTL_BY_PROTOCOL = {
  a2a: 12 * 60 * MINUTE,
  mcp: 24 * 60 * MINUTE,
  erc8183_http: 6 * 60 * MINUTE,
} as const;
const FAILURE_BACKOFF = [60 * MINUTE, 6 * 60 * MINUTE, 24 * 60 * MINUTE, 7 * 24 * 60 * MINUTE] as const;
const LEASE_MS = 30_000;
// PROBE runs once every three scheduler phases. Renew successful evidence with
// one additional tick of headroom so a healthy endpoint never expires merely
// because its due time landed immediately after the PROBE phase.
const EVIDENCE_RENEWAL_HEADROOM_MS = 4 * MINUTE;

const DEFAULT_SCHEDULE_POLICY: CatalogProbeSchedulePolicy = {
  priorityRefreshMs: 15 * MINUTE,
  refreshMsByProtocol: SUCCESS_TTL_BY_PROTOCOL,
  failureBackoffMs: FAILURE_BACKOFF,
};

function nextProbeAt(
  target: CatalogProbeTarget,
  observation: CatalogProbeObservation,
  policy: CatalogProbeSchedulePolicy,
): number {
  if (observation.outcome === "protocol_valid") {
    const scheduledAt = observation.observedAt + (target.priority >= 100
      ? policy.priorityRefreshMs
      : policy.refreshMsByProtocol[target.protocol]);
    return observation.expiresAt === null ? scheduledAt : Math.min(
      scheduledAt,
      Math.max(observation.observedAt, observation.expiresAt - EVIDENCE_RENEWAL_HEADROOM_MS),
    );
  }
  const failureIndex = Math.min(target.consecutiveFailures, policy.failureBackoffMs.length - 1);
  return observation.observedAt + policy.failureBackoffMs[failureIndex]!;
}

export function catalogProbeCommitStatements(
  db: ReturnType<typeof createDatabase>,
  target: CatalogProbeTarget,
  observation: CatalogProbeObservation,
  source: "worker_probe" | "buyer_refresh" = "worker_probe",
  policy: CatalogProbeSchedulePolicy = DEFAULT_SCHEDULE_POLICY,
) {
  const succeeded = observation.outcome === "protocol_valid";
  const updatesSharedProjection = target.isRepresentative !== false;
  return [
    db.insert(catalogObservations).values({
      agentKey: target.agentKey,
      endpointKey: target.endpointKey,
      protocol: target.protocol,
      source,
      outcome: observation.outcome,
      observedAt: observation.observedAt,
      expiresAt: observation.expiresAt,
      httpStatus: observation.httpStatus,
      errorCode: observation.errorCode,
      durationMs: observation.durationMs,
      detailsJson: JSON.stringify({
        capabilityCount: observation.capabilityCount,
        method: observation.method,
        stageDurationsMs: observation.stageDurationsMs ?? {},
        commerceCapability: observation.commerceCapability ?? null,
      }),
      attemptId: observation.attemptId ?? crypto.randomUUID(),
      validationKind: "protocol",
      verificationLevel: "platform_observed",
    }).returning({ id: catalogObservations.id }),
    db.update(catalogEndpoints).set({
      ...(updatesSharedProjection ? {
        lastProbedAt: observation.observedAt,
        lastAttemptAt: observation.observedAt,
        lastAttemptOutcome: observation.outcome,
        ...(succeeded ? { lastSuccessfulAt: observation.observedAt } : {}),
        nextProbeAt: nextProbeAt(target, observation, policy),
        consecutiveFailures: succeeded ? 0 : target.consecutiveFailures + 1,
      } : {}),
      ...(target.leaseOwner === undefined ? {} : { leaseOwner: null, leaseExpiresAt: null }),
    }).where(and(
      eq(catalogEndpoints.endpointKey, target.endpointKey),
      target.leaseOwner === undefined ? undefined : eq(catalogEndpoints.leaseOwner, target.leaseOwner),
    )),
    ...(succeeded && target.protocol === "a2a" && observation.commerceCapability === "erc8183_a2a"
      ? [db.insert(catalogAgentAdmission).values({
        agentKey: target.agentKey,
        state: "candidate",
        commerceTransport: "a2a",
        endpointKey: target.endpointKey,
        chainId: 56,
        provider: null,
        validatedAt: null,
        configurationVersion: `agent-card:${observation.observedAt}`,
        reasonCode: "QUOTE_VERIFICATION_REQUIRED",
      }).onConflictDoUpdate({
        target: catalogAgentAdmission.agentKey,
        set: {
          state: sql`CASE WHEN ${catalogAgentAdmission.state} = 'admitted'
            AND ${catalogAgentAdmission.endpointKey} = excluded.endpointKey THEN 'admitted' ELSE 'candidate' END`,
          commerceTransport: "a2a",
          endpointKey: target.endpointKey,
          configurationVersion: `agent-card:${observation.observedAt}`,
          reasonCode: sql`CASE WHEN ${catalogAgentAdmission.state} = 'admitted'
            AND ${catalogAgentAdmission.endpointKey} = excluded.endpointKey THEN NULL ELSE 'QUOTE_VERIFICATION_REQUIRED' END`,
        },
      })]
      : []),
  ] as const;
}

export function createD1CatalogProbePersistence(
  dbBinding: D1DatabaseLike,
  policy: CatalogProbeSchedulePolicy = DEFAULT_SCHEDULE_POLICY,
) {
  const db = createDatabase(dbBinding);
  return {
    async selectTargets({ limit, nowMs }: { limit: number; nowMs: number }): Promise<CatalogProbeTarget[]> {
      const due = and(
        eq(catalogEndpoints.safety, "safe"),
        eq(catalogEndpoints.role, "operational"),
        eq(catalogEndpoints.eligibility, "eligible"),
        isNotNull(catalogEndpoints.representativeAgentKey),
        isNotNull(catalogEndpoints.validationProtocol),
        isNotNull(catalogEndpoints.endpoint),
        lte(catalogEndpoints.nextProbeAt, nowMs),
        or(isNull(catalogEndpoints.leaseOwner), lte(catalogEndpoints.leaseExpiresAt, nowMs)),
      );
      // nextProbeAt is the first ordering key and idx_catalog_endpoints_lease
      // already yields it in order (ties fall in index order), so the full
      // sort (protocol, priority, lastProbedAt) only has to rank the
      // oldest-due window. Without this bound SQLite read and sorted every due
      // endpoint: 12,000 rows for 4,000 due endpoints against a 3,000-row
      // phase budget. The outer query deliberately repeats only the lease
      // check, so its sole usable index is the primary key of the window.
      const window = db.select({ endpointKey: catalogEndpoints.endpointKey })
        .from(catalogEndpoints)
        .where(due)
        .orderBy(asc(catalogEndpoints.nextProbeAt))
        .limit(Math.max(limit * SELECTION_WINDOW_MULTIPLIER, SELECTION_WINDOW_MINIMUM));
      const rows = await db.select({
        agentKey: catalogEndpoints.representativeAgentKey,
        endpointKey: catalogEndpoints.endpointKey,
        protocol: catalogEndpoints.validationProtocol,
        endpoint: catalogEndpoints.endpoint,
        priority: catalogAgentEndpoints.priority,
        consecutiveFailures: catalogEndpoints.consecutiveFailures,
        nextProbeAt: catalogEndpoints.nextProbeAt,
      }).from(catalogEndpoints).innerJoin(catalogAgentEndpoints, and(
        eq(catalogAgentEndpoints.agentKey, catalogEndpoints.representativeAgentKey),
        eq(catalogAgentEndpoints.endpointKey, catalogEndpoints.endpointKey),
        eq(catalogAgentEndpoints.declarationState, "current"),
      )).where(and(
        inArray(catalogEndpoints.endpointKey, window),
        or(isNull(catalogEndpoints.leaseOwner), lte(catalogEndpoints.leaseExpiresAt, nowMs)),
      )).orderBy(
        asc(catalogEndpoints.nextProbeAt),
        asc(sql<number>`CASE ${catalogEndpoints.validationProtocol}
          WHEN 'erc8183_http' THEN 0
          WHEN 'mcp' THEN 1
          WHEN 'a2a' THEN 2
          ELSE 3
        END`),
        desc(catalogAgentEndpoints.priority),
        asc(catalogEndpoints.lastProbedAt),
        asc(catalogEndpoints.endpointKey),
      ).limit(limit);
      const claimed: CatalogProbeTarget[] = [];
      for (const row of rows) {
        const leaseOwner = crypto.randomUUID();
        const leaseStarted = performance.now();
        const lease = await db.update(catalogEndpoints).set({
          leaseOwner,
          leaseExpiresAt: nowMs + LEASE_MS,
        }).where(and(
          eq(catalogEndpoints.endpointKey, row.endpointKey),
          or(isNull(catalogEndpoints.leaseOwner), lte(catalogEndpoints.leaseExpiresAt, nowMs)),
        )).returning({ endpointKey: catalogEndpoints.endpointKey });
        if (lease.length === 0) continue;
        claimed.push({
          ...row,
          agentKey: row.agentKey!,
          protocol: row.protocol as CatalogProbeTarget["protocol"],
          endpoint: row.endpoint!,
          leaseOwner,
          queueDelayMs: Math.max(0, nowMs - (row.nextProbeAt ?? nowMs)),
          leaseWaitMs: Math.max(0, Math.round(performance.now() - leaseStarted)),
        });
      }
      return claimed;
    },

    async commit(target: CatalogProbeTarget, observation: CatalogProbeObservation): Promise<void> {
      await db.batch(catalogProbeCommitStatements(db, target, observation, "worker_probe", policy));
    },
  };
}
