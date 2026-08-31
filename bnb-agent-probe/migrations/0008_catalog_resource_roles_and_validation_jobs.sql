ALTER TABLE catalog_agents ADD COLUMN metadataVersion TEXT;
ALTER TABLE catalog_agents ADD COLUMN metadataObservedAt INTEGER;
ALTER TABLE catalog_agents ADD COLUMN policyVersion INTEGER NOT NULL DEFAULT 2 CHECK (policyVersion >= 1);

UPDATE catalog_agents
SET metadataObservedAt = lastSeenAt
WHERE metadataObservedAt IS NULL;

ALTER TABLE catalog_endpoints ADD COLUMN declaredProtocol TEXT NOT NULL DEFAULT 'unknown'
  CHECK (declaredProtocol IN ('a2a', 'mcp', 'erc8183_http', 'x402', 'web', 'unknown'));
ALTER TABLE catalog_endpoints ADD COLUMN role TEXT NOT NULL DEFAULT 'external'
  CHECK (role IN ('operational', 'external'));
ALTER TABLE catalog_endpoints ADD COLUMN validationProtocol TEXT
  CHECK (validationProtocol IS NULL OR validationProtocol IN ('a2a', 'mcp', 'erc8183_http'));
ALTER TABLE catalog_endpoints ADD COLUMN externalKind TEXT
  CHECK (externalKind IS NULL OR externalKind IN ('website', 'social', 'repository', 'documentation', 'other'));
ALTER TABLE catalog_endpoints ADD COLUMN eligibility TEXT NOT NULL DEFAULT 'unsupported'
  CHECK (eligibility IN ('eligible', 'unsafe', 'invalid_declaration', 'unsupported'));
ALTER TABLE catalog_endpoints ADD COLUMN lastAttemptAt INTEGER;
ALTER TABLE catalog_endpoints ADD COLUMN lastAttemptOutcome TEXT;
ALTER TABLE catalog_endpoints ADD COLUMN lastSuccessfulAt INTEGER;

UPDATE catalog_endpoints
SET declaredProtocol = protocol,
    role = CASE WHEN protocol = 'web' THEN 'external' ELSE 'operational' END,
    validationProtocol = CASE WHEN protocol IN ('a2a', 'mcp', 'erc8183_http') THEN protocol ELSE NULL END,
    externalKind = CASE WHEN protocol = 'web' THEN 'website' ELSE NULL END,
    eligibility = CASE
      WHEN safety = 'unsafe' THEN 'unsafe'
      WHEN protocol IN ('a2a', 'mcp', 'erc8183_http') THEN 'eligible'
      ELSE 'unsupported'
    END,
    lastAttemptAt = lastProbedAt;

CREATE INDEX idx_catalog_endpoints_validation_queue
  ON catalog_endpoints (
    role, eligibility, validationProtocol, nextProbeAt, lastAttemptAt, endpointKey
  );

ALTER TABLE catalog_agent_endpoints ADD COLUMN rawServiceLabel TEXT;
ALTER TABLE catalog_agent_endpoints ADD COLUMN rawSource TEXT
  CHECK (rawSource IS NULL OR rawSource IN ('services', 'endpoints', 'shortcut'));
ALTER TABLE catalog_agent_endpoints ADD COLUMN rawSourceIndex INTEGER
  CHECK (rawSourceIndex IS NULL OR rawSourceIndex >= 0);
ALTER TABLE catalog_agent_endpoints ADD COLUMN metadataVersion TEXT;

ALTER TABLE catalog_observations ADD COLUMN attemptId TEXT;
ALTER TABLE catalog_observations ADD COLUMN validationKind TEXT NOT NULL DEFAULT 'protocol'
  CHECK (validationKind IN ('reachability', 'protocol', 'quote', 'chain'));
ALTER TABLE catalog_observations ADD COLUMN verificationLevel TEXT NOT NULL DEFAULT 'platform_observed'
  CHECK (verificationLevel IN ('user_observed', 'platform_observed', 'cryptographic', 'onchain'));
ALTER TABLE catalog_observations ADD COLUMN artifactHash TEXT;

UPDATE catalog_observations
SET attemptId = 'migration:' || id,
    validationKind = CASE
      WHEN outcome IN ('quote_verified', 'quote_rejected') THEN 'quote'
      WHEN source = 'chain_index' THEN 'chain'
      ELSE 'protocol'
    END,
    verificationLevel = CASE
      WHEN source = 'browser_reported' THEN 'user_observed'
      WHEN source = 'chain_index' THEN 'onchain'
      WHEN outcome = 'quote_verified' THEN 'cryptographic'
      ELSE 'platform_observed'
    END;

CREATE UNIQUE INDEX idx_catalog_observations_attempt
  ON catalog_observations (attemptId)
  WHERE attemptId IS NOT NULL;

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

CREATE TABLE catalog_validation_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupeKey           TEXT NOT NULL,
  agentKey            TEXT NOT NULL,
  endpointKey         TEXT NOT NULL,
  validationKind      TEXT NOT NULL CHECK (validationKind IN ('reachability', 'protocol', 'quote', 'chain')),
  requestedBy         TEXT NOT NULL CHECK (requestedBy IN ('system', 'browser_fallback', 'admission')),
  status              TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  priority            INTEGER NOT NULL DEFAULT 0,
  createdAt           INTEGER NOT NULL,
  startedAt           INTEGER,
  completedAt         INTEGER,
  attemptCount        INTEGER NOT NULL DEFAULT 0 CHECK (attemptCount >= 0),
  resultObservationId INTEGER,
  errorCode           TEXT,
  leaseOwner          TEXT,
  leaseExpiresAt      INTEGER
);

CREATE UNIQUE INDEX idx_catalog_validation_requests_active
  ON catalog_validation_requests (dedupeKey)
  WHERE status IN ('queued', 'running');

CREATE INDEX idx_catalog_validation_requests_queue
  ON catalog_validation_requests (status, priority DESC, createdAt, id);

CREATE TABLE catalog_agent_admission (
  agentKey              TEXT PRIMARY KEY,
  state                 TEXT NOT NULL CHECK (state IN ('candidate', 'admitted', 'suspended')),
  commerceTransport     TEXT CHECK (commerceTransport IS NULL OR commerceTransport IN ('a2a', 'erc8183_http')),
  endpointKey           TEXT,
  chainId               INTEGER NOT NULL DEFAULT 56 CHECK (chainId = 56),
  provider              TEXT,
  validatedAt           INTEGER,
  configurationVersion  TEXT,
  reasonCode            TEXT
);

INSERT INTO catalog_agent_admission (
  agentKey, state, commerceTransport, endpointKey, chainId,
  provider, validatedAt, configurationVersion, reasonCode
)
SELECT
  agentKey,
  'candidate',
  NULL,
  NULL,
  chainId,
  NULL,
  NULL,
  'migration-0008',
  'legacy_backfill'
FROM catalog_agents
WHERE marketplaceConfigured = 1;
