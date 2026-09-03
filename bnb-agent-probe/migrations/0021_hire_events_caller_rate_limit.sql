-- Telemetry hire events (provenance marketplace_observed) are the only rows a
-- browser can add without an RPC-verified receipt. Chain phases are keyed by
-- transaction and verified, so they self-limit; telemetry needs a per-caller
-- daily ceiling. The marketplace forwards an HMAC fingerprint of the request
-- context (never the IP or origin itself), the same way catalog validation
-- requests do since 0017. Existing rows keep the 'anonymous' key.
ALTER TABLE hire_events ADD COLUMN callerKey TEXT NOT NULL DEFAULT 'anonymous'
  CHECK (length(callerKey) BETWEEN 1 AND 128);

CREATE INDEX idx_hire_events_caller
  ON hire_events (callerKey, provenance, occurredAt DESC);
