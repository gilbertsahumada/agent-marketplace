import { describe, expect, it } from "vitest";
import { catalogScopedHref } from "../components/marketplace/catalog-navigation";
import { compatibilityMessage } from "../src/shared/compatibility-message";
import { catalogNetworkHref } from "../components/marketplace/catalog-network-tabs";

describe("explicit inventory scope", () => {
  it("resets pagination on a network switch without dropping repeated filters", () => {
    const url = new URL(catalogNetworkHref("/agents?scope=evaluation&status=failed&status=pending&protocol=mcp&q=agent&page=3&cursor=old", "testnet"), "https://example.test");
    expect(url.searchParams.getAll("status")).toEqual(["failed", "pending"]);
    expect(url.searchParams.get("network")).toBe("testnet");
    expect(url.searchParams.get("scope")).toBe("evaluation");
    expect(url.searchParams.get("protocol")).toBe("mcp");
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.has("cursor")).toBe(false);
  });
  it("preserves the selected network across filtering without overriding an explicit switch", () => {
    expect(catalogScopedHref("/agents?protocol=mcp", "evaluation", "testnet")).toContain("network=testnet");
    expect(catalogScopedHref("/agents?network=mainnet", "hiring", "testnet")).toContain("network=mainnet");
    expect(catalogScopedHref("/agents?view=all", undefined, "testnet")).toContain("network=testnet");
    expect(catalogScopedHref("/jobs", undefined, "testnet")).toBe("/jobs");
  });
  it("keeps evaluation scope when filtering, searching and clearing filters", () => {
    for (const href of ["/agents?view=marketplace", "/agents?protocol=mcp&q=search", "/agents?page=2"]) {
      expect(catalogScopedHref(href, "evaluation")).toContain("scope=evaluation");
    }
  });
  it("allows explicit scope switches and leaves registry browsing alone", () => {
    expect(catalogScopedHref("/agents?scope=hiring", "evaluation")).toBe("/agents?scope=hiring");
    expect(catalogScopedHref("/agents?view=all", "hiring")).toBe("/agents?view=all");
  });
  it("distinguishes provider access denial from missing integration", () => {
    expect(compatibilityMessage("SELLER_ACCESS_DENIED").title).toBe("Requirements blocked by provider");
    expect(compatibilityMessage("A2A_REQUIRED_SKILLS").title).toBe("Integration required");
    expect(compatibilityMessage("SELLER_RATE_LIMITED").title).toBe("Provider rate limit");
  });
});
