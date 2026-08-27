-- Marketplace seller observations.
--
-- Ownership rule from ADR-2026-08-27: trust8004 stores what is true for
-- everyone; the marketplace stores what is true only because the marketplace
-- observed it. Every row here is one probe this marketplace performed.
--
-- Onchain facts (jobs, budgets, transitions) do NOT belong in this table.
-- Hireability is derived when the observation is read; it is intentionally
-- not stored as a boolean.

CREATE TABLE IF NOT EXISTS seller_observations (
  agent_id         text        NOT NULL,
  observed_at      timestamptz NOT NULL,
  quote_status     text        NOT NULL,
  transport        text,
  endpoint         text,
  price_raw        text,
  currency         text,
  signature_method text,
  error_code       text,
  PRIMARY KEY (agent_id, observed_at)
);

-- Serves the hot read: the latest observation per agent.
CREATE INDEX IF NOT EXISTS seller_observations_latest
  ON seller_observations (agent_id, observed_at DESC);
