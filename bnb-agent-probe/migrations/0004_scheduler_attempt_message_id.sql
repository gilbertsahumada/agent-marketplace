CREATE TABLE scheduler_attempts_v2 (
  id                              INTEGER PRIMARY KEY AUTOINCREMENT,
  messageId                       TEXT NOT NULL CHECK (length(messageId) BETWEEN 1 AND 256),
  scheduledTime                   INTEGER NOT NULL,
  attempt                         INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 4),
  phase                           TEXT CHECK (phase IS NULL OR phase IN ('header', 'sweep', 'probe')),
  outcome                         TEXT NOT NULL
    CHECK (outcome IN ('completed', 'failed', 'duplicate', 'locked')),
  startedAt                       INTEGER NOT NULL,
  finishedAt                      INTEGER NOT NULL CHECK (finishedAt >= startedAt),
  upstreamRequests                INTEGER NOT NULL CHECK (upstreamRequests >= 0),
  d1Queries                       INTEGER NOT NULL CHECK (d1Queries BETWEEN 1 AND 40),
  rowsReadObservedBeforeLedger    INTEGER NOT NULL CHECK (rowsReadObservedBeforeLedger >= 0),
  rowsWrittenObservedBeforeLedger INTEGER NOT NULL CHECK (rowsWrittenObservedBeforeLedger >= 0),
  errorCode                       TEXT,
  UNIQUE (messageId, attempt)
);

INSERT INTO scheduler_attempts_v2 (
  id, messageId, scheduledTime, attempt, phase, outcome, startedAt, finishedAt,
  upstreamRequests, d1Queries, rowsReadObservedBeforeLedger,
  rowsWrittenObservedBeforeLedger, errorCode
)
SELECT
  id, 'legacy:' || id, scheduledTime, attempt, phase, outcome, startedAt, finishedAt,
  upstreamRequests, d1Queries, rowsReadObservedBeforeLedger,
  rowsWrittenObservedBeforeLedger, errorCode
FROM scheduler_attempts;

DROP TRIGGER scheduler_attempts_no_update;
DROP TRIGGER scheduler_attempts_no_delete;
DROP INDEX idx_scheduler_attempts_window;
DROP TABLE scheduler_attempts;
ALTER TABLE scheduler_attempts_v2 RENAME TO scheduler_attempts;

CREATE INDEX idx_scheduler_attempts_window
  ON scheduler_attempts (scheduledTime, messageId, attempt);

CREATE TRIGGER scheduler_attempts_no_update
BEFORE UPDATE ON scheduler_attempts
BEGIN
  SELECT RAISE(ABORT, 'scheduler_attempts is append-only');
END;

CREATE TRIGGER scheduler_attempts_no_delete
BEFORE DELETE ON scheduler_attempts
BEGIN
  SELECT RAISE(ABORT, 'scheduler_attempts is append-only');
END;
