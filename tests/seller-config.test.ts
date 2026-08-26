import { describe, expect, it } from "vitest";
import {
  loadSellerConfig,
  parseSellerCommand,
} from "../src/seller-config.ts";

const baseEnv = {
  NETWORK: "bsc-testnet",
  SELLER_ADDRESS: "0x0000000000000000000000000000000000000001",
  SELLER_WALLET_PASSWORD: "<redacted-test-value>",
  A2A_BASE_URL: "https://fixture.example",
};

describe("seller fixture configuration", () => {
  it("accepts only the three fixture commands", () => {
    expect(parseSellerCommand(["serve"])).toBe("serve");
    expect(parseSellerCommand(["register"])).toBe("register");
    expect(parseSellerCommand(["update"])).toBe("update");
    expect(() => parseSellerCommand(["start"])).toThrow(/serve, register, or update/);
  });

  it("defaults to one raw payment-token unit", () => {
    const config = loadSellerConfig(baseEnv, "serve");
    expect(config.servicePrice).toBe(1n);
    expect(config.port).toBe(8010);
    expect(config.baseUrl).toBe("https://fixture.example");
  });

  it("rejects raw keys, mainnet, and contract overrides", () => {
    expect(() =>
      loadSellerConfig({ ...baseEnv, PRIVATE_KEY: "<redacted>" }, "serve"),
    ).toThrow(/private-key/);
    expect(() =>
      loadSellerConfig({ ...baseEnv, NETWORK: "bsc-mainnet" }, "serve"),
    ).toThrow(/locked/);
    expect(() =>
      loadSellerConfig(
        { ...baseEnv, ERC8183_COMMERCE_ADDRESS: "0x1" },
        "serve",
      ),
    ).toThrow(/contract overrides/);
  });

  it("requires a public HTTPS origin", () => {
    expect(() =>
      loadSellerConfig(
        { ...baseEnv, A2A_BASE_URL: "http://localhost:8010" },
        "serve",
      ),
    ).toThrow(/public HTTPS/);
    expect(() =>
      loadSellerConfig(
        { ...baseEnv, A2A_BASE_URL: "https://fixture.example/path" },
        "serve",
      ),
    ).toThrow(/without a path/);
  });
});
