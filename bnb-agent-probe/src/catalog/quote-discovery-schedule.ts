import {sql} from 'drizzle-orm';
import {catalogSellerCapabilities as capability} from '../db/schema';

/** A verified buyer quote refreshes quote evidence, not negotiation inputs.
 * Only a ready, error-free gate equal to the old quote TTL is recognizable as
 * a quote-derived refresh date. Preserve every other future gate conservatively.
 * Evaluate against the existing row inside the upsert (no read/write race).
 * The agenda still owns jitter and leases; this is only its capability gate.
 */
export function quoteDiscoverySchedule(now:number,quoteExpiresAt:number){
  return sql`CASE
    WHEN ${capability.nextProbeAt}>${now} AND (
      ${capability.state}<>'ready' OR ${capability.consecutiveFailures}>0 OR ${capability.lastErrorCode} IS NOT NULL
      OR ${capability.nextProbeAt} IS NOT ${capability.capabilityExpiresAt}
    ) THEN ${capability.nextProbeAt}
    WHEN ${capability.compatibilityState}='compatible' AND ${capability.compatibilityExpiresAt}>${now}
      THEN MIN(${quoteExpiresAt},MAX(${now},${capability.compatibilityExpiresAt}-7200000))
    ELSE ${now}
  END`;
}
