-- Expand identity reads to BSC Testnet without fabricating catalogue rows.
-- No tables reference catalog_agents with foreign keys. Preserve every column.
CREATE TABLE catalog_agents_network (
  agentKey TEXT PRIMARY KEY,
  agentId TEXT NOT NULL,
  chainId INTEGER NOT NULL CHECK (chainId IN (56, 97)),
  name TEXT, description TEXT, imageUrl TEXT,
  categoriesJson TEXT NOT NULL DEFAULT '[]',
  marketplaceConfigured INTEGER NOT NULL DEFAULT 0 CHECK (marketplaceConfigured IN (0, 1)),
  metadataState TEXT NOT NULL CHECK (metadataState IN ('ok', 'http_unreachable', 'other')),
  indexState TEXT NOT NULL DEFAULT 'current' CHECK (indexState IN ('current', 'removed')),
  registeredAt INTEGER, blockNumber TEXT,
  firstSeenAt INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  metadataVersion TEXT, metadataObservedAt INTEGER,
  policyVersion INTEGER NOT NULL DEFAULT 2 CHECK (policyVersion >= 1),
  owner TEXT, metadataUri TEXT,
  UNIQUE (chainId, agentId)
);
INSERT INTO catalog_agents_network (
  agentKey, agentId, chainId, name, description, imageUrl, categoriesJson,
  marketplaceConfigured, metadataState, indexState, registeredAt, blockNumber,
  firstSeenAt, lastSeenAt, priority, metadataVersion, metadataObservedAt, policyVersion, owner, metadataUri
) SELECT agentKey, agentId, chainId, name, description, imageUrl, categoriesJson,
  marketplaceConfigured, metadataState, indexState, registeredAt, blockNumber,
  firstSeenAt, lastSeenAt, priority, metadataVersion, metadataObservedAt, policyVersion, owner, metadataUri
FROM catalog_agents;
DROP TABLE catalog_agents;
ALTER TABLE catalog_agents_network RENAME TO catalog_agents;
CREATE INDEX idx_catalog_agents_priority
  ON catalog_agents (indexState, priority DESC, registeredAt DESC, agentId);
