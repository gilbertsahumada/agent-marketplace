import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import type { D1DatabaseLike } from "./client";
import { schema } from "./schema";

/**
 * Runtime Drizzle boundary. Schema-derived row types make schema drift fail at
 * compile time. The scheduler lease and binding-level budget wrapper remain
 * raw because their exact atomic SQL and D1 meta accounting are deliberate.
 */
export type Database = DrizzleD1Database<typeof schema>;

export type ProbeTargetRow = typeof schema.probeTargets.$inferSelect;
export type ProbeObservationRow = typeof schema.probeObservations.$inferSelect;
export type FunnelSnapshotRow = typeof schema.funnelSnapshots.$inferSelect;
export type HireEventRow = typeof schema.hireEvents.$inferSelect;
export type RuntimeStateRow = typeof schema.runtimeState.$inferSelect;

export function createDatabase(d1: D1DatabaseLike): Database {
  return drizzle(d1 as Parameters<typeof drizzle>[0], { schema });
}
