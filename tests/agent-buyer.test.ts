import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertQuoteWithinDemoCeiling } from "../src/demo/agent-buyer-cli.ts";

const NOW = 1_788_000_000_000;

function quote(overrides: Partial<Parameters<typeof assertQuoteWithinDemoCeiling>[0]> = {}) {
  return {
    envelope: {},
    chainId: 97,
    priceRaw: "1",
    quoteExpiresAt: Math.floor(NOW / 1_000) + 600,
    tokenSymbol: "U",
    ...overrides,
  };
}

describe("agent buyer demo", () => {
  it("accepts a quote inside the demo ceiling", () => {
    expect(() => assertQuoteWithinDemoCeiling(quote(), NOW)).not.toThrow();
  });

  it("refuses to sign outside BSC Testnet", () => {
    expect(() => assertQuoteWithinDemoCeiling(quote({ chainId: 56 }), NOW)).toThrow("Testnet");
  });

  it("enforces the spend ceiling before any signature", () => {
    expect(() => assertQuoteWithinDemoCeiling(quote({ priceRaw: "2" }), NOW)).toThrow("ceiling");
    expect(() => assertQuoteWithinDemoCeiling(quote({ priceRaw: "0" }), NOW)).toThrow("positive");
  });

  it("rejects an expired quote", () => {
    expect(() => assertQuoteWithinDemoCeiling(quote({ quoteExpiresAt: Math.floor(NOW / 1_000) - 1 }), NOW)).toThrow("expired");
  });

  it("keeps custody local and reuses the UI validation module", () => {
    const source = readFileSync("src/demo/agent-buyer-cli.ts", "utf8");
    expect(source).toMatch(/validateHirePlan/);
    expect(source).toMatch(/AGENT_BUYER_PRIVATE_KEY/);
    // The key only ever feeds the local account; it is never interpolated into a request body.
    expect(source).not.toMatch(/postJson\([^)]*PRIVATE_KEY/);
    expect(source).not.toMatch(/src\/(?:data\/observation|trust8004)|catalog-agents/);
  });
});
