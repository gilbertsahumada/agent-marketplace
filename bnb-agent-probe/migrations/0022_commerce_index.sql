-- ERC-8183 Commerce indexer. `commerce_jobs` mirrors the current getJob() state
-- of every job the indexer has seen (state backfill by id, then log-driven
-- updates); `commerce_job_events` is the append-only phase ledger decoded from
-- Commerce logs. Neither table attributes a job to the marketplace: that fact is
-- derived by joining `hire_events` (provenance chain_verified) on chainId + jobId,
-- which is why hire_events gains a (chainId, jobId) index here. Times are epoch
-- milliseconds, as everywhere else in this schema; budgets are wei as decimal
-- text; jobId is an INTEGER so ordering and `before` cursors are numeric.
--
-- Rollback (wrangler tracks application; run by hand, in this order, because
-- the ledger triggers abort any later statement that touches the table):
--   DROP TRIGGER commerce_job_events_no_update; DROP TRIGGER commerce_job_events_no_delete;
--   DROP INDEX idx_hire_events_job; DROP INDEX idx_commerce_job_events_job;
--   DROP INDEX idx_commerce_jobs_status; DROP INDEX idx_commerce_jobs_provider; DROP INDEX idx_commerce_jobs_client;
--   DROP TABLE commerce_job_events; DROP TABLE commerce_jobs;
CREATE TABLE commerce_jobs (
  chainId      INTEGER NOT NULL CHECK (chainId IN (56, 97)),
  jobId        INTEGER NOT NULL CHECK (jobId >= 0),
  client       TEXT NOT NULL,
  provider     TEXT NOT NULL,
  evaluator    TEXT NOT NULL,
  budget       TEXT NOT NULL,
  expiredAt    INTEGER NOT NULL,
  status       INTEGER NOT NULL CHECK (status BETWEEN 0 AND 5),
  hook         TEXT NOT NULL,
  submittedAt  INTEGER,
  deliverable  TEXT,
  firstSeenAt  INTEGER NOT NULL,
  updatedAt    INTEGER NOT NULL,
  PRIMARY KEY (chainId, jobId)
);

CREATE INDEX idx_commerce_jobs_client
  ON commerce_jobs (chainId, client, jobId DESC);

CREATE INDEX idx_commerce_jobs_provider
  ON commerce_jobs (chainId, provider, jobId DESC);

-- (chainId, status, jobId DESC) makes `status = ? ORDER BY jobId DESC LIMIT n`
-- a range scan bounded by the LIMIT instead of a sort over every row of that
-- status.
CREATE INDEX idx_commerce_jobs_status
  ON commerce_jobs (chainId, status, jobId DESC);

CREATE TABLE commerce_job_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  chainId        INTEGER NOT NULL CHECK (chainId IN (56, 97)),
  jobId          INTEGER NOT NULL CHECK (jobId >= 0),
  phase          TEXT NOT NULL
    CHECK (phase IN ('created', 'funded', 'submitted', 'settled', 'refunded')),
  eventName      TEXT NOT NULL,
  txHash         TEXT NOT NULL,
  logIndex       INTEGER NOT NULL CHECK (logIndex >= 0),
  blockNumber    INTEGER NOT NULL CHECK (blockNumber >= 0),
  blockTimestamp INTEGER NOT NULL,
  actor          TEXT,
  amount         TEXT,
  deliverable    TEXT,
  reason         TEXT,
  indexedAt      INTEGER NOT NULL,
  UNIQUE (chainId, txHash, logIndex)
);

CREATE INDEX idx_commerce_job_events_job
  ON commerce_job_events (chainId, jobId, blockNumber);

CREATE TRIGGER commerce_job_events_no_update
BEFORE UPDATE ON commerce_job_events
BEGIN
  SELECT RAISE(ABORT, 'commerce_job_events is append-only');
END;

CREATE TRIGGER commerce_job_events_no_delete
BEFORE DELETE ON commerce_job_events
BEGIN
  SELECT RAISE(ABORT, 'commerce_job_events is append-only');
END;

CREATE INDEX idx_hire_events_job
  ON hire_events (chainId, jobId);
