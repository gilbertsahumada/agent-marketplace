-- Preserve existing admissions while allowing isolated Testnet candidates.
CREATE TABLE catalog_agent_admission_network (
  agentKey TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('candidate', 'admitted', 'suspended')),
  commerceTransport TEXT CHECK (commerceTransport IS NULL OR commerceTransport IN ('a2a', 'erc8183_http')),
  endpointKey TEXT,
  chainId INTEGER NOT NULL DEFAULT 56 CHECK (chainId IN (56, 97)),
  provider TEXT,
  validatedAt INTEGER,
  configurationVersion TEXT,
  reasonCode TEXT
);
INSERT INTO catalog_agent_admission_network SELECT * FROM catalog_agent_admission;
DROP TABLE catalog_agent_admission;
ALTER TABLE catalog_agent_admission_network RENAME TO catalog_agent_admission;
CREATE INDEX idx_catalog_agent_admission_state ON catalog_agent_admission(state, agentKey, endpointKey);
