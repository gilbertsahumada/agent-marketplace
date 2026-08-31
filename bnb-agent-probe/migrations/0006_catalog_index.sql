CREATE TABLE catalog_agents (
  agentKey       TEXT PRIMARY KEY,
  agentId        TEXT NOT NULL UNIQUE,
  chainId        INTEGER NOT NULL CHECK (chainId = 56),
  name           TEXT,
  description    TEXT,
  imageUrl       TEXT,
  categoriesJson TEXT NOT NULL DEFAULT '[]',
  marketplaceConfigured INTEGER NOT NULL DEFAULT 0 CHECK (marketplaceConfigured IN (0, 1)),
  metadataState  TEXT NOT NULL CHECK (metadataState IN ('ok', 'http_unreachable', 'other')),
  indexState     TEXT NOT NULL DEFAULT 'current' CHECK (indexState IN ('current', 'removed')),
  registeredAt   INTEGER,
  blockNumber    TEXT,
  firstSeenAt    INTEGER NOT NULL,
  lastSeenAt     INTEGER NOT NULL,
  priority       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_catalog_agents_priority
  ON catalog_agents (indexState, priority DESC, registeredAt DESC, agentId);

CREATE TABLE catalog_endpoints (
  endpointKey    TEXT PRIMARY KEY,
  protocol       TEXT NOT NULL CHECK (protocol IN ('a2a', 'mcp', 'web', 'erc8183_http')),
  endpoint       TEXT,
  originKey      TEXT,
  safety         TEXT NOT NULL CHECK (safety IN ('safe', 'unsafe')),
  safetyReason   TEXT CHECK (safetyReason IS NULL OR safetyReason IN (
    'invalid_url', 'https_required', 'credentials_not_allowed',
    'query_not_allowed', 'fragment_not_allowed', 'non_public_host'
  )),
  representativeAgentKey TEXT,
  lastProbedAt   INTEGER,
  nextProbeAt    INTEGER NOT NULL DEFAULT 0,
  consecutiveFailures INTEGER NOT NULL DEFAULT 0 CHECK (consecutiveFailures >= 0)
);

CREATE INDEX idx_catalog_endpoints_queue
  ON catalog_endpoints (
    safety, representativeAgentKey, nextProbeAt, lastProbedAt, endpointKey
  );

CREATE INDEX idx_catalog_endpoints_origin
  ON catalog_endpoints (originKey, protocol);

CREATE TABLE catalog_agent_endpoints (
  agentKey        TEXT NOT NULL,
  endpointKey     TEXT NOT NULL,
  declarationState TEXT NOT NULL CHECK (declarationState IN ('current', 'removed')),
  firstSeenAt     INTEGER NOT NULL,
  lastSeenAt      INTEGER NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agentKey, endpointKey)
);

CREATE INDEX idx_catalog_agent_endpoints_agent
  ON catalog_agent_endpoints (agentKey, declarationState, priority DESC, endpointKey);

CREATE INDEX idx_catalog_agent_endpoints_endpoint
  ON catalog_agent_endpoints (endpointKey, declarationState, priority DESC, agentKey);

CREATE TABLE catalog_observations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  agentKey       TEXT NOT NULL,
  endpointKey    TEXT,
  protocol       TEXT NOT NULL CHECK (protocol IN ('a2a', 'mcp', 'web', 'erc8183_http', 'erc8183')),
  source         TEXT NOT NULL CHECK (source IN (
    'browser_reported', 'marketplace_probe', 'worker_probe', 'chain_index'
  )),
  outcome        TEXT NOT NULL CHECK (outcome IN (
    'protocol_valid', 'cors_blocked', 'http_error', 'timeout',
    'network_error', 'invalid_response', 'unsafe_url', 'erc8183_detected',
    'quote_verified', 'quote_rejected', 'unreachable', 'error'
  )),
  observedAt     INTEGER NOT NULL,
  expiresAt      INTEGER,
  httpStatus     INTEGER,
  errorCode      TEXT,
  durationMs     INTEGER NOT NULL CHECK (durationMs >= 0),
  detailsJson    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_catalog_observations_agent
  ON catalog_observations (agentKey, observedAt DESC, id DESC);

CREATE INDEX idx_catalog_observations_endpoint
  ON catalog_observations (endpointKey, observedAt DESC, id DESC);

CREATE INDEX idx_catalog_observations_outcome
  ON catalog_observations (outcome, observedAt DESC, id DESC);
