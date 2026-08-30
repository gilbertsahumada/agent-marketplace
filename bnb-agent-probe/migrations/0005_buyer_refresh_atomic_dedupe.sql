ALTER TABLE probe_observations
  ADD COLUMN source TEXT CHECK (source IS NULL OR source = 'buyer_refresh');

CREATE UNIQUE INDEX idx_obs_buyer_refresh_negotiation
  ON probe_observations (chainId, agentId, negotiationHash)
  WHERE source = 'buyer_refresh' AND negotiationHash IS NOT NULL;
