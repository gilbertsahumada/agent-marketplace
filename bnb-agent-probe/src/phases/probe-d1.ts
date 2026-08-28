import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import { probeObservations, probeTargets, runtimeState } from "../db/schema";
import type {
  ProbeObservation,
  ProbePhaseDependencies,
  ProbeTarget,
} from "./probe";

export class ProbeQueryBudgetExceededError extends Error {
  constructor(readonly remaining: number, readonly required: number) {
    super(`PROBE requires ${required} D1 queries but only ${remaining} remain`);
    this.name = "ProbeQueryBudgetExceededError";
  }
}

const TARGET_REFRESH_INTERVAL_MS = 60 * 60_000;

export function createD1ProbePersistence(
  d1: D1DatabaseLike,
  input: {
    readonly queryBudget: { readonly remaining: number; readonly used?: number };
    readonly nowMs: number;
    readonly completedQueueScheduledTime?: number;
  },
): Pick<ProbePhaseDependencies, "selectTarget" | "commit"> {
  const db = createDatabase(d1);
  return {
    selectTarget: async ({ agentAllowlist, endpointAllowlist, limit }) => {
      if (limit !== 1 || agentAllowlist.length === 0 || endpointAllowlist.length === 0) return null;
      const latestProbe = sql<number | null>`(
        SELECT MAX(observed.probedAt)
        FROM probe_observations AS observed
        WHERE observed.chainId = ${probeTargets.chainId}
          AND observed.agentId = ${probeTargets.agentId}
          AND observed.transport = ${probeTargets.transport}
          AND observed.endpoint = ${probeTargets.endpoint}
      )`;
      const rows = await db.select({
        agentId: probeTargets.agentId,
        chainId: probeTargets.chainId,
        transport: probeTargets.transport,
        endpoint: probeTargets.endpoint,
        categoriesJson: probeTargets.categoriesJson,
        currentMetadataUpdatedAt: probeTargets.currentMetadataUpdatedAt,
        lastSeenAt: probeTargets.lastSeenAt,
        priority: probeTargets.priority,
      }).from(probeTargets).where(and(
        eq(probeTargets.chainId, 56),
        eq(probeTargets.declarationState, "current"),
        inArray(probeTargets.agentId, [...agentAllowlist]),
        inArray(probeTargets.endpoint, [...endpointAllowlist]),
      )).orderBy(desc(probeTargets.priority), latestProbe).limit(1);
      const row = rows[0];
      if (!row) return null;
      if (row.chainId !== 56 || (row.transport !== "a2a" && row.transport !== "erc8183_http")) {
        throw new Error("Invalid PROBE target row");
      }
      return row as ProbeTarget;
    },
    commit: async (commit) => {
      const statements: unknown[] = [];
      if (commit.target && commit.reconciliation) {
        const state = commit.reconciliation.status;
        const currentMetadataUpdatedAt = state === "current"
          ? commit.reconciliation.metadataUpdatedAt
          : commit.target.currentMetadataUpdatedAt;
        const ageSinceSeen = commit.target.lastSeenAt === undefined
          ? TARGET_REFRESH_INTERVAL_MS
          : input.nowMs - commit.target.lastSeenAt;
        const unchangedInsideRefreshWindow = state === "current"
          && currentMetadataUpdatedAt === commit.target.currentMetadataUpdatedAt
          && (commit.nextPriority === null || commit.nextPriority === commit.target.priority)
          && ageSinceSeen >= 0
          && ageSinceSeen < TARGET_REFRESH_INTERVAL_MS;
        if (!unchangedInsideRefreshWindow) {
          statements.push(db.update(probeTargets).set({
            declarationState: state,
            currentMetadataUpdatedAt,
            lastMetadataCheckedAt: input.nowMs,
            ...(state === "current" ? { lastSeenAt: input.nowMs } : {}),
            ...(state !== "current"
              || currentMetadataUpdatedAt !== commit.target.currentMetadataUpdatedAt
              ? { lastChangedAt: input.nowMs }
              : {}),
            ...(commit.nextPriority === null ? {} : { priority: commit.nextPriority }),
          }).where(targetPredicate(commit.target)));
        }
      }
      if (commit.target && commit.observation) {
        statements.push(db.insert(probeObservations).values(observationRow(
          commit.target,
          commit.observation,
          input.nowMs,
        )));
      }
      const completionCount = input.completedQueueScheduledTime === undefined ? 0 : 1;
      const required = statements.length + 2 + completionCount;
      if (required > input.queryBudget.remaining) {
        throw new ProbeQueryBudgetExceededError(input.queryBudget.remaining, required);
      }
      const summary = JSON.stringify({
        ...commit.summary,
        d1Queries: (input.queryBudget.used ?? 0) + required + 2,
      });
      statements.push(runtimeUpsert(db, "last_probe_summary", summary, null, input.nowMs));
      statements.push(runtimeUpsert(db, "next_scheduler_phase", "header", null, input.nowMs));
      if (input.completedQueueScheduledTime !== undefined) {
        statements.push(runtimeUpsert(
          db,
          "last_queue_scheduled_time",
          null,
          input.completedQueueScheduledTime,
          input.nowMs,
        ));
      }
      await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    },
  };
}

function targetPredicate(target: ProbeTarget) {
  return and(
    eq(probeTargets.chainId, target.chainId),
    eq(probeTargets.agentId, target.agentId),
    eq(probeTargets.transport, target.transport),
    eq(probeTargets.endpoint, target.endpoint),
  );
}

function runtimeUpsert(
  db: ReturnType<typeof createDatabase>,
  key: string,
  textValue: string | null,
  integerValue: number | null,
  updatedAt: number,
) {
  return db.insert(runtimeState).values({ key, textValue, integerValue, updatedAt })
    .onConflictDoUpdate({
      target: runtimeState.key,
      set: { textValue, integerValue, updatedAt },
    });
}

function observationRow(target: ProbeTarget, observation: ProbeObservation, probedAt: number) {
  return {
    agentId: target.agentId,
    chainId: target.chainId,
    transport: target.transport,
    endpoint: target.endpoint,
    probedAt,
    probeCategory: observation.probeCategory,
    outcome: observation.outcome,
    observedMetadataUpdatedAt: observation.observedMetadataUpdatedAt,
    observedWallet: observation.observedWallet ?? null,
    observedWalletSource: observation.observedWalletSource ?? null,
    observedBlockNumber: observation.observedBlockNumber ?? null,
    onchainObservedAt: observation.onchainObservedAt ?? null,
    commerce: observation.commerce ?? null,
    router: observation.router ?? null,
    policy: observation.policy ?? null,
    priceRaw: observation.priceRaw ?? null,
    currency: observation.currency ?? null,
    decimals: observation.decimals ?? null,
    signatureMethod: observation.signatureMethod ?? null,
    signer: observation.signer ?? null,
    requestHash: observation.requestHash ?? null,
    negotiationHash: observation.negotiationHash ?? null,
    quoteNegotiatedAt: observation.quoteNegotiatedAt ?? null,
    quoteExpiresAt: observation.quoteExpiresAt ?? null,
    httpStatus: null,
    errorCode: observation.errorCode,
    durationMs: observation.durationMs,
  };
}
