CREATE TABLE probe_targets (
  agentId                   TEXT NOT NULL,
  chainId                   INTEGER NOT NULL CHECK (chainId = 56),
  transport                 TEXT NOT NULL
    CHECK (transport IN ('a2a', 'erc8183_http')),
  endpoint                  TEXT NOT NULL,
  name                      TEXT,
  categoriesJson            TEXT NOT NULL DEFAULT '[]',
  categoryProvenance        TEXT CHECK (
    categoryProvenance IS NULL OR categoryProvenance = 'derived:marketplace-inventory'
  ),
  declarationState          TEXT NOT NULL
    CHECK (declarationState IN ('current', 'removed', 'metadata_unavailable')),
  currentMetadataUpdatedAt  INTEGER,
  lastMetadataCheckedAt     INTEGER NOT NULL,
  firstSeenAt               INTEGER NOT NULL,
  lastChangedAt             INTEGER NOT NULL,
  lastSeenAt                INTEGER NOT NULL,
  priority                  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chainId, agentId, transport, endpoint)
);

CREATE INDEX idx_targets_probe
  ON probe_targets (declarationState, priority DESC, chainId, agentId);

CREATE TABLE probe_observations (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  agentId                    TEXT NOT NULL,
  chainId                    INTEGER NOT NULL CHECK (chainId = 56),
  transport                  TEXT NOT NULL
    CHECK (transport IN ('a2a', 'erc8183_http')),
  endpoint                   TEXT NOT NULL,
  probedAt                   INTEGER NOT NULL,
  probeCategory              TEXT CHECK (
    probeCategory IS NULL OR probeCategory IN (
      'rebalancing', 'grid_trading', 'yield_optimisation',
      'health_factor_monitoring'
    )
  ),
  outcome                    TEXT NOT NULL CHECK (outcome IN (
    'quote_verified', 'protocol_valid', 'quote_rejected', 'quote_invalid',
    'reachable', 'unreachable', 'unsafe_url', 'error'
  )),
  observedMetadataUpdatedAt  INTEGER,
  observedWallet             TEXT,
  observedWalletSource       TEXT
    CHECK (observedWalletSource IS NULL OR observedWalletSource IN ('agentWallet', 'ownerOf')),
  observedBlockNumber        TEXT,
  onchainObservedAt          INTEGER,
  commerce                   TEXT,
  router                     TEXT,
  policy                     TEXT,
  priceRaw                   TEXT,
  currency                   TEXT,
  decimals                   INTEGER,
  signatureMethod            TEXT
    CHECK (signatureMethod IS NULL OR signatureMethod IN ('eip191', 'erc1271')),
  signer                     TEXT,
  requestHash                TEXT,
  negotiationHash            TEXT,
  quoteNegotiatedAt          INTEGER,
  quoteExpiresAt             INTEGER,
  httpStatus                 INTEGER,
  errorCode                  TEXT,
  durationMs                 INTEGER NOT NULL
);

CREATE INDEX idx_obs_agent
  ON probe_observations (chainId, agentId, probedAt DESC);

CREATE INDEX idx_obs_target
  ON probe_observations (chainId, agentId, transport, endpoint, probedAt DESC);

CREATE INDEX idx_obs_target_category
  ON probe_observations (
    chainId, agentId, transport, endpoint, probeCategory, probedAt DESC
  );

CREATE TABLE funnel_snapshots (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  measuredAt                 INTEGER NOT NULL,
  blockNumber                TEXT NOT NULL,
  sourcePath                 TEXT NOT NULL,
  sourceSha256               TEXT NOT NULL,
  registeredTotal            INTEGER NOT NULL,
  metadataOk                 INTEGER NOT NULL,
  metadataHttpUnreachable    INTEGER NOT NULL,
  metadataOther              INTEGER NOT NULL,
  a2aOnly                    INTEGER NOT NULL,
  erc8183Only                INTEGER NOT NULL,
  both                       INTEGER NOT NULL,
  mcpOnly                    INTEGER NOT NULL,
  otherOrNone                INTEGER NOT NULL,
  protocolUnknown            INTEGER NOT NULL,
  declaredCandidateEndpoints INTEGER NOT NULL,
  publicCandidateEndpoints   INTEGER NOT NULL
);

CREATE TABLE hire_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  eventKey         TEXT NOT NULL UNIQUE,
  agentId          TEXT NOT NULL,
  chainId          INTEGER NOT NULL CHECK (chainId = 56),
  phase            TEXT NOT NULL CHECK (phase IN (
    'clicked', 'quoted', 'quote_rejected',
    'created', 'funded', 'submitted', 'settled', 'refunded'
  )),
  provenance       TEXT NOT NULL
    CHECK (provenance IN ('marketplace_observed', 'chain_verified')),
  jobId            TEXT,
  txHash           TEXT,
  blockNumber      TEXT,
  occurredAt       INTEGER NOT NULL,
  verifiedAt       INTEGER
);

CREATE INDEX idx_hire_agent
  ON hire_events (chainId, agentId, occurredAt DESC);

CREATE TABLE runtime_state (
  key          TEXT PRIMARY KEY,
  textValue    TEXT,
  integerValue INTEGER,
  updatedAt    INTEGER NOT NULL
);
