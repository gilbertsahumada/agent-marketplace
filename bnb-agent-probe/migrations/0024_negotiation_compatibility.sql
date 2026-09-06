-- Existing quote observations do not prove that a usable form is published.
ALTER TABLE catalog_seller_capabilities ADD COLUMN compatibilityState TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE catalog_seller_capabilities ADD COLUMN schemaHash TEXT;
ALTER TABLE catalog_seller_capabilities ADD COLUMN compatibilityCheckedAt INTEGER;
ALTER TABLE catalog_seller_capabilities ADD COLUMN compatibilityExpiresAt INTEGER;
ALTER TABLE catalog_seller_capabilities ADD COLUMN compatibilityErrorCode TEXT;
-- Eligibility probes start from agentKey using the existing primary key.
-- Avoid another write-amplifying index on every discovery insert.
