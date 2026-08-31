CREATE TABLE catalog_ingest_tasks (
  agentKey              TEXT PRIMARY KEY,
  metadataVersion       TEXT NOT NULL,
  nextDeclarationIndex  INTEGER NOT NULL DEFAULT 0 CHECK (nextDeclarationIndex >= 0),
  declarationCount      INTEGER NOT NULL CHECK (declarationCount >= 0),
  status                TEXT NOT NULL CHECK (status IN ('pending', 'retiring', 'completed', 'failed')),
  requestedBy           TEXT NOT NULL CHECK (requestedBy IN ('header', 'sweep', 'directed', 'reconciliation')),
  priority              INTEGER NOT NULL DEFAULT 0,
  generationStartedAt   INTEGER NOT NULL,
  upstreamObservedAt    INTEGER,
  updatedAt             INTEGER NOT NULL,
  attemptCount          INTEGER NOT NULL DEFAULT 0 CHECK (attemptCount >= 0),
  retryAt               INTEGER NOT NULL DEFAULT 0,
  errorCode             TEXT,
  leaseOwner            TEXT,
  leaseExpiresAt        INTEGER
);

CREATE INDEX idx_catalog_ingest_tasks_work
  ON catalog_ingest_tasks (status, retryAt, priority DESC, updatedAt, agentKey);
