import { describe, expect, it } from "vitest";
import { catalogScopedHref } from "../components/marketplace/catalog-navigation";
import { compatibilityMessage } from "../src/shared/compatibility-message";

describe("explicit inventory scope", () => {
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
