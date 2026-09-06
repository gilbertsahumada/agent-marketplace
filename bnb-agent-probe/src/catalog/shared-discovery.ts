import { sql } from "drizzle-orm";
import { createDatabase } from "../db/orm";
import type { D1DatabaseLike } from "../db/client";
import { NEGOTIATION_DETECTOR_VERSION } from "../../../src/shared/negotiation-profiles";

/** Reuse only public structural discovery failures for the exact endpoint and
 * transport. No quote/identity success, auth failure or transient error is shared.
 * Dates remain those of the source observation, not the time of projection.
 */
export async function projectSharedDiscoveryFailures(binding: D1DatabaseLike, now: number, limit: number): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100) throw new Error("CATALOG_SHARED_DISCOVERY_LIMIT");
  if (!limit) return 0;
  const rows = await createDatabase(binding).all<{ agentKey: string }>(sql`
    WITH sources AS (
      SELECT c.endpointKey,c.transport,c.compatibilityErrorCode,c.compatibilityCheckedAt,
        ROW_NUMBER() OVER (PARTITION BY c.endpointKey,c.transport ORDER BY c.compatibilityCheckedAt DESC) AS rank
      FROM catalog_seller_capabilities c
      JOIN catalog_agents a ON a.agentKey=c.agentKey AND a.chainId=56 AND a.indexState='current'
      JOIN catalog_agent_endpoints ae ON ae.agentKey=c.agentKey AND ae.endpointKey=c.endpointKey AND ae.declarationState='current'
      WHERE c.compatibilityState='unsupported'
        AND c.detectorVersion=${NEGOTIATION_DETECTOR_VERSION}
        AND c.compatibilityErrorCode IN ('A2A_REQUIRED_SKILLS','MCP_QUOTE_TOOL_REQUIRED','NEGOTIATION_PARAMETERS_UNAVAILABLE','NEGOTIATION_SCHEMA_UNSUPPORTED')
        AND c.compatibilityCheckedAt > ${now - 86400000} AND c.compatibilityCheckedAt <= ${now}
        AND c.state <> 'suspended'
    ), targets AS (
      SELECT c.agentKey,c.endpointKey,s.compatibilityErrorCode,s.compatibilityCheckedAt
      FROM catalog_seller_capabilities c
      JOIN sources s ON s.endpointKey=c.endpointKey AND s.transport=c.transport AND s.rank=1
      JOIN catalog_agents a ON a.agentKey=c.agentKey AND a.chainId=56 AND a.indexState='current'
      JOIN catalog_agent_endpoints ae ON ae.agentKey=c.agentKey AND ae.endpointKey=c.endpointKey AND ae.declarationState='current'
      JOIN catalog_endpoints e ON e.endpointKey=c.endpointKey AND e.eligibility='eligible' AND e.role='operational' AND e.safety='safe'
      WHERE c.compatibilityState='pending' AND c.state='discovered'
        AND c.lastSuccessAt IS NULL AND (c.nextProbeAt IS NULL OR c.nextProbeAt<=${now})
      ORDER BY c.createdAt,c.agentKey LIMIT ${limit}
    )
    UPDATE catalog_seller_capabilities AS c SET
      compatibilityState='unsupported',schemaHash=NULL,detectorVersion=${NEGOTIATION_DETECTOR_VERSION},negotiationProfile=NULL,schemaSource=NULL,
      compatibilityErrorCode=t.compatibilityErrorCode,
      compatibilityCheckedAt=t.compatibilityCheckedAt,compatibilityExpiresAt=NULL,
      nextProbeAt=t.compatibilityCheckedAt+86400000,updatedAt=${now}
    FROM targets t WHERE c.agentKey=t.agentKey AND c.endpointKey=t.endpointKey
      AND c.compatibilityState='pending' AND c.state='discovered'
    RETURNING agentKey
  `);
  return rows.length;
}
