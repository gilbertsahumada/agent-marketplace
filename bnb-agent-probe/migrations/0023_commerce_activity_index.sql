-- Per-day activity reads (GET /commerce-activity) group commerce_job_events
-- by block time for one chain; without this index they would scan every event
-- row on the chain for each window.
--
-- Rollback: DROP INDEX idx_commerce_job_events_time;
CREATE INDEX idx_commerce_job_events_time
  ON commerce_job_events (chainId, blockTimestamp);
