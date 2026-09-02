CREATE INDEX IF NOT EXISTS idx_catalog_agent_endpoints_current_agent
  ON catalog_agent_endpoints (agentKey, endpointKey)
  WHERE declarationState = 'current';

CREATE INDEX IF NOT EXISTS idx_catalog_agent_endpoints_current_endpoint
  ON catalog_agent_endpoints (endpointKey, agentKey)
  WHERE declarationState = 'current';

CREATE INDEX IF NOT EXISTS idx_catalog_endpoints_operational_protocol
  ON catalog_endpoints (validationProtocol, endpointKey)
  WHERE role = 'operational' AND eligibility = 'eligible';

CREATE INDEX IF NOT EXISTS idx_catalog_observations_platform_latest
  ON catalog_observations (agentKey, endpointKey, observedAt DESC, id DESC)
  WHERE verificationLevel = 'platform_observed'
    AND source IN ('worker_probe', 'buyer_refresh', 'migration')
    AND validationKind IN ('reachability', 'protocol');

CREATE INDEX IF NOT EXISTS idx_catalog_observations_quote_latest
  ON catalog_observations (agentKey, endpointKey, observedAt DESC, id DESC)
  WHERE validationKind = 'quote' AND verificationLevel = 'cryptographic';

CREATE INDEX IF NOT EXISTS idx_catalog_agent_admission_state
  ON catalog_agent_admission (state, agentKey, endpointKey);

PRAGMA optimize;
