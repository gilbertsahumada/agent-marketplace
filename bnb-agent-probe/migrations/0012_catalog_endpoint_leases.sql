ALTER TABLE catalog_endpoints ADD COLUMN leaseOwner TEXT;
ALTER TABLE catalog_endpoints ADD COLUMN leaseExpiresAt INTEGER;

CREATE INDEX idx_catalog_endpoints_lease
  ON catalog_endpoints (role, eligibility, nextProbeAt, leaseExpiresAt, endpointKey);
