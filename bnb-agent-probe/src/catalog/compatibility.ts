import { sql } from "drizzle-orm";
import { catalogSellerCapabilities } from "../db/schema";
import type { createDatabase } from "../db/orm";

export const COMPATIBILITY_TTL_MS = 24 * 60 * 60 * 1000;

/** A discovery result proves current requirements, never a buyer quote. */
export async function recordCompatibility(db: ReturnType<typeof createDatabase>, target: {
  agentKey: string; endpointKey: string; transport: string;
}, nowMs: number, result: { schemaHash: string } | { errorCode: string }): Promise<void> {
  const compatible = "schemaHash" in result;
  const fields = {
    compatibilityState: compatible ? "compatible" : /PARAMETERS|SCHEMA|REQUIRED_SKILLS|TOOL_REQUIRED|UNSUPPORTED/.test(result.errorCode) ? "unsupported" : "unavailable",
    schemaHash: compatible ? result.schemaHash : null,
    compatibilityCheckedAt: nowMs,
    compatibilityExpiresAt: compatible ? nowMs + COMPATIBILITY_TTL_MS : null,
    compatibilityErrorCode: compatible ? null : result.errorCode,
    updatedAt: nowMs,
  };
  await db.insert(catalogSellerCapabilities).values({ ...target, state: "discovered", createdAt: nowMs, ...fields })
    .onConflictDoUpdate({ target: [catalogSellerCapabilities.agentKey, catalogSellerCapabilities.endpointKey], set: {
      ...fields,
      // Discovery must not erase still-current signed-quote evidence. It also
      // must never rehabilitate a failed or administratively suspended seller.
      ...(compatible ? { state: sql`CASE WHEN ${catalogSellerCapabilities.state} = 'stale'
        AND ${catalogSellerCapabilities.capabilityExpiresAt} > ${nowMs}
        AND ${catalogSellerCapabilities.lastSuccessAt} IS NOT NULL
        AND ${catalogSellerCapabilities.consecutiveFailures} = 0
        AND ${catalogSellerCapabilities.lastErrorCode} IS NULL
        THEN 'ready' ELSE ${catalogSellerCapabilities.state} END` } : {}),
    } });
}
