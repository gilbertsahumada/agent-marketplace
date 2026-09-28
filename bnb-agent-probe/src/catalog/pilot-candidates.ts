/** Operator-only bounded sample, not a cron or an exhaustive eligibility scan.
 * LEFT JOIN retains missing declarations; keyed indexes bound every lookup.
 * Return the unfiltered page: the caller must retain unselected candidates and
 * advance from its last key, not from the last eligible result. */
export const PILOT_CANDIDATE_PAGE_SIZE=250;
export const pilotCandidatePageSql=`WITH page AS MATERIALIZED (
 SELECT agentKey,endpointKey,state,compatibilityState,compatibilityCheckedAt,nextProbeAt
 FROM catalog_seller_capabilities INDEXED BY sqlite_autoindex_catalog_seller_capabilities_1
 WHERE (agentKey,endpointKey)>(?,?) AND agentKey>='eip155:56:' AND agentKey<'eip155:57:'
 ORDER BY agentKey,endpointKey LIMIT 250
)
SELECT c.*,COALESCE(e.originKey,e.endpointKey) originKey,
 (a.chainId=56 AND a.indexState='current' AND ae.declarationState='current'
 AND e.role='operational' AND e.eligibility='eligible' AND e.safety='safe' AND e.endpoint IS NOT NULL
 AND e.validationProtocol IN ('a2a','mcp','erc8183_http') AND c.state<>'suspended') eligible
FROM page c
LEFT JOIN catalog_agents a INDEXED BY sqlite_autoindex_catalog_agents_1 ON a.agentKey=c.agentKey
LEFT JOIN catalog_agent_endpoints ae INDEXED BY sqlite_autoindex_catalog_agent_endpoints_1 ON ae.agentKey=c.agentKey AND ae.endpointKey=c.endpointKey
LEFT JOIN catalog_endpoints e INDEXED BY sqlite_autoindex_catalog_endpoints_1 ON e.endpointKey=c.endpointKey
ORDER BY c.agentKey,c.endpointKey`;
