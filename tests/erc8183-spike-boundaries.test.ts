import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Gate 6A browser/server boundaries", () => {
  it("keeps the Node-oriented BNB Agent SDK out of client modules", () => {
    for (const file of [
      "components/spikes/erc8183-browser-spike.tsx",
      "src/data/erc8183/browser-wallet-adapter.ts",
      "src/data/erc8183/receipt-parser.ts",
      "src/data/erc8183/contracts.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/from ["']@bnbagent\/sdk/);
    }
  });

  it("does not expose seller configuration as NEXT_PUBLIC variables", () => {
    const envExample = readFileSync(".env.example", "utf8");
    expect(envExample).toContain("ERC8183_BROWSER_SPIKE_SELLER_ORIGIN");
    expect(envExample).not.toContain("NEXT_PUBLIC_ERC8183_BROWSER_SPIKE");
  });
});
