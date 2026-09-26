// Internal SQL constructors. keysSql/guard are trusted SQL created by our bounded
// backfill, never request input. Keep selections identical to migration 0036.
// Pin quote aggregates to the existing agent-leading index: SQLite can otherwise
// choose the global status index for each correlated succeeded-count subquery.
const endpointPrefix = `INSERT INTO catalog_public_endpoint_evidence (agentKey,endpointScope,latestPlatformId,latestPlatformProtocol,latestPlatformOutcome,latestPlatformObservedAt,latestPlatformExpiresAt,latestPlatformSuccessId,latestPlatformSuccessAt,platformAttemptCount,browserReachabilityId,browserProtocolId,browserQuoteId,browserChainId,hasBrowserProtocolSuccessEver,latestQuoteId,latestQuoteOutcome,latestQuoteObservedAt,latestQuoteExpiresAt,latestQuoteIsBuyer,hasBuyerVerifiedQuoteEver,latestChainId,projectionVersion,lastObservationMutationId)
SELECT k.agentKey,k.endpointScope,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformId,
  (SELECT o.protocol FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformProtocol,
  (SELECT o.outcome FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformOutcome,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformObservedAt,
  (SELECT o.expiresAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformExpiresAt,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' AND o.outcome='protocol_valid' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformSuccessId,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' AND o.outcome='protocol_valid' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformSuccessAt,
  (SELECT COUNT(*) FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed') AS platformAttemptCount,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='reachability' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserReachabilityId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='protocol' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserProtocolId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='quote' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserQuoteId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='chain' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserChainId,
  EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.outcome='protocol_valid') AS hasBrowserProtocolSuccessEver,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteId,
  (SELECT o.outcome FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteOutcome,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteObservedAt,
  (SELECT o.expiresAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteExpiresAt,
  COALESCE((SELECT COALESCE(json_extract( CASE WHEN json_valid(o.detailsJson) THEN o.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe' FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1),0) AS latestQuoteIsBuyer,
  EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' AND o.outcome='quote_verified' AND COALESCE(json_extract( CASE WHEN json_valid(o.detailsJson) THEN o.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe') AS hasBuyerVerifiedQuoteEver,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='chain' AND o.verificationLevel='onchain' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestChainId,
  1 AS projectionVersion,
  `;
const endpointAfterMutation = "\nFROM (";
const endpointAfterKeys = `) k
WHERE EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope) AND `;
const endpointSuffix = `
ON CONFLICT(agentKey,endpointScope) DO UPDATE SET
  latestPlatformId=excluded.latestPlatformId,
  latestPlatformProtocol=excluded.latestPlatformProtocol,
  latestPlatformOutcome=excluded.latestPlatformOutcome,
  latestPlatformObservedAt=excluded.latestPlatformObservedAt,
  latestPlatformExpiresAt=excluded.latestPlatformExpiresAt,
  latestPlatformSuccessId=excluded.latestPlatformSuccessId,
  latestPlatformSuccessAt=excluded.latestPlatformSuccessAt,
  platformAttemptCount=excluded.platformAttemptCount,
  browserReachabilityId=excluded.browserReachabilityId,
  browserProtocolId=excluded.browserProtocolId,
  browserQuoteId=excluded.browserQuoteId,
  browserChainId=excluded.browserChainId,
  hasBrowserProtocolSuccessEver=excluded.hasBrowserProtocolSuccessEver,
  latestQuoteId=excluded.latestQuoteId,
  latestQuoteOutcome=excluded.latestQuoteOutcome,
  latestQuoteObservedAt=excluded.latestQuoteObservedAt,
  latestQuoteExpiresAt=excluded.latestQuoteExpiresAt,
  latestQuoteIsBuyer=excluded.latestQuoteIsBuyer,
  hasBuyerVerifiedQuoteEver=excluded.hasBuyerVerifiedQuoteEver,
  latestChainId=excluded.latestChainId,
  projectionVersion=excluded.projectionVersion,
  lastObservationMutationId=excluded.lastObservationMutationId`;
const metricsPrefix = `INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId=CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId=CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId=CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId=CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (`;
const metricsSuffix = `
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;`;

export function endpointProjectionUpsert(keysSql: string, guard = "1", mutationId = "NULL"): string {
  return endpointPrefix + mutationId + endpointAfterMutation + keysSql + endpointAfterKeys + guard + endpointSuffix + ";";
}
export function agentMetricsUpsert(keysSql: string, guard = "1"): string {
  return metricsPrefix + keysSql + ") k WHERE " + guard + metricsSuffix;
}

export function endpointProjectionSelect(keysSql: string): string {
  return endpointPrefix.slice(endpointPrefix.indexOf("\nSELECT") + 1) + "NULL" + endpointAfterMutation
    + keysSql + endpointAfterKeys + "1";
}

export function agentMetricsSelect(keysSql: string): string {
  return metricsPrefix.slice(metricsPrefix.indexOf("\nSELECT") + 1) + keysSql + ") k WHERE 1";
}
