CREATE TABLE hire_notifications (
  chainId INTEGER NOT NULL CHECK(chainId IN (56,97)),
  jobId TEXT NOT NULL,
  agentId TEXT NOT NULL,
  quoteRequestId INTEGER NOT NULL,
  buyer TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  nextAttemptAt INTEGER NOT NULL,
  leaseToken TEXT,
  leaseUntil INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY(chainId,jobId)
);
CREATE INDEX hire_notifications_due ON hire_notifications(state,nextAttemptAt);
