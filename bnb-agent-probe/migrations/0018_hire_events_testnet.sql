-- WP6: hire events may originate on BSC Testnet (97) as well as Mainnet (56).
-- The browser hire demo and the agent-buyer demo execute on Testnet; every
-- chain phase is still verified by RPC against the deployment of the reported
-- chain before it is stored. SQLite cannot alter a CHECK in place, so the
-- append-only table is rebuilt with its rows and index preserved.
ALTER TABLE hire_events RENAME TO hire_events_legacy_0018;

CREATE TABLE hire_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  eventKey         TEXT NOT NULL UNIQUE,
  agentId          TEXT NOT NULL,
  chainId          INTEGER NOT NULL CHECK (chainId IN (56, 97)),
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

INSERT INTO hire_events (
  id, eventKey, agentId, chainId, phase, provenance,
  jobId, txHash, blockNumber, occurredAt, verifiedAt
)
SELECT
  id, eventKey, agentId, chainId, phase, provenance,
  jobId, txHash, blockNumber, occurredAt, verifiedAt
FROM hire_events_legacy_0018;

DROP TABLE hire_events_legacy_0018;

CREATE INDEX idx_hire_agent
  ON hire_events (chainId, agentId, occurredAt DESC);
