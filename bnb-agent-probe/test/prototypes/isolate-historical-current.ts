import type { D1Database } from '../../src/types';

/** Historical prototype benchmarks predate migration 0037. Their alternative
 * maintenance must not run alongside the new production implementation. This
 * helper is test-only and never used by production suites or application code.
 * Preserve 0036 sparse evidence triggers: they are part of the frozen fixture. */
export async function disableProductionCurrentMaintenance(db: D1Database): Promise<void> {
  const sources=['catalog_agents','catalog_agent_endpoints','catalog_seller_capabilities','catalog_public_endpoint_evidence'];
  const events=['insert','update','delete'];
  if(!db.batch) throw new Error('HISTORICAL_PROTOTYPE_REQUIRES_BATCH');
  await db.batch(sources.flatMap(source=>events.map(event=>db.prepare(`DROP TRIGGER IF EXISTS public_current_${source}_${event}`))));
  // The unused newer table also changes sqlite_schema reads in historical DDL
  // receipts. Remove it only during this explicit, unmeasured fixture setup.
  await db.prepare('DROP TABLE IF EXISTS catalog_public_current_endpoints').run();
}
