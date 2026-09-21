// REJECTED experiment. Test-only: materialization increases D1 reads.
import { effectiveCapabilityReadySql } from "../../src/catalog/effective-capability";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { createDatabase, readRuntimeState, type CatalogSellerCapabilityRow } from "../../src/db/orm";
import { CAPABILITY_STATS_KEY, CAPABILITY_STATS_INTERVAL_MS, readCapabilityStats } from "../../src/catalog/capability-stats";
import { catalogSellerCapabilities } from "../../src/db/schema";
import type { D1DatabaseLike } from "../../src/db/client";
import { revisitOldInputFailures } from "../../src/catalog/rediscover-inputs";
import type { QueueProducer } from "../../src/types";

const CLAIM_LEASE_MS = 5 * 60 * 1_000;

export const CATALOG_CAPABILITY_WORK_KIND = "catalog_capability_probe" as const;

export interface CatalogCapabilityWork {
  readonly schemaVersion: 2;
  readonly kind: typeof CATALOG_CAPABILITY_WORK_KIND;
  readonly agentKey: string;
  readonly endpointKey: string;
  readonly enqueuedAt: number;
}

export interface CatalogCapabilityQueueSummary {
  readonly selected?: number;
  readonly enqueued: number;
  readonly skipped: number;
  readonly pending: number | null;
  readonly ready: number | null;
  readonly stale: number | null;
  readonly failed: number | null;
  readonly statsStatus: "fresh" | "stale" | "missing";
  readonly statsUpdatedAt: number | null;
}



function capabilityPayload(row: Pick<CatalogSellerCapabilityRow, "agentKey" | "endpointKey">, enqueuedAt: number): CatalogCapabilityWork {
  return {
    schemaVersion: 2,
    kind: CATALOG_CAPABILITY_WORK_KIND,
    agentKey: row.agentKey,
    endpointKey: row.endpointKey,
    enqueuedAt,
  };
}

/**
 * Claim due rows before sending so overlapping ticks cannot duplicate probes.
 */
export async function enqueueDueCatalogCapabilities(
  dbBinding: D1DatabaseLike,
  queue: QueueProducer,
  input: { readonly nowMs: number; readonly limit: number; readonly chainId?: 56 | 97; readonly concurrency?: number; readonly bootstrapLimit?: number; readonly originPerMinute?: number; },
): Promise<CatalogCapabilityQueueSummary> {
  const chainId = input.chainId ?? 56;
  if (chainId !== 56 && chainId !== 97) throw new Error("CATALOG_CHAIN_UNSUPPORTED");
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("CATALOG_QUOTE_BATCH_SIZE");
  const concurrency = input.concurrency ?? input.limit;
  const bootstrapLimit = input.bootstrapLimit ?? 0;
  const originPerMinute = input.originPerMinute ?? 1;
  if (!Number.isSafeInteger(originPerMinute) || originPerMinute < 1 || originPerMinute > 4) throw new Error("CATALOG_QUOTE_ORIGIN_PER_MINUTE");
  if (!Number.isSafeInteger(bootstrapLimit) || bootstrapLimit < 0 || bootstrapLimit > 100) throw new Error("CATALOG_COMPATIBILITY_BOOTSTRAP_BATCH_SIZE");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("CATALOG_QUOTE_CONCURRENCY");
  const db = createDatabase(dbBinding);
  if (chainId === 56) await revisitOldInputFailures(db, input.nowMs, bootstrapLimit);
  const selectDue = (bootstrap: boolean | null, window: number) => {
    const index = bootstrap ? sql`idx_catalog_capabilities_pending_due` : sql`idx_catalog_capabilities_maintenance_due`;
    const cohort = bootstrap ? sql`compatibilityState='pending'` : sql`compatibilityState<>'pending'`;
    const dueRange = (nullDate: boolean) => sql`SELECT nextProbeAt,agentKey,endpointKey,updatedAt,transport,state,
      compatibilityState,capabilityExpiresAt,compatibilityExpiresAt,lastSuccessAt
      FROM catalog_seller_capabilities INDEXED BY ${index}
      WHERE state IN ('discovered','ready','stale','failed') AND ${cohort}
      AND ${nullDate ? sql`nextProbeAt IS NULL` : sql`nextProbeAt <= ${input.nowMs}`}`;
    // Disjoint date ranges avoid SQLite scanning the whole partial index for OR.
    // No limit before origin ranking: every eligible provider remains represented.
    // Testnet's small network slice is cheaper through agent-key lookups than
    // a global due-range scan. Keep its original, unconstrained access path.
    const useDueRanges = bootstrap !== null && chainId === 56;
    const source = !useDueRanges ? sql`catalog_seller_capabilities`
      : sql`/* indexed-due */ (${dueRange(true)} UNION ALL ${dueRange(false)}) /* end-indexed-due */`;
    // INDEXED BY constrains the access path, not the loop order. With partial
    // statistics SQLite can otherwise repeat the entire due range per agent.
    // Keep the range before the identity lookup; preserve the combined path.
    const lookupJoin = sql`CROSS JOIN`;
    // Keep Testnet's small identity slice first; adding effective-state
    // predicates must not let SQLite expand all endpoints before filtering chain.
    const sourceJoin = useDueRanges
      ? sql`FROM ${source} c CROSS JOIN catalog_agents a ON a.agentKey=c.agentKey AND a.indexState='current' AND a.chainId=${chainId}`
      : sql`FROM catalog_agents a CROSS JOIN catalog_seller_capabilities c ON c.agentKey=a.agentKey AND a.indexState='current' AND a.chainId=${chainId}`;
    // Keep due-range scans covering. Only a stale row with live evidence needs
    // failure details; CASE short-circuits these bounded primary-key lookups.
    const effectiveReady = effectiveCapabilityReadySql({ state: sql`c.state`, capabilityExpiresAt: sql`c.capabilityExpiresAt`, compatibilityState: sql`c.compatibilityState`, compatibilityExpiresAt: sql`c.compatibilityExpiresAt`, lastSuccessAt: sql`c.lastSuccessAt`,
      consecutiveFailures: useDueRanges ? sql`(SELECT f.consecutiveFailures FROM catalog_seller_capabilities f WHERE f.agentKey=c.agentKey AND f.endpointKey=c.endpointKey)` : sql`c.consecutiveFailures`,
      lastErrorCode: useDueRanges ? sql`(SELECT f.lastErrorCode FROM catalog_seller_capabilities f WHERE f.agentKey=c.agentKey AND f.endpointKey=c.endpointKey)` : sql`c.lastErrorCode`,
    }, input.nowMs);
    return db.all<{
    agentKey: string; endpointKey: string; originKey: string; compatibilityState: string; nextProbeAt: number | null;
  }>(sql`
    WITH eligible AS MATERIALIZED (
      SELECT c.agentKey, c.endpointKey, COALESCE(e.originKey, e.endpointKey) AS originKey,
        c.compatibilityState,
        CASE WHEN e.lastAttemptOutcome='protocol_valid' THEN 0 ELSE 1 END AS onlineRank,
        CASE WHEN c.transport='erc8183_http' THEN 0 ELSE 1 END AS transportRank,
        c.nextProbeAt, c.updatedAt
      ${sourceJoin}
      ${lookupJoin} catalog_agent_endpoints ae ON ae.agentKey=c.agentKey AND ae.endpointKey=c.endpointKey AND ae.declarationState='current'
      ${lookupJoin} catalog_endpoints e ON e.endpointKey=c.endpointKey AND e.role='operational' AND e.eligibility='eligible'
      WHERE c.state IN ('discovered','ready','stale','failed')
        AND (c.nextProbeAt IS NULL OR c.nextProbeAt <= ${input.nowMs})
        AND NOT (${effectiveReady} AND COALESCE(c.capabilityExpiresAt,0) > ${input.nowMs}
          AND c.compatibilityState='compatible' AND COALESCE(c.compatibilityExpiresAt,0) > ${input.nowMs}
          AND c.lastSuccessAt IS NOT NULL)
        AND ${bootstrap === null ? sql`1=1` : bootstrap ? sql`c.compatibilityState='pending'` : sql`c.compatibilityState<>'pending'`}
    ), origins AS MATERIALIZED (
      SELECT DISTINCT originKey FROM eligible
    ), available_origins AS MATERIALIZED (
      SELECT originKey FROM origins o
      WHERE NOT EXISTS (SELECT 1 FROM runtime_state r
        WHERE r.key='catalog_sweep_origin:' || o.originKey
          AND (r.integerValue > ${Math.floor(input.nowMs / 60_000)}
            OR (r.integerValue=${Math.floor(input.nowMs / 60_000)} AND CAST(r.textValue AS INTEGER)>=${originPerMinute})))
    ), ranked AS (
      SELECT c.*, ROW_NUMBER() OVER (
        PARTITION BY c.originKey
        ORDER BY onlineRank, transportRank, nextProbeAt, updatedAt, agentKey, endpointKey
      ) AS originRank
      FROM eligible c JOIN available_origins o ON o.originKey=c.originKey
    )
    SELECT agentKey, endpointKey, originKey, compatibilityState, nextProbeAt FROM ranked
    WHERE originRank <= ${originPerMinute}
    ORDER BY originRank, onlineRank, transportRank, nextProbeAt, updatedAt, agentKey, endpointKey
    LIMIT ${Math.min(1000, window * 10)}
  `);
  };
  // Independent candidate windows: retries on reachable hosts must not crowd
  // first-time discovery out of the bounded SQL result (or vice versa).
  const cohorts = bootstrapLimit > 0
    ? await Promise.all([selectDue(true, bootstrapLimit), selectDue(false, input.limit)])
    : [await selectDue(null, input.limit)];
  // Share an origin's slot across first-time checks and maintenance instead of
  // letting a large bootstrap backlog monopolize that host indefinitely.
  // Rotation is deterministic for the one-minute scheduler and adds no writes.
  if (bootstrapLimit > 0 && Math.floor(input.nowMs / 60_000) % 2 === 1) cohorts.reverse();
  const due = cohorts.flat();
  // A single origin can host many catalogued agents. Bound capability
  // probes per origin and cap the total number of queued probes. The
  // five-minute claim lease prevents a second tick from re-queuing the same
  // endpoint while the queue consumer is still working.
  const selected: typeof due = [];
  const origins = new Map<string, number>();
  let bootstrapSelected = 0;
  let maintenanceSelected = 0;
  for (const row of due) {
    const bootstrap = bootstrapLimit > 0 && row.compatibilityState === "pending";
    if (bootstrap ? bootstrapSelected >= bootstrapLimit : maintenanceSelected >= Math.min(input.limit, concurrency)) continue;
    const origin = row.originKey ?? row.endpointKey;
    if ((origins.get(origin) ?? 0) >= originPerMinute) continue;
    origins.set(origin, (origins.get(origin) ?? 0) + 1);
    selected.push(row);
    if (bootstrap) bootstrapSelected += 1;
    else maintenanceSelected += 1;
  }
  let enqueued = 0;
  let skipped = 0;
  for (const row of selected) {
    const claimed = await db.update(catalogSellerCapabilities).set({
      nextProbeAt: input.nowMs + CLAIM_LEASE_MS,
      updatedAt: input.nowMs,
    }).where(and(
      eq(catalogSellerCapabilities.agentKey, row.agentKey),
      eq(catalogSellerCapabilities.endpointKey, row.endpointKey),
      inArray(catalogSellerCapabilities.state, ["discovered", "ready", "stale", "failed"]),
      or(isNull(catalogSellerCapabilities.nextProbeAt), lte(catalogSellerCapabilities.nextProbeAt, input.nowMs)),
    )).returning({ agentKey: catalogSellerCapabilities.agentKey });
    if (claimed.length === 0) {
      skipped += 1;
      continue;
    }
    // A durable minute reservation coordinates separate cron invocations.
    // Failed sends consume their slot conservatively; they do not create a burst.
    const minute = Math.floor(input.nowMs / 60_000);
    const reserved = await db.all<{ integerValue: number }>(sql`
      INSERT INTO runtime_state (key,textValue,integerValue,updatedAt)
      VALUES (${`catalog_sweep_origin:${row.originKey}`}, '1', ${minute}, ${input.nowMs})
      ON CONFLICT(key) DO UPDATE SET
        textValue=CASE WHEN runtime_state.integerValue=${minute}
          THEN CAST(CAST(runtime_state.textValue AS INTEGER)+1 AS TEXT) ELSE '1' END,
        integerValue=${minute}, updatedAt=${input.nowMs}
      WHERE runtime_state.integerValue < ${minute}
        OR (runtime_state.integerValue=${minute} AND CAST(runtime_state.textValue AS INTEGER)<${originPerMinute})
      RETURNING integerValue
    `);
    if (reserved.length === 0) {
      skipped += 1;
      await db.update(catalogSellerCapabilities).set({ nextProbeAt: row.nextProbeAt, updatedAt: input.nowMs })
        .where(and(eq(catalogSellerCapabilities.agentKey, row.agentKey), eq(catalogSellerCapabilities.endpointKey, row.endpointKey)));
      continue;
    }
    try {
      await queue.send(capabilityPayload(row, input.nowMs));
      enqueued += 1;
    } catch {
      skipped += 1;
      await db.update(catalogSellerCapabilities).set({ nextProbeAt: input.nowMs, updatedAt: input.nowMs })
        .where(and(eq(catalogSellerCapabilities.agentKey, row.agentKey), eq(catalogSellerCapabilities.endpointKey, row.endpointKey)));
    }
  }
  const stats = readCapabilityStats((await readRuntimeState(db, CAPABILITY_STATS_KEY)) ?? undefined, input.nowMs);
  return {
    selected: selected.length,
    enqueued,
    skipped,
    // Legacy queue summary calls only discovered rows pending, whereas health
    // includes stale and failed rows in its pending aggregate.
    pending: stats ? stats.pending - stats.stale - stats.failed : null,
    ready: stats?.ready ?? null,
    stale: stats?.stale ?? null,
    failed: stats?.failed ?? null,
    statsStatus: !stats ? "missing" : input.nowMs - stats.updatedAt >= CAPABILITY_STATS_INTERVAL_MS ? "stale" : "fresh",
    statsUpdatedAt: stats?.updatedAt ?? null,
  };
}
