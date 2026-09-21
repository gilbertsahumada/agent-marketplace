import { effectiveCapabilityStateSql } from "./effective-capability";
import { catalogSellerCapabilities } from "../db/schema";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import { sql } from "drizzle-orm";

export const CAPABILITY_STATS_KEY = "catalog_capability_stats_v1";
export const CAPABILITY_STATS_LEASE_KEY = "catalog_capability_stats_refresh_v1";
export const CAPABILITY_STATS_INTERVAL_MS = 15 * 60_000;
type Compatibility = { state: string; endpoints: number; agents: number; lastCheckedAt: number | null };
type Snapshot = {
  schemaVersion: 2; updatedAt: number;
  pending: number; ready: number; stale: number; failed: number;
  lastQuoteAttemptAt: number | null; lastProcessedAt: number | null; nextProbeAt: number | null;
  compatibility: Compatibility[];
};

const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const timestamp = (value: unknown): value is number | null => value === null || nonnegative(value);

/** Parse only public aggregate fields; malformed or future snapshots are unknown. */
export function readCapabilityStats(row: { textValue: string | null } | undefined, nowMs: number): Snapshot | null {
  try {
    const value = JSON.parse(row?.textValue ?? "null");
    if (!value || value.schemaVersion !== 2 || !nonnegative(value.updatedAt) || value.updatedAt > nowMs
      || ![value.pending, value.ready, value.stale, value.failed].every(nonnegative)
      || ![value.lastQuoteAttemptAt, value.lastProcessedAt, value.nextProbeAt].every(timestamp)
      || !Array.isArray(value.compatibility) || value.compatibility.length > 32) return null;
    const compatibility: Compatibility[] = [];
    for (const entry of value.compatibility) {
      if (!entry || typeof entry.state !== "string" || !/^[a-z_]{1,32}$/.test(entry.state)
        || !nonnegative(entry.endpoints) || !nonnegative(entry.agents) || !timestamp(entry.lastCheckedAt)) return null;
      compatibility.push({ state: entry.state, endpoints: entry.endpoints, agents: entry.agents, lastCheckedAt: entry.lastCheckedAt });
    }
    return { schemaVersion: 2, updatedAt: value.updatedAt, pending: value.pending, ready: value.ready,
      stale: value.stale, failed: value.failed, lastQuoteAttemptAt: value.lastQuoteAttemptAt,
      lastProcessedAt: value.lastProcessedAt, nextProbeAt: value.nextProbeAt, compatibility };
  } catch { return null; }
}

/** Called by background work only. One atomic gate bounds scans, including failed attempts. */
export async function refreshCapabilityStats(db: D1DatabaseLike, nowMs: number): Promise<boolean> {
  const orm = createDatabase(db);
  const token = crypto.randomUUID();
  const claimed = await orm.all<{ key: string }>(sql`INSERT INTO runtime_state(key,textValue,integerValue,updatedAt)
    VALUES(${CAPABILITY_STATS_LEASE_KEY},${token},${nowMs + CAPABILITY_STATS_INTERVAL_MS},${nowMs}) ON CONFLICT(key) DO UPDATE SET textValue=excluded.textValue,
      integerValue=excluded.integerValue,updatedAt=excluded.updatedAt
    WHERE runtime_state.integerValue <= ${nowMs} RETURNING key`);
  if (claimed.length === 0) return false;
  // Sum state counts and reduce time extrema across compatibility groups.
  // Count distinct agents inside each group, not across state subgroups: one
  // agent may expose several endpoints with different scheduling states.
  const effectiveState = effectiveCapabilityStateSql(catalogSellerCapabilities, nowMs);
  const groups = await orm.all<Compatibility & {
    pending: number; ready: number; stale: number; failed: number;
    lastAttemptAt: number | null; nextProbeAt: number | null;
  }>(sql`SELECT compatibilityState AS state, COUNT(*) AS endpoints,
    COUNT(DISTINCT agentKey) AS agents, MAX(compatibilityCheckedAt) AS lastCheckedAt,
    COUNT(CASE WHEN ${effectiveState} IN ('discovered','stale','failed') THEN 1 END) AS pending,
    COUNT(CASE WHEN ${effectiveState}='ready' THEN 1 END) AS ready,
    COUNT(CASE WHEN ${effectiveState}='stale' THEN 1 END) AS stale,
    COUNT(CASE WHEN ${effectiveState}='failed' THEN 1 END) AS failed,
    MAX(lastAttemptAt) AS lastAttemptAt,
    MIN(CASE WHEN ${effectiveState} IN ('discovered','stale','failed') THEN nextProbeAt END) AS nextProbeAt
    FROM catalog_seller_capabilities GROUP BY compatibilityState`);
  const count = (field: 'pending' | 'ready' | 'stale' | 'failed') => groups.reduce((sum, row) => sum + row[field], 0);
  const timestamps = groups.flatMap(row => row.lastAttemptAt === null ? [] : [row.lastAttemptAt]);
  const deadlines = groups.flatMap(row => row.nextProbeAt === null ? [] : [row.nextProbeAt]);
  const lastAttemptAt = timestamps.length ? Math.max(...timestamps) : null;
  const states = groups.map(({ state, endpoints, agents, lastCheckedAt }) => ({ state, endpoints, agents, lastCheckedAt }));
  const snapshot: Snapshot = { schemaVersion: 2, updatedAt: nowMs,
    pending: count("pending"),
    ready: count("ready"), stale: count("stale"), failed: count("failed"),
    lastQuoteAttemptAt: lastAttemptAt,
    lastProcessedAt: states.reduce((max, entry) => Math.max(max, entry.lastCheckedAt ?? 0), lastAttemptAt ?? 0) || null,
    nextProbeAt: deadlines.length ? Math.min(...deadlines) : null, compatibility: states };
  const saved = await orm.all<{ key: string }>(sql`INSERT INTO runtime_state(key,textValue,integerValue,updatedAt)
    SELECT ${CAPABILITY_STATS_KEY},${JSON.stringify(snapshot)},NULL,${nowMs}
    WHERE EXISTS (SELECT 1 FROM runtime_state WHERE key=${CAPABILITY_STATS_LEASE_KEY} AND textValue=${token})
    ON CONFLICT(key) DO UPDATE SET textValue=excluded.textValue,updatedAt=excluded.updatedAt
    RETURNING key`);
  return saved.length > 0;
}
