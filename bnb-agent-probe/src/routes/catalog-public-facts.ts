import { sql, type SQL } from "drizzle-orm";

/** Current policy is joined at read time. Shared endpoint blocks/suspension and
 * expiration never wait for fan-out updates. Historical payloads are not scanned;
 * only the capability's last attempt/request are looked up by primary key. */
export function publicCatalogueFacts(now: number, chain: 56 | 97, enabled: boolean, search = "", hiringOnly = false, operationalOnly = false) {
  return buildPublicFacts(now,chain,enabled,search,false,hiringOnly,operationalOnly);
}

export function publicCatalogueSummary(now: number, chain: 56 | 97, enabled: boolean) {
  return buildPublicFacts(now,chain,enabled,"",true);
}

export interface PublicPolicyColumns {
  capability: (field: string) => SQL;
  evidence: (field: string) => SQL;
}
const defaultPolicyColumns: PublicPolicyColumns = {
  // Fields are fixed literals in this module, never request parameters.
  capability: field => sql.raw(`c.${field}`),
  evidence: field => sql.raw(`p.${field}`),
};
/** One policy, explicit source columns. Endpoint and last-attempt aliases stay
 * live as e/t/r in both readers; no cached availability booleans. */
export function publicCataloguePolicy(now: number, chain: 56 | 97, enabled: boolean, columns: PublicPolicyColumns = defaultPolicyColumns) {
  const operational = sql`e.role='operational' AND e.eligibility='eligible'`;
  const ready = sql`((${columns.capability("state")}='ready' AND ${columns.capability("capabilityExpiresAt")}>${now}) OR
    (${columns.capability("state")}='stale' AND ${columns.capability("compatibilityState")}='compatible' AND ${columns.capability("capabilityExpiresAt")}>${now}
      AND ${columns.capability("compatibilityExpiresAt")}>${now} AND ${columns.capability("lastSuccessAt")} IS NOT NULL
      AND ${columns.capability("consecutiveFailures")}=0 AND ${columns.capability("lastErrorCode")} IS NULL))`;
  const failure = sql`${columns.evidence("latestPlatformOutcome")} IN ('http_error','timeout','network_error','invalid_response','unsafe_url','quote_rejected','unreachable','error')`;
  const compatible = sql`${operational} AND e.validationProtocol IN ('a2a','mcp','erc8183_http')
    AND ${columns.capability("compatibilityState")}='compatible' AND ${columns.capability("schemaHash")} IS NOT NULL AND ${columns.capability("compatibilityExpiresAt")}>${now}
    AND NOT COALESCE((${failure} AND ${columns.evidence("latestPlatformObservedAt")}>${columns.capability("compatibilityCheckedAt")}),0)`;
  const requestable = chain === 56 || enabled
    ? sql`${compatible} AND ${columns.capability("state")} NOT IN ('unsupported','suspended')` : sql`0`;
  const quoteCapable = chain === 56 || enabled ? sql`${compatible} AND ${ready}` : sql`0`;
  const fresh = sql`${operational} AND ${columns.evidence("latestPlatformOutcome")}='protocol_valid' AND ${columns.evidence("latestPlatformExpiresAt")}>${now}`;
  const flags = {
    hasOperational: operational,
    requestable,
    quoteCapable,
    hasMcp: sql`${operational} AND e.validationProtocol='mcp'`,
    hasSeller: sql`${operational} AND e.validationProtocol IN ('a2a','erc8183_http')`,
    erc8183: sql`${operational} AND e.validationProtocol='erc8183_http' AND e.declaredProtocol='erc8183_http'`,
    needsVerification: sql`${operational} AND (${columns.capability("agentKey")} IS NULL OR (${columns.capability("state")}<>'suspended' AND
      (${columns.capability("compatibilityState")} IN ('pending','unavailable') OR (${columns.capability("compatibilityState")}='compatible'
        AND (${columns.capability("compatibilityExpiresAt")} IS NULL OR ${columns.capability("compatibilityExpiresAt")}<=${now})))))`,
    a2a: sql`${fresh} AND ${columns.evidence("latestPlatformProtocol")}='a2a'`,
    mcp: sql`${fresh} AND ${columns.evidence("latestPlatformProtocol")}='mcp'`,
    httpFresh: sql`${fresh} AND ${columns.evidence("latestPlatformProtocol")}='erc8183_http'`,
    platformSuccess: sql`${operational} AND ${columns.evidence("latestPlatformSuccessId")} IS NOT NULL`,
    browserSuccess: sql`${operational} AND ${columns.evidence("hasBrowserProtocolSuccessEver")}=1`,
    failure: sql`${operational} AND ${failure}`,
    latestReachable: sql`${operational} AND ${columns.evidence("latestPlatformOutcome")}='protocol_valid'`,
    freshValid: sql`${operational} AND ${columns.evidence("latestPlatformOutcome")} IN ('protocol_valid','quote_verified') AND ${columns.evidence("latestPlatformExpiresAt")}>${now}`,
    freshQuote: sql`${operational} AND ${ready} AND ${columns.evidence("latestQuoteOutcome")}='quote_verified'
      AND ${columns.evidence("latestQuoteIsBuyer")}=1 AND ${columns.evidence("latestQuoteExpiresAt")}>${now}`,
    anyQuote: sql`${operational} AND ${columns.capability("agentKey")} IS NOT NULL AND ${columns.evidence("hasBuyerVerifiedQuoteEver")}=1`,
    suspended: sql`${columns.capability("state")}='suspended'`,
    quoteFailed: sql`${columns.capability("state")}='failed' AND t.status IN ('failed','rejected') AND r.agentKey=${columns.capability("agentKey")} AND r.endpointKey=${columns.capability("endpointKey")}`,
    a2aTransport: sql`e.eligibility='eligible' AND e.validationProtocol='a2a'`,
    mcpTransport: sql`e.eligibility='eligible' AND e.validationProtocol='mcp'`,
    httpTransport: sql`e.eligibility='eligible' AND e.validationProtocol='erc8183_http'`,
  };
  return { operational, requestable, flags };
}

function buildPublicFacts(now: number, chain: 56 | 97, enabled: boolean, search: string, scopeOnly: boolean, hiringOnly = false, operationalOnly = false) {
  const { operational, requestable, flags } = publicCataloguePolicy(now,chain,enabled);
  if (scopeOnly) return sql`
    WITH scope_flags AS MATERIALIZED (
      SELECT CASE WHEN ${chain === 56 || enabled ? sql`EXISTS (
        SELECT 1 FROM catalog_seller_capabilities c
        CROSS JOIN catalog_agent_endpoints d ON d.agentKey=c.agentKey AND d.endpointKey=c.endpointKey AND d.declarationState='current'
        CROSS JOIN catalog_endpoints e ON e.endpointKey=c.endpointKey
        LEFT JOIN catalog_public_endpoint_evidence p ON p.agentKey=c.agentKey AND p.endpointScope=c.endpointKey AND p.projectionVersion=1
        WHERE c.agentKey=a.agentKey AND ${requestable}
      )` : sql`0`} THEN 1 ELSE 0 END AS hiring
      FROM catalog_agents a WHERE a.chainId=${chain} AND a.indexState='current' AND EXISTS (
        SELECT 1 FROM catalog_agent_endpoints d CROSS JOIN catalog_endpoints e ON e.endpointKey=d.endpointKey
        WHERE d.agentKey=a.agentKey AND d.declarationState='current' AND ${operational}
      )
    ) SELECT COALESCE(SUM(hiring),0) AS hiring,COUNT(*)-COALESCE(SUM(hiring),0) AS evaluation FROM scope_flags`;
  const escaped = search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  return sql`
    ${hiringOnly ? sql`hiring_keys AS MATERIALIZED (
      SELECT DISTINCT c.agentKey FROM catalog_seller_capabilities c
      CROSS JOIN catalog_agent_endpoints d ON d.agentKey=c.agentKey AND d.endpointKey=c.endpointKey AND d.declarationState='current'
      CROSS JOIN catalog_endpoints e ON e.endpointKey=c.endpointKey
      LEFT JOIN catalog_public_endpoint_evidence p ON p.agentKey=c.agentKey AND p.endpointScope=c.endpointKey AND p.projectionVersion=1
      WHERE ${requestable}
    ),` : sql``}
    endpoint_flags AS (
      SELECT a.agentKey,a.agentId,a.chainId,a.categoriesJson,a.priority,a.registeredAt,
        ${sql.join(Object.entries(flags).map(([key, condition]) => sql`MAX(CASE WHEN ${condition} THEN 1 ELSE 0 END) AS ${sql.identifier(key)}`),sql`, `)},
        (SELECT COALESCE(SUM(DISTINCT CASE j.value WHEN 'rebalancing' THEN 1 WHEN 'grid_trading' THEN 2
          WHEN 'yield_optimisation' THEN 4 WHEN 'health_factor_monitoring' THEN 8 ELSE 0 END),0)
          FROM json_each(a.categoriesJson) j) AS categoryMask
      FROM catalog_agents a
      LEFT JOIN catalog_agent_endpoints d ON d.agentKey=a.agentKey AND d.declarationState='current'
      LEFT JOIN catalog_endpoints e ON e.endpointKey=d.endpointKey
      LEFT JOIN catalog_public_endpoint_evidence p ON p.agentKey=d.agentKey AND p.endpointScope=d.endpointKey AND p.projectionVersion=1 AND ${operational}
      LEFT JOIN catalog_seller_capabilities c ON c.agentKey=d.agentKey AND c.endpointKey=d.endpointKey
      LEFT JOIN catalog_quote_attempts t ON t.id=c.lastAttemptId
      LEFT JOIN catalog_quote_requests r ON r.id=t.requestId
      WHERE a.chainId=${chain} AND a.indexState='current'
        ${hiringOnly ? sql`AND a.agentKey IN (SELECT agentKey FROM hiring_keys)` : sql``}
        ${search ? sql`AND (a.agentId=${search} OR a.name LIKE ${`%${escaped}%`} ESCAPE '\\')` : sql``}
      GROUP BY a.agentKey
      ${operationalOnly ? sql`HAVING MAX(CASE WHEN ${operational} THEN 1 ELSE 0 END)=1` : sql``}
    ), public_flags AS (
      SELECT f.*,m.agentKey IS NOT NULL AS completedJobs,
        (f.categoryMask & 1)<>0 AS rebalancing,(f.categoryMask & 2)<>0 AS gridTrading,
        (f.categoryMask & 4)<>0 AS yieldOptimisation,(f.categoryMask & 8)<>0 AS healthFactorMonitoring,
        f.hasMcp AND NOT f.hasSeller AND NOT f.quoteCapable AS mcpOnly,
        NOT f.requestable AND f.needsVerification AS pending,
        f.failure AND NOT f.latestReachable AND NOT f.freshValid AS failed,
        f.a2a OR f.mcp OR f.httpFresh AS live,
        f.platformSuccess AND NOT (f.a2a OR f.mcp OR f.httpFresh) AS historical,
        NOT f.platformSuccess AS never,
        f.browserSuccess AND NOT f.platformSuccess AS browserObserved,1 AS declared
      FROM endpoint_flags f LEFT JOIN catalog_public_agent_metrics m ON m.agentKey=f.agentKey AND m.projectionVersion=1 AND m.jobCompleted>0
    )`;
}
