-- The catalogue list filters (fresh protocol, latest failure, verified quote,
-- browser success) are correlated EXISTS subqueries over catalog_observations
-- keyed by the agent. Without an index that starts with agentKey and carries
-- the outcome/verificationLevel/protocol equalities, SQLite picked
-- idx_catalog_observations_outcome and scanned every protocol_valid row once
-- per agent: 51M rows read for one filtered list at 4,000 agents, which is what
-- exhausted the D1 Free daily read quota. This index makes those subqueries
-- O(observations of that agent).
CREATE INDEX idx_catalog_observations_agent_evidence
  ON catalog_observations (agentKey, outcome, verificationLevel, protocol, observedAt DESC, id DESC);
