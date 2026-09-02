UPDATE catalog_agent_admission AS admission
SET commerceTransport = (
      SELECT e.validationProtocol
      FROM catalog_agent_endpoints AS ae
      INNER JOIN catalog_endpoints AS e ON e.endpointKey = ae.endpointKey
      WHERE ae.agentKey = admission.agentKey
        AND ae.declarationState = 'current'
        AND e.role = 'operational'
        AND e.eligibility = 'eligible'
        AND e.validationProtocol IN ('erc8183_http', 'a2a')
      ORDER BY
        CASE e.validationProtocol WHEN 'erc8183_http' THEN 0 ELSE 1 END,
        ae.priority DESC,
        ae.endpointKey
      LIMIT 1
    ),
    endpointKey = (
      SELECT ae.endpointKey
      FROM catalog_agent_endpoints AS ae
      INNER JOIN catalog_endpoints AS e ON e.endpointKey = ae.endpointKey
      WHERE ae.agentKey = admission.agentKey
        AND ae.declarationState = 'current'
        AND e.role = 'operational'
        AND e.eligibility = 'eligible'
        AND e.validationProtocol IN ('erc8183_http', 'a2a')
      ORDER BY
        CASE e.validationProtocol WHEN 'erc8183_http' THEN 0 ELSE 1 END,
        ae.priority DESC,
        ae.endpointKey
      LIMIT 1
    ),
    provider = NULL,
    validatedAt = NULL,
    configurationVersion = 'migration-0019',
    reasonCode = 'QUOTE_VERIFICATION_REQUIRED'
WHERE admission.state = 'candidate'
  AND admission.endpointKey IS NULL
  AND EXISTS (
    SELECT 1
    FROM catalog_agents AS agent
    INNER JOIN catalog_agent_endpoints AS ae ON ae.agentKey = agent.agentKey
    INNER JOIN catalog_endpoints AS e ON e.endpointKey = ae.endpointKey
    WHERE agent.agentKey = admission.agentKey
      AND agent.marketplaceConfigured = 1
      AND agent.indexState = 'current'
      AND ae.declarationState = 'current'
      AND e.role = 'operational'
      AND e.eligibility = 'eligible'
      AND e.validationProtocol IN ('erc8183_http', 'a2a')
  );
