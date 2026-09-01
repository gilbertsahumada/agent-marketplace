-- Keep distributed on-demand validation admission scoped to an opaque caller
-- fingerprint. The app sends an HMAC-derived key, so D1 never stores an IP,
-- origin or other caller identifier.
ALTER TABLE catalog_validation_requests
  ADD COLUMN callerKey TEXT NOT NULL DEFAULT 'anonymous'
  CHECK (length(callerKey) BETWEEN 1 AND 128);

CREATE INDEX idx_catalog_validation_requests_caller_target
  ON catalog_validation_requests (
    callerKey, agentKey, endpointKey, validationKind, createdAt DESC, id DESC
  );
