CREATE INDEX idx_catalog_agents_identity_discovery
ON catalog_agents(chainId, indexState, agentKey, agentId);

CREATE INDEX idx_catalog_capabilities_legacy_inputs
ON catalog_seller_capabilities(detectorVersion, agentKey, endpointKey, compatibilityCheckedAt)
WHERE compatibilityState = 'unsupported' AND state <> 'suspended'
AND compatibilityErrorCode IN ('NEGOTIATION_PARAMETERS_UNAVAILABLE','NEGOTIATION_SCHEMA_UNSUPPORTED');

CREATE INDEX idx_catalog_capabilities_pending_due
ON catalog_seller_capabilities(nextProbeAt, agentKey, endpointKey, updatedAt, transport, state, compatibilityState, capabilityExpiresAt, compatibilityExpiresAt, lastSuccessAt)
WHERE state IN ('discovered','ready','stale','failed') AND compatibilityState = 'pending';

CREATE INDEX idx_catalog_capabilities_maintenance_due
ON catalog_seller_capabilities(nextProbeAt, agentKey, endpointKey, updatedAt, transport, state, compatibilityState, capabilityExpiresAt, compatibilityExpiresAt, lastSuccessAt)
WHERE state IN ('discovered','ready','stale','failed') AND compatibilityState <> 'pending';
