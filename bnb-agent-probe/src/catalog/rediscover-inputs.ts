import { sql } from "drizzle-orm";
import type { createDatabase } from "../db/orm";
import { NEGOTIATION_DETECTOR_VERSION } from "../../../src/shared/negotiation-profiles";

/** Revisit only old schema failures, bounded by the existing bootstrap budget.
 * No quote state, counter or historical observation is rewritten. Once pending,
 * a row cannot be reset again by this operation, so queue leases stay intact.
 */
export async function revisitOldInputFailures(db: ReturnType<typeof createDatabase>, now: number, limit: number): Promise<void> {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100) throw new Error("DISCOVERY_REVISIT_LIMIT");
  if (!limit) return;
  await db.run(sql`UPDATE catalog_seller_capabilities SET compatibilityState='pending',nextProbeAt=${now}
    WHERE (agentKey,endpointKey) IN (
      SELECT c.agentKey,c.endpointKey FROM catalog_seller_capabilities c
      JOIN catalog_agents a ON a.agentKey=c.agentKey AND a.chainId=56 AND a.indexState='current'
      JOIN catalog_agent_endpoints ae ON ae.agentKey=c.agentKey AND ae.endpointKey=c.endpointKey AND ae.declarationState='current'
      JOIN catalog_endpoints e ON e.endpointKey=c.endpointKey AND e.safety='safe' AND e.eligibility='eligible'
      WHERE c.detectorVersion < ${NEGOTIATION_DETECTOR_VERSION} AND c.compatibilityState='unsupported'
        AND c.state <> 'suspended'
        AND c.compatibilityErrorCode IN ('NEGOTIATION_PARAMETERS_UNAVAILABLE','NEGOTIATION_SCHEMA_UNSUPPORTED')
      ORDER BY CASE WHEN e.lastAttemptOutcome='protocol_valid' THEN 0 ELSE 1 END,c.compatibilityCheckedAt,c.agentKey
      LIMIT ${limit}
    )`);
}
