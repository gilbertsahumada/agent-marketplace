-- Provenance of input discovery, independent of signed quote evidence.
-- Legacy rows stay version 0; no ready state or timestamps are manufactured.
ALTER TABLE catalog_seller_capabilities ADD COLUMN detectorVersion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalog_seller_capabilities ADD COLUMN negotiationProfile TEXT;
ALTER TABLE catalog_seller_capabilities ADD COLUMN schemaSource TEXT;
