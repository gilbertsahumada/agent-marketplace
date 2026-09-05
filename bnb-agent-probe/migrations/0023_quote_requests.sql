-- Unified seller capability and buyer quote ledger.
-- Briefs are deliberately never stored; requestHash is the public-safe
-- canonical identity of the request and metadataJson is sanitized metadata.
ALTER TABLE hire_events ADD COLUMN quoteRequestId INTEGER;
CREATE INDEX IF NOT EXISTS idx_hire_events_quote_request ON hire_events (quoteRequestId);
CREATE INDEX IF NOT EXISTS idx_hire_events_job_quote ON hire_events (chainId, jobId, quoteRequestId);

CREATE TABLE IF NOT EXISTS catalog_seller_capabilities (
  agentKey TEXT NOT NULL,
  endpointKey TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('a2a', 'mcp', 'erc8183_http')),
  state TEXT NOT NULL CHECK (state IN ('unsupported', 'discovered', 'ready', 'stale', 'failed', 'suspended')),
  lastSuccessAt INTEGER,
  capabilityExpiresAt INTEGER,
  nextProbeAt INTEGER,
  consecutiveFailures INTEGER NOT NULL DEFAULT 0 CHECK (consecutiveFailures >= 0),
  lastAttemptAt INTEGER,
  lastAttemptId TEXT,
  lastErrorCode TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (agentKey, endpointKey)
);
CREATE INDEX IF NOT EXISTS idx_catalog_seller_capabilities_queue
  ON catalog_seller_capabilities (state, nextProbeAt, updatedAt);
CREATE INDEX IF NOT EXISTS idx_catalog_seller_capabilities_agent
  ON catalog_seller_capabilities (agentKey, updatedAt DESC);

CREATE TABLE IF NOT EXISTS catalog_quote_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requestHash TEXT NOT NULL,
  artifactHash TEXT,
  agentKey TEXT NOT NULL,
  endpointKey TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('a2a', 'mcp', 'erc8183_http')),
  kind TEXT NOT NULL CHECK (kind IN ('capability_probe', 'buyer_quote')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'rejected', 'failed', 'expired')),
  callerKey TEXT NOT NULL DEFAULT 'anonymous' CHECK (length(callerKey) BETWEEN 1 AND 128),
  createdAt INTEGER NOT NULL,
  completedAt INTEGER,
  quoteExpiresAt INTEGER,
  resultObservationId INTEGER,
  errorCode TEXT,
  metadataJson TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_catalog_quote_requests_agent
  ON catalog_quote_requests (agentKey, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_quote_requests_status
  ON catalog_quote_requests (status, createdAt);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_quote_requests_dedupe
  ON catalog_quote_requests (agentKey, requestHash, createdAt);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_quote_requests_artifact
  ON catalog_quote_requests (agentKey, artifactHash)
  WHERE artifactHash IS NOT NULL;

CREATE TABLE IF NOT EXISTS catalog_quote_attempts (
  id TEXT PRIMARY KEY,
  requestId INTEGER NOT NULL,
  executor TEXT NOT NULL CHECK (executor IN ('browser', 'worker')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'rejected', 'failed')),
  startedAt INTEGER NOT NULL,
  finishedAt INTEGER,
  durationMs INTEGER CHECK (durationMs IS NULL OR durationMs >= 0),
  httpStatus INTEGER,
  outcome TEXT,
  errorCode TEXT,
  metadataJson TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_catalog_quote_attempts_request
  ON catalog_quote_attempts (requestId, startedAt DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_quote_attempts_status
  ON catalog_quote_attempts (status, startedAt DESC);

-- Evidence migration is intentionally conservative. Existing admission rows
-- remain readable during rollout; only an explicit admitted row becomes a
-- ready capability, without inventing an attempt or a buyer brief.
INSERT OR IGNORE INTO catalog_seller_capabilities (
  agentKey, endpointKey, transport, state, lastSuccessAt, capabilityExpiresAt,
  nextProbeAt, consecutiveFailures, lastAttemptAt, lastAttemptId,
  lastErrorCode, createdAt, updatedAt
)
SELECT agentKey, endpointKey, commerceTransport,
  -- Do not manufacture a fresh capability from an admission row that has no
  -- validation timestamp. Those rows are candidates and must be probed by the
  -- new capability queue before they can be advertised as ready.
  CASE
    WHEN state = 'suspended' THEN 'suspended'
    WHEN state = 'admitted' AND validatedAt IS NOT NULL THEN 'ready'
    ELSE 'discovered'
  END,
  validatedAt,
  CASE WHEN validatedAt IS NULL THEN NULL ELSE validatedAt + 86400000 END,
  CASE
    WHEN state = 'suspended' THEN NULL
    WHEN validatedAt IS NULL THEN 0
    ELSE validatedAt + 86400000
  END,
  0, validatedAt, NULL, NULL,
  COALESCE(validatedAt, strftime('%s','now') * 1000),
  COALESCE(validatedAt, strftime('%s','now') * 1000)
FROM catalog_agent_admission
WHERE endpointKey IS NOT NULL
  AND commerceTransport IN ('a2a', 'erc8183_http');

-- Every normalized operational declaration is a capability candidate. This
-- includes MCP and agents that were never admitted by the legacy projection;
-- the first standardized probe decides whether the row becomes ready.
INSERT OR IGNORE INTO catalog_seller_capabilities (
  agentKey, endpointKey, transport, state, lastSuccessAt, capabilityExpiresAt,
  nextProbeAt, consecutiveFailures, lastAttemptAt, lastAttemptId,
  lastErrorCode, createdAt, updatedAt
)
SELECT relation.agentKey, relation.endpointKey, endpoint.validationProtocol,
  'discovered', NULL, NULL, 0, 0, NULL, NULL, NULL,
  strftime('%s','now') * 1000, strftime('%s','now') * 1000
FROM catalog_agent_endpoints relation
JOIN catalog_agents agent ON agent.agentKey = relation.agentKey
JOIN catalog_endpoints endpoint ON endpoint.endpointKey = relation.endpointKey
WHERE agent.indexState = 'current'
  AND relation.declarationState = 'current'
  AND endpoint.role = 'operational'
  AND endpoint.eligibility = 'eligible'
  AND endpoint.validationProtocol IN ('a2a', 'mcp', 'erc8183_http');

-- Preserve existing cryptographic quote evidence as a logical request without
-- fabricating a buyer brief or a physical attempt.  `resultObservationId` is
-- the idempotency key for this conservative backfill; rows created here are
-- explicitly marked as migrated evidence in public-safe metadata.
INSERT INTO catalog_quote_requests (
  requestHash, artifactHash, agentKey, endpointKey, transport, kind, status,
  callerKey, createdAt, completedAt, quoteExpiresAt, resultObservationId,
  errorCode, metadataJson
)
SELECT
  CASE
    -- Quote observations already carry the canonical request hash in their
    -- public-safe details. Preserve it when present; an artifact hash is the
    -- envelope identity and must not be mislabelled as the request hash.
    WHEN json_extract(observation.detailsJson, '$.requestHash') IS NOT NULL
      AND length(json_extract(observation.detailsJson, '$.requestHash')) = 66
      AND lower(substr(json_extract(observation.detailsJson, '$.requestHash'), 1, 2)) = '0x'
    THEN lower(json_extract(observation.detailsJson, '$.requestHash'))
    ELSE printf('migrated-observation:%d', observation.id)
  END,
  observation.artifactHash,
  observation.agentKey,
  observation.endpointKey,
  CASE
    WHEN observation.protocol IN ('a2a', 'mcp', 'erc8183_http') THEN observation.protocol
    ELSE 'erc8183_http'
  END,
  'buyer_quote',
  CASE WHEN observation.outcome = 'quote_verified' THEN 'succeeded' ELSE 'rejected' END,
  'migration',
  observation.observedAt,
  observation.observedAt,
  observation.expiresAt,
  observation.id,
  observation.errorCode,
  json_object(
    'evidenceMigrated', 1,
    'source', 'catalog_observations',
    'observationId', observation.id
  )
FROM catalog_observations observation
WHERE observation.endpointKey IS NOT NULL
  AND observation.validationKind = 'quote'
  AND observation.verificationLevel = 'cryptographic'
  AND observation.outcome IN ('quote_verified', 'quote_rejected')
  AND COALESCE(json_extract(observation.detailsJson, '$.quoteKind'), '') <> 'capability_probe'
  AND observation.protocol IN ('a2a', 'mcp', 'erc8183_http', 'erc8183')
  AND NOT EXISTS (
    SELECT 1 FROM catalog_quote_requests request
    WHERE request.resultObservationId = observation.id
       OR (observation.artifactHash IS NOT NULL AND request.agentKey = observation.agentKey
           AND request.artifactHash = observation.artifactHash)
  );
