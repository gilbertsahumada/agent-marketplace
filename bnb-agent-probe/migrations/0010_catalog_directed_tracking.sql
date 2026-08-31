CREATE TABLE catalog_directed_tracking (
  agentKey       TEXT PRIMARY KEY,
  chainId        INTEGER NOT NULL CHECK (chainId = 56),
  agentId        TEXT NOT NULL,
  txHash         TEXT NOT NULL UNIQUE,
  blockNumber    TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('registered', 'listed')),
  registeredAt   INTEGER NOT NULL,
  listedAt       INTEGER,
  createdAt      INTEGER NOT NULL,
  updatedAt      INTEGER NOT NULL,
  errorCode      TEXT
);

CREATE INDEX idx_catalog_directed_tracking_status
  ON catalog_directed_tracking (status, updatedAt, agentKey);
