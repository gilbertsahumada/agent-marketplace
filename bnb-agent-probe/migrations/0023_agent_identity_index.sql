-- Additive, partial reverse-wallet index. Latest successful snapshot, not history.
CREATE TABLE agent_identities (
  chainId INTEGER NOT NULL CHECK (chainId IN (56, 97)),
  registryAddress TEXT NOT NULL,
  agentId TEXT NOT NULL,
  wallet TEXT,
  source TEXT CHECK (source IN ('agentWallet', 'ownerOf')),
  blockNumber INTEGER NOT NULL,
  observedAt INTEGER NOT NULL,
  nextCheckAt INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chainId, registryAddress, agentId)
);
CREATE INDEX idx_agent_identities_wallet ON agent_identities(chainId, registryAddress, wallet);
CREATE INDEX idx_agent_identities_refresh ON agent_identities(chainId, registryAddress, nextCheckAt);
