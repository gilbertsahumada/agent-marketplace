import { and, asc, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import { catalogAgentEndpoints, catalogEndpoints, catalogObservations } from "../db/schema";
import type {
  CatalogProbeObservation,
  CatalogProbeTarget,
} from "./catalog-probe";

const MINUTE = 60_000;
const SUCCESS_TTL_BY_PROTOCOL = {
  a2a: 12 * 60 * MINUTE,
  mcp: 24 * 60 * MINUTE,
  web: 24 * 60 * MINUTE,
  erc8183_http: 6 * 60 * MINUTE,
} as const;
const FAILURE_BACKOFF = [60 * MINUTE, 6 * 60 * MINUTE, 24 * 60 * MINUTE, 7 * 24 * 60 * MINUTE] as const;

function nextProbeAt(target: CatalogProbeTarget, observation: CatalogProbeObservation): number {
  if (observation.outcome === "protocol_valid") {
    return observation.observedAt + (target.priority >= 100
      ? 15 * MINUTE
      : SUCCESS_TTL_BY_PROTOCOL[target.protocol]);
  }
  const failureIndex = Math.min(target.consecutiveFailures, FAILURE_BACKOFF.length - 1);
  return observation.observedAt + FAILURE_BACKOFF[failureIndex]!;
}

export function createD1CatalogProbePersistence(dbBinding: D1DatabaseLike) {
  const db = createDatabase(dbBinding);
  return {
    async selectTargets({ limit, nowMs }: { limit: number; nowMs: number }): Promise<CatalogProbeTarget[]> {
      const rows = await db.select({
        agentKey: catalogEndpoints.representativeAgentKey,
        endpointKey: catalogEndpoints.endpointKey,
        protocol: catalogEndpoints.protocol,
        endpoint: catalogEndpoints.endpoint,
        priority: catalogAgentEndpoints.priority,
        consecutiveFailures: catalogEndpoints.consecutiveFailures,
      }).from(catalogEndpoints).innerJoin(catalogAgentEndpoints, and(
        eq(catalogAgentEndpoints.agentKey, catalogEndpoints.representativeAgentKey),
        eq(catalogAgentEndpoints.endpointKey, catalogEndpoints.endpointKey),
        eq(catalogAgentEndpoints.declarationState, "current"),
      )).where(and(
        eq(catalogEndpoints.safety, "safe"),
        isNotNull(catalogEndpoints.representativeAgentKey),
        isNotNull(catalogEndpoints.endpoint),
        lte(catalogEndpoints.nextProbeAt, nowMs),
      )).orderBy(
        asc(catalogEndpoints.nextProbeAt),
        asc(sql<number>`CASE ${catalogEndpoints.protocol}
          WHEN 'erc8183_http' THEN 0
          WHEN 'mcp' THEN 1
          WHEN 'a2a' THEN 2
          ELSE 3
        END`),
        desc(catalogAgentEndpoints.priority),
        asc(catalogEndpoints.lastProbedAt),
        asc(catalogEndpoints.endpointKey),
      ).limit(limit);
      return rows.map((row) => ({
        ...row,
        agentKey: row.agentKey!,
        protocol: row.protocol as CatalogProbeTarget["protocol"],
        endpoint: row.endpoint!,
      }));
    },

    async commit(target: CatalogProbeTarget, observation: CatalogProbeObservation): Promise<void> {
      const succeeded = observation.outcome === "protocol_valid";
      await db.batch([
        db.insert(catalogObservations).values({
          agentKey: target.agentKey,
          endpointKey: target.endpointKey,
          protocol: target.protocol,
          source: "worker_probe",
          outcome: observation.outcome,
          observedAt: observation.observedAt,
          expiresAt: observation.expiresAt,
          httpStatus: observation.httpStatus,
          errorCode: observation.errorCode,
          durationMs: observation.durationMs,
          detailsJson: JSON.stringify({
            capabilityCount: observation.capabilityCount,
            method: observation.method,
          }),
        }),
        db.update(catalogEndpoints).set({
          lastProbedAt: observation.observedAt,
          nextProbeAt: nextProbeAt(target, observation),
          consecutiveFailures: succeeded ? 0 : target.consecutiveFailures + 1,
        }).where(eq(catalogEndpoints.endpointKey, target.endpointKey)),
      ]);
    },
  };
}
