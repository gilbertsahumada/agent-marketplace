import { describe, expect, it } from "vitest";
import { testnetCatalogEnabled } from "../src/catalog/testnet-policy";

describe("Testnet catalog rollout", () => {
  it("requires explicit rollout, not merely an RPC used by job indexing", () => {
    expect(testnetCatalogEnabled({ BSC_TESTNET_RPC_URL: "https://rpc.example" })).toBe(false);
    expect(testnetCatalogEnabled({ CATALOG_TESTNET_ENABLED: "0" })).toBe(false);
    expect(testnetCatalogEnabled({ CATALOG_TESTNET_ENABLED: "1", BSC_TESTNET_RPC_URL: "https://rpc.example" })).toBe(true);
  });
  it("rejects invalid configuration before attempting discovery", () => {
    expect(() => testnetCatalogEnabled({ CATALOG_TESTNET_ENABLED: "true" })).toThrow("CATALOG_TESTNET_ENABLED_INVALID");
    expect(() => testnetCatalogEnabled({ CATALOG_TESTNET_ENABLED: "1" })).toThrow("TESTNET_RPC_REQUIRED");
  });
});
