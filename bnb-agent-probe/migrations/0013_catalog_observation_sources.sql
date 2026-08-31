DROP TRIGGER IF EXISTS catalog_observations_no_update;
DROP TRIGGER IF EXISTS catalog_observations_no_delete;
DROP TRIGGER IF EXISTS catalog_observations_from_probe_observations;

ALTER TABLE catalog_observations RENAME TO catalog_observations_legacy_0013;

CREATE TABLE catalog_observations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  agentKey          TEXT NOT NULL,
  endpointKey       TEXT,
  protocol          TEXT NOT NULL CHECK (protocol IN ('a2a', 'mcp', 'web', 'erc8183_http', 'erc8183')),
  source            TEXT NOT NULL CHECK (source IN ('browser_reported', 'worker_probe', 'buyer_refresh', 'chain_read', 'migration')),
  outcome           TEXT NOT NULL CHECK (outcome IN (
    'protocol_valid', 'cors_blocked', 'http_error', 'timeout',
    'network_error', 'invalid_response', 'unsafe_url', 'erc8183_detected',
    'quote_verified', 'quote_rejected', 'unreachable', 'error'
  )),
  observedAt        INTEGER NOT NULL,
  expiresAt         INTEGER,
  httpStatus        INTEGER,
  errorCode         TEXT,
  durationMs        INTEGER NOT NULL CHECK (durationMs >= 0),
  detailsJson       TEXT NOT NULL DEFAULT '{}',
  attemptId         TEXT,
  validationKind    TEXT NOT NULL DEFAULT 'protocol' CHECK (validationKind IN ('reachability', 'protocol', 'quote', 'chain')),
  verificationLevel TEXT NOT NULL DEFAULT 'platform_observed' CHECK (verificationLevel IN ('user_observed', 'platform_observed', 'cryptographic', 'onchain')),
  artifactHash      TEXT,
  CHECK (source <> 'browser_reported' OR verificationLevel IN ('user_observed', 'cryptographic')),
  CHECK (source <> 'chain_read' OR verificationLevel = 'onchain'),
  CHECK (validationKind <> 'chain' OR verificationLevel = 'onchain'),
  CHECK (outcome <> 'quote_verified' OR verificationLevel = 'cryptographic')
);

INSERT INTO catalog_observations (
  id, agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt,
  httpStatus, errorCode, durationMs, detailsJson, attemptId, validationKind,
  verificationLevel, artifactHash
)
SELECT
  id, agentKey, endpointKey, protocol,
  CASE source
    WHEN 'chain_index' THEN 'chain_read'
    WHEN 'marketplace_probe' THEN 'worker_probe'
    ELSE source
  END,
  outcome, observedAt, expiresAt, httpStatus, errorCode, durationMs, detailsJson,
  attemptId, validationKind, verificationLevel, artifactHash
FROM catalog_observations_legacy_0013;

DROP TABLE catalog_observations_legacy_0013;

CREATE INDEX idx_catalog_observations_agent
  ON catalog_observations (agentKey, observedAt DESC, id DESC);
CREATE INDEX idx_catalog_observations_endpoint
  ON catalog_observations (endpointKey, observedAt DESC, id DESC);
CREATE INDEX idx_catalog_observations_outcome
  ON catalog_observations (outcome, observedAt DESC, id DESC);
CREATE UNIQUE INDEX idx_catalog_observations_attempt
  ON catalog_observations (attemptId) WHERE attemptId IS NOT NULL;
CREATE UNIQUE INDEX idx_catalog_observations_quote_artifact
  ON catalog_observations (artifactHash)
  WHERE validationKind = 'quote' AND artifactHash IS NOT NULL;

CREATE TRIGGER catalog_observations_no_update
BEFORE UPDATE ON catalog_observations
BEGIN
  SELECT RAISE(ABORT, 'catalog_observations is append-only');
END;

CREATE TRIGGER catalog_observations_no_delete
BEFORE DELETE ON catalog_observations
BEGIN
  SELECT RAISE(ABORT, 'catalog_observations is append-only');
END;

CREATE TRIGGER catalog_observations_from_probe_observations
AFTER INSERT ON probe_observations
BEGIN
  INSERT INTO catalog_observations (
    agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt,
    httpStatus, errorCode, durationMs, detailsJson, attemptId, validationKind,
    verificationLevel
  ) VALUES (
    'eip155:56:' || NEW.agentId,
    NULL,
    NEW.transport,
    'migration',
    CASE NEW.outcome
      WHEN 'quote_invalid' THEN 'invalid_response'
      WHEN 'reachable' THEN 'invalid_response'
      ELSE NEW.outcome
    END,
    NEW.probedAt,
    CASE
      WHEN NEW.outcome = 'quote_verified' THEN NEW.quoteExpiresAt
      WHEN NEW.outcome = 'protocol_valid' THEN NEW.probedAt + 900000
      ELSE NULL
    END,
    NEW.httpStatus,
    NEW.errorCode,
    NEW.durationMs,
    json_object(
      'schemaVersion', 2,
      'legacyObservationId', NEW.id,
      'probeCategory', NEW.probeCategory,
      'legacySource', COALESCE(NEW.source, 'scheduled')
    ),
    'legacy-probe:' || NEW.id,
    CASE WHEN NEW.outcome IN ('quote_verified', 'quote_invalid') THEN 'quote' ELSE 'protocol' END,
    CASE WHEN NEW.outcome = 'quote_verified' THEN 'cryptographic' ELSE 'platform_observed' END
  );
END;
