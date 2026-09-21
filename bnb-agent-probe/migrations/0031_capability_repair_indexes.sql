-- Apply before deploying the repair queries. Existing indexes are preserved.
CREATE INDEX idx_catalog_capabilities_ready_expiry
ON catalog_seller_capabilities(capabilityExpiresAt, agentKey, endpointKey)
WHERE state='ready';

CREATE INDEX idx_catalog_capabilities_restorable
ON catalog_seller_capabilities(MIN(capabilityExpiresAt, compatibilityExpiresAt), agentKey, endpointKey)
WHERE state='stale' AND compatibilityState='compatible'
AND lastSuccessAt IS NOT NULL AND consecutiveFailures=0 AND lastErrorCode IS NULL;
