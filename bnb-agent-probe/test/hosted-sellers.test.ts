import { describe, expect, it } from "vitest";
import { CURATED_INVENTORY } from "../src/manifest/curated-inventory.ts";
import { HOSTED_SELLERS, HOSTED_SELLER_ORIGIN, expectedHostedSellerMessageUrl } from "../src/manifest/hosted-sellers.ts";

describe("hosted seller manifest", () => {
  it("lists the four marketplace-operated sellers on the fixed origin, one per category", () => {
    expect(HOSTED_SELLERS.map(({ slug }) => slug)).toEqual(["grid", "rebalance", "yield", "loan-health"]);
    expect(new Set(HOSTED_SELLERS.map(({ category }) => category)).size).toBe(4);
    for (const seller of HOSTED_SELLERS) {
      expect(seller.endpoint).toBe(`${HOSTED_SELLER_ORIGIN}/${seller.slug}`);
      expect(seller.messageUrl).toBe(`${HOSTED_SELLER_ORIGIN}/api/sellers/${seller.slug}/a2a`);
      if (seller.agentId !== null) expect(seller.agentId).toMatch(/^[1-9]\d*$/);
    }
  });

  it("pins the expected A2A message route only for a registered seller at its own endpoint", () => {
    expect(expectedHostedSellerMessageUrl(`${HOSTED_SELLER_ORIGIN}/grid`, "303779")).toBe(`${HOSTED_SELLER_ORIGIN}/api/sellers/grid/a2a`);
    expect(expectedHostedSellerMessageUrl(`${HOSTED_SELLER_ORIGIN}/grid`, "1")).toBeNull();
    expect(expectedHostedSellerMessageUrl("https://seller.example/grid", "303779")).toBeNull();
    // Unregistered sellers carry no Agent ID yet, so nothing is pinned for them.
    expect(expectedHostedSellerMessageUrl(`${HOSTED_SELLER_ORIGIN}/yield`, "0")).toBeNull();
  });

  it("agrees with the curated inventory on every registered seller", () => {
    for (const seller of HOSTED_SELLERS) {
      if (seller.agentId === null) continue;
      const entry = CURATED_INVENTORY.entries.find(({ agentId }) => agentId === seller.agentId);
      expect(entry?.operator).toBe("marketplace");
      expect(entry?.categories.map(({ category }) => category)).toEqual([seller.category]);
    }
  });
});
