INSERT INTO catalog_observations (
  agentKey,
  endpointKey,
  protocol,
  source,
  outcome,
  observedAt,
  expiresAt,
  httpStatus,
  errorCode,
  durationMs,
  detailsJson
)
SELECT
  'eip155:56:' || agentId,
  NULL,
  transport,
  'marketplace_probe',
  CASE outcome
    WHEN 'quote_invalid' THEN 'invalid_response'
    WHEN 'reachable' THEN 'invalid_response'
    ELSE outcome
  END,
  probedAt,
  CASE outcome
    WHEN 'quote_verified' THEN quoteExpiresAt
    WHEN 'protocol_valid' THEN probedAt + 900000
    ELSE NULL
  END,
  httpStatus,
  errorCode,
  durationMs,
  json_object(
    'legacyObservationId', id,
    'probeCategory', probeCategory,
    'legacySource', COALESCE(source, 'scheduled')
  )
FROM probe_observations;

CREATE TRIGGER catalog_observations_from_probe_observations
AFTER INSERT ON probe_observations
BEGIN
  INSERT INTO catalog_observations (
    agentKey,
    endpointKey,
    protocol,
    source,
    outcome,
    observedAt,
    expiresAt,
    httpStatus,
    errorCode,
    durationMs,
    detailsJson
  ) VALUES (
    'eip155:56:' || NEW.agentId,
    NULL,
    NEW.transport,
    'marketplace_probe',
    CASE NEW.outcome
      WHEN 'quote_invalid' THEN 'invalid_response'
      WHEN 'reachable' THEN 'invalid_response'
      ELSE NEW.outcome
    END,
    NEW.probedAt,
    CASE NEW.outcome
      WHEN 'quote_verified' THEN NEW.quoteExpiresAt
      WHEN 'protocol_valid' THEN NEW.probedAt + 900000
      ELSE NULL
    END,
    NEW.httpStatus,
    NEW.errorCode,
    NEW.durationMs,
    json_object(
      'legacyObservationId', NEW.id,
      'probeCategory', NEW.probeCategory,
      'legacySource', COALESCE(NEW.source, 'scheduled')
    )
  );
END;
