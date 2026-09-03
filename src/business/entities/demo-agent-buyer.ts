// The wallet the P4 agent-buyer demo signs with on BSC Testnet. A single
// declared identity for every layer: the CLI's dry-run default, the docs
// samples, and the delegation label on the Testnet job page. `agentId` is the
// wallet's ERC-8004 registry entry on Testnet once it is registered; until
// then the buyer is labelled but never claimed as a verified agent identity.
export const DEMO_AGENT_BUYER = Object.freeze({
  chainId: 97,
  address: "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52",
  agentId: null as number | null,
} as const);
