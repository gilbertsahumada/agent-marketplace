import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { HostedSellerUnavailableError } from "../src/business/errors/hosted-seller-errors.ts";
import { loadMainnetGridSellerConfig } from "../src/mainnet/grid-seller-config.ts";
import { hostedSellerPrivateKeyEnvName, loadMainnetHostedSellerConfig } from "../src/mainnet/hosted-seller-config.ts";
import { configuredHostedSellerAgentIds, hostedSellerEnvNames } from "../src/shared/hosted-seller-env.ts";

const ORIGIN = "https://bnb-agent-marketplace-ruby.vercel.app";
const GRID_KEY = `0x${"11".repeat(32)}` as const;
const YIELD_KEY = `0x${"22".repeat(32)}` as const;

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    ERC8183_MAINNET_SELLER_ENABLED: "true",
    ERC8183_MAINNET_SELLER_ORIGIN: ORIGIN,
    MAINNET_SELLER_PRIVATE_KEY: GRID_KEY,
    ERC8183_MAINNET_SELLER_ADDRESS: privateKeyToAccount(GRID_KEY).address,
    ERC8183_MAINNET_SELLER_AGENT_ID: "303779",
    MAINNET_SELLER_YIELD_PRIVATE_KEY: YIELD_KEY,
    ERC8183_MAINNET_SELLER_YIELD_ADDRESS: privateKeyToAccount(YIELD_KEY).address,
    ERC8183_MAINNET_SELLER_YIELD_AGENT_ID: "400001",
    ...overrides,
  };
}

describe("hosted seller configuration", () => {
  it("keeps the Grid variable names and derives the others from the slug", () => {
    expect(hostedSellerEnvNames("grid")).toEqual({
      address: "ERC8183_MAINNET_SELLER_ADDRESS",
      agentId: "ERC8183_MAINNET_SELLER_AGENT_ID",
    });
    expect(hostedSellerEnvNames("loan-health")).toEqual({
      address: "ERC8183_MAINNET_SELLER_HEALTH_ADDRESS",
      agentId: "ERC8183_MAINNET_SELLER_HEALTH_AGENT_ID",
    });
    expect(hostedSellerPrivateKeyEnvName("grid")).toBe("MAINNET_SELLER_PRIVATE_KEY");
    expect(hostedSellerPrivateKeyEnvName("rebalance")).toBe("MAINNET_SELLER_REBALANCE_PRIVATE_KEY");
    expect(hostedSellerPrivateKeyEnvName("loan-health")).toBe("MAINNET_SELLER_HEALTH_PRIVATE_KEY");
  });

  it("loads each seller with its own signer, endpoint and Agent ID", () => {
    const grid = loadMainnetHostedSellerConfig("grid", env());
    const yieldSeller = loadMainnetHostedSellerConfig("yield", env());
    expect(grid).toMatchObject({ slug: "grid", endpoint: `${ORIGIN}/grid`, agentId: 303779 });
    expect(yieldSeller).toMatchObject({ slug: "yield", endpoint: `${ORIGIN}/yield`, agentId: 400001 });
    expect(grid.address).not.toBe(yieldSeller.address);
    expect(grid.privateKey).toBe(GRID_KEY);
    expect(yieldSeller.privateKey).toBe(YIELD_KEY);
    // Keys never enumerate, so JSON and spreads cannot leak them.
    expect(JSON.stringify(yieldSeller)).not.toContain("22222222");
    expect(Object.keys(yieldSeller)).not.toContain("privateKey");
  });

  it("keeps the Grid wrapper behaviour for its callers", () => {
    expect(loadMainnetGridSellerConfig(env())).toMatchObject({ endpoint: `${ORIGIN}/grid`, agentId: 303779 });
    expect(loadMainnetGridSellerConfig(env({ ERC8183_MAINNET_SELLER_AGENT_ID: undefined }), { requireAgentId: false }).agentId).toBeNull();
  });

  it("refuses a seller whose key, address or Agent ID is missing or mismatched, without touching the others", () => {
    expect(() => loadMainnetHostedSellerConfig("rebalance", env())).toThrow(HostedSellerUnavailableError);
    expect(() => loadMainnetHostedSellerConfig("rebalance", env())).toThrow(/rebalance seller signer/);
    expect(() => loadMainnetHostedSellerConfig("yield", env({ ERC8183_MAINNET_SELLER_YIELD_ADDRESS: privateKeyToAccount(GRID_KEY).address }))).toThrow(/does not match/);
    expect(() => loadMainnetHostedSellerConfig("yield", env({ ERC8183_MAINNET_SELLER_YIELD_AGENT_ID: "" }))).toThrow(/Agent ID/);
    expect(loadMainnetHostedSellerConfig("yield", env({ ERC8183_MAINNET_SELLER_YIELD_AGENT_ID: "" }), { requireAgentId: false }).agentId).toBeNull();
    expect(() => loadMainnetHostedSellerConfig("yield", env({ ERC8183_MAINNET_SELLER_ENABLED: "false" }))).toThrow(/disabled/);
    expect(() => loadMainnetHostedSellerConfig("yield", env({ ERC8183_MAINNET_SELLER_ORIGIN: "https://evil.example" }))).toThrow(/origin/);
    expect(loadMainnetHostedSellerConfig("grid", env())).toBeTruthy();
  });

  it("reports configured Agent IDs without reading keys", () => {
    expect(configuredHostedSellerAgentIds(env())).toEqual([
      { slug: "grid", agentId: "303779" },
      { slug: "yield", agentId: "400001" },
    ]);
    expect(configuredHostedSellerAgentIds({ ERC8183_MAINNET_SELLER_HEALTH_AGENT_ID: "007" })).toEqual([{ slug: "loan-health", agentId: "7" }]);
    expect(configuredHostedSellerAgentIds({ ERC8183_MAINNET_SELLER_HEALTH_AGENT_ID: "0" })).toEqual([]);
    expect(configuredHostedSellerAgentIds({})).toEqual([]);
  });
});
