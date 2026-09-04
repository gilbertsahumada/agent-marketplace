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
--   DROP TRIGGER hire_events_count_delete; DROP TRIGGER hire_events_count_insert;
--   DROP TRIGGER commerce_jobs_count_delete; DROP TRIGGER commerce_jobs_count_status; DROP TRIGGER commerce_jobs_count_insert;
--   DROP INDEX idx_hire_events_job; DROP INDEX idx_commerce_job_events_job;
--   DROP INDEX idx_commerce_jobs_status; DROP INDEX idx_commerce_jobs_provider; DROP INDEX idx_commerce_jobs_client;
--   DROP TABLE commerce_job_events; DROP TABLE commerce_job_counts; DROP TABLE commerce_jobs;
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

-- Fixed-size aggregate (2 chains * 6 statuses) for the public summary route.
-- Triggers keep it transactionally consistent with job state and the first
-- chain-verified marketplace attribution, so a cache miss never scans the
-- protocol ledger.
CREATE TABLE commerce_job_counts (
  chainId          INTEGER NOT NULL CHECK (chainId IN (56, 97)),
  status           INTEGER NOT NULL CHECK (status BETWEEN 0 AND 5),
  protocolJobs     INTEGER NOT NULL DEFAULT 0 CHECK (protocolJobs >= 0),
  marketplaceJobs INTEGER NOT NULL DEFAULT 0 CHECK (marketplaceJobs >= 0),
  PRIMARY KEY (chainId, status)
);

INSERT INTO commerce_job_counts (chainId, status)
VALUES (56, 0), (56, 1), (56, 2), (56, 3), (56, 4), (56, 5),
       (97, 0), (97, 1), (97, 2), (97, 3), (97, 4), (97, 5);

CREATE TRIGGER commerce_jobs_count_insert
AFTER INSERT ON commerce_jobs
BEGIN
  UPDATE commerce_job_counts
  SET protocolJobs = protocolJobs + 1,
      marketplaceJobs = marketplaceJobs + CASE WHEN EXISTS (
        SELECT 1 FROM hire_events h
        WHERE h.chainId = NEW.chainId AND h.jobId = CAST(NEW.jobId AS TEXT)
          AND h.provenance = 'chain_verified'
      ) THEN 1 ELSE 0 END
  WHERE chainId = NEW.chainId AND status = NEW.status;
END;

CREATE TRIGGER commerce_jobs_count_status
AFTER UPDATE OF status ON commerce_jobs
WHEN OLD.status <> NEW.status
BEGIN
  UPDATE commerce_job_counts
  SET protocolJobs = protocolJobs - 1,
      marketplaceJobs = marketplaceJobs - CASE WHEN EXISTS (
        SELECT 1 FROM hire_events h
        WHERE h.chainId = OLD.chainId AND h.jobId = CAST(OLD.jobId AS TEXT)
          AND h.provenance = 'chain_verified'
      ) THEN 1 ELSE 0 END
  WHERE chainId = OLD.chainId AND status = OLD.status;
  UPDATE commerce_job_counts
  SET protocolJobs = protocolJobs + 1,
      marketplaceJobs = marketplaceJobs + CASE WHEN EXISTS (
        SELECT 1 FROM hire_events h
        WHERE h.chainId = NEW.chainId AND h.jobId = CAST(NEW.jobId AS TEXT)
          AND h.provenance = 'chain_verified'
      ) THEN 1 ELSE 0 END
  WHERE chainId = NEW.chainId AND status = NEW.status;
END;

CREATE TRIGGER commerce_jobs_count_delete
AFTER DELETE ON commerce_jobs
BEGIN
  UPDATE commerce_job_counts
  SET protocolJobs = protocolJobs - 1,
      marketplaceJobs = marketplaceJobs - CASE WHEN EXISTS (
        SELECT 1 FROM hire_events h
        WHERE h.chainId = OLD.chainId AND h.jobId = CAST(OLD.jobId AS TEXT)
          AND h.provenance = 'chain_verified'
      ) THEN 1 ELSE 0 END
  WHERE chainId = OLD.chainId AND status = OLD.status;
END;

CREATE TRIGGER hire_events_count_insert
AFTER INSERT ON hire_events
WHEN NEW.provenance = 'chain_verified' AND NEW.jobId IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hire_events h
    WHERE h.id <> NEW.id AND h.chainId = NEW.chainId AND h.jobId = NEW.jobId
      AND h.provenance = 'chain_verified'
  )
BEGIN
  UPDATE commerce_job_counts
  SET marketplaceJobs = marketplaceJobs + 1
  WHERE chainId = NEW.chainId AND status = (
    SELECT status FROM commerce_jobs
    WHERE chainId = NEW.chainId AND jobId = CAST(NEW.jobId AS INTEGER)
  );
END;

CREATE TRIGGER hire_events_count_delete
AFTER DELETE ON hire_events
WHEN OLD.provenance = 'chain_verified' AND OLD.jobId IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hire_events h
    WHERE h.chainId = OLD.chainId AND h.jobId = OLD.jobId
      AND h.provenance = 'chain_verified'
  )
BEGIN
  UPDATE commerce_job_counts
  SET marketplaceJobs = marketplaceJobs - 1
  WHERE chainId = OLD.chainId AND status = (
    SELECT status FROM commerce_jobs
    WHERE chainId = OLD.chainId AND jobId = CAST(OLD.jobId AS INTEGER)
  );
END;

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
