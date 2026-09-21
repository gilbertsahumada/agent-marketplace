import { sql, type SQLWrapper } from 'drizzle-orm';

interface CapabilityClock {
  state: string;
  capabilityExpiresAt?: number | null;
  compatibilityState?: string;
  compatibilityExpiresAt?: number | null;
  lastSuccessAt?: number | null;
  consecutiveFailures?: number;
  lastErrorCode?: string | null;
}

/** Time changes the projection, never the persisted evidence or retry schedule. */
export function effectiveCapability<T extends CapabilityClock>(row: T, now: number): T {
  if (row.state === 'ready') {
    if (row.capabilityExpiresAt == null) return { ...row, state: 'discovered' };
    if (row.capabilityExpiresAt <= now) return { ...row, state: 'stale' };
  }
  if (row.state === 'stale' && row.compatibilityState === 'compatible'
    && row.capabilityExpiresAt != null && row.capabilityExpiresAt > now
    && row.compatibilityExpiresAt != null && row.compatibilityExpiresAt > now
    && row.lastSuccessAt != null && row.consecutiveFailures === 0 && row.lastErrorCode === null) {
    return { ...row, state: 'ready' };
  }
  return row;
}

type Columns = { [K in keyof Required<CapabilityClock>]: SQLWrapper };
/** Predicate form avoids hiding the ready branch behind a CASE in filters. */
export function effectiveCapabilityReadySql(c: Columns, now: number) {
  return sql`((${c.state}='ready' AND ${c.capabilityExpiresAt}>${now}) OR
    (${c.state}='stale' AND ${c.compatibilityState}='compatible'
      AND ${c.capabilityExpiresAt}>${now} AND ${c.compatibilityExpiresAt}>${now}
      AND ${c.lastSuccessAt} IS NOT NULL AND ${c.consecutiveFailures}=0 AND ${c.lastErrorCode} IS NULL))`;
}
/** Same decision table as effectiveCapability; columns can belong to a SQL alias. */
export function effectiveCapabilityStateSql(c: Columns, now: number) {
  return sql`CASE
    WHEN ${c.state}='ready' AND ${c.capabilityExpiresAt} IS NULL THEN 'discovered'
    WHEN ${c.state}='ready' AND ${c.capabilityExpiresAt}<=${now} THEN 'stale'
    WHEN ${c.state}='stale' AND ${c.compatibilityState}='compatible'
      AND ${c.capabilityExpiresAt}>${now} AND ${c.compatibilityExpiresAt}>${now}
      AND ${c.lastSuccessAt} IS NOT NULL AND ${c.consecutiveFailures}=0 AND ${c.lastErrorCode} IS NULL THEN 'ready'
    ELSE ${c.state} END`;
}
