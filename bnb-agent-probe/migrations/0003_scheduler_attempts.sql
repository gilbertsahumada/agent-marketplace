CREATE TABLE scheduler_attempts (
  id                              INTEGER PRIMARY KEY AUTOINCREMENT,
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
  UNIQUE (scheduledTime, attempt)
);

CREATE INDEX idx_scheduler_attempts_window
  ON scheduler_attempts (scheduledTime, attempt);

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
