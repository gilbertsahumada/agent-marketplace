/** Testnet rollout uses its own small allowance; Mainnet keeps its existing batch. */
export function testnetCatalogEnabled(env: { CATALOG_TESTNET_ENABLED?: string; BSC_TESTNET_RPC_URL?: string }): boolean {
  if (env.CATALOG_TESTNET_ENABLED !== undefined && !["0", "1"].includes(env.CATALOG_TESTNET_ENABLED)) {
    throw new Error("CATALOG_TESTNET_ENABLED_INVALID");
  }
  if (env.CATALOG_TESTNET_ENABLED !== "1") return false;
  if (!env.BSC_TESTNET_RPC_URL?.trim()) throw new Error("TESTNET_RPC_REQUIRED");
  return true;
}

export const TESTNET_QUOTE_BATCH_SIZE = 1;
export const TESTNET_DISCOVERY_PAGE_SIZE = 10;
