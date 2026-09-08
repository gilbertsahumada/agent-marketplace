import { describe, expect, it } from "vitest";
import { MARKETPLACE_INVENTORY, marketplaceInventoryEntries } from "../src/data/inventory/marketplace-inventory.ts";

describe("marketplace inventory with operated sellers", () => {
  it("adds every configured marketplace-operated seller under its own category", () => {
    const entries = marketplaceInventoryEntries({
      ERC8183_MAINNET_SELLER_AGENT_ID: "303779",
      ERC8183_MAINNET_SELLER_REBALANCE_AGENT_ID: "400001",
      ERC8183_MAINNET_SELLER_YIELD_AGENT_ID: "400002",
      ERC8183_MAINNET_SELLER_HEALTH_AGENT_ID: "400003",
    });
    const operated = entries.filter(({ operator }) => operator === "marketplace");
    expect(operated.map(({ agentId }) => agentId)).toEqual(["303779", "400001", "400002", "400003"]);
    expect(operated.map(({ categories }) => categories.map(({ category }) => category))).toEqual([
      ["grid_trading"],
      ["rebalancing"],
      ["yield_optimisation"],
      ["health_factor_monitoring"],
    ]);
    for (const entry of operated) {
      expect(entry.categories[0]!.provenance).toBe("derived:marketplace-inventory");
      expect(entry.categories[0]!.verificationStatus).toBe("candidate_unverified");
      expect(entry.categories[0]!.signal).not.toMatch(/proven|track record|guarantee|applied/i);
    }
    expect(entries.slice(0, MARKETPLACE_INVENTORY.entries.length)).toEqual([...MARKETPLACE_INVENTORY.entries]);
  });

  it("leaves the curated third-party entries alone when no seller is configured or an ID repeats", () => {
    expect(marketplaceInventoryEntries({})).toEqual([...MARKETPLACE_INVENTORY.entries]);
    const duplicated = marketplaceInventoryEntries({ ERC8183_MAINNET_SELLER_YIELD_AGENT_ID: "45422" });
    expect(duplicated).toEqual([...MARKETPLACE_INVENTORY.entries]);
    const twice = marketplaceInventoryEntries({ ERC8183_MAINNET_SELLER_AGENT_ID: "9001", ERC8183_MAINNET_SELLER_YIELD_AGENT_ID: "9001" });
    expect(twice.filter(({ agentId }) => agentId === "9001")).toHaveLength(1);
  });
});
