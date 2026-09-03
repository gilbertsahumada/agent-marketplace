-- The ingest claim picks one task ordered by priority DESC, updatedAt, agentKey.
-- idx_catalog_ingest_tasks_work led with retryAt, so SQLite had to read and
-- sort every claimable task on every tick (401 rows for a 200-task backlog in
-- the local profile), which grows with the backlog and would fail the phase
-- closed against D1_ROWS_READ_PER_RUN exactly when work has accumulated. The
-- claim was that index's only reader, so it is replaced rather than joined by
-- a second one: every task write still maintains exactly one secondary index,
-- which keeps the Free rows_written envelope unchanged.
DROP INDEX idx_catalog_ingest_tasks_work;
CREATE INDEX idx_catalog_ingest_tasks_claim
  ON catalog_ingest_tasks (status, priority DESC, updatedAt, agentKey);
