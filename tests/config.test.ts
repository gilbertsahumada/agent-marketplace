import { describe, expect, it } from "vitest";
import {
  assertSafeEnvironment,
  loadConfig,
  loadReceiptConfig,
  parseArgs,
} from "../src/config.js";

describe("Gate 1 configuration guards", () => {
  it("accepts only bsc-testnet", () => {
    expect(() =>
      assertSafeEnvironment({ NETWORK: "bsc-mainnet" }),
    ).toThrow(/locked to bsc-testnet/);
  });

  it("rejects raw private keys and contract overrides", () => {
    expect(() => assertSafeEnvironment({ PRIVATE_KEY: "hidden" })).toThrow(
      /Raw private-key variables/,
    );
    expect(() =>
      assertSafeEnvironment({ ERC8183_COMMERCE_ADDRESS: "0x1" }),
    ).toThrow(/contract overrides/);
  });

  it("loads public configuration", () => {
    const config = loadConfig(
      {
        NETWORK: "bsc-testnet",
        AGENT_ID: "42",
        BUYER_ADDRESS: "0x0000000000000000000000000000000000000001",
        BUYER_WALLET_PASSWORD: "<redacted-test-value>",
        BUYER_WALLETS_DIR: ".gate1/test-wallets",
      },
    );
    expect(config.agentId).toBe(42);
    expect(config.buyerAddress).toBe(
      "0x0000000000000000000000000000000000000001",
    );
    expect(config.buyerWalletPassword).toBe("<redacted-test-value>");
    expect(config.buyerWalletsDir).toBe(".gate1/test-wallets");
  });

  it("loads resume configuration without an agent ID", () => {
    expect(loadReceiptConfig({ NETWORK: "bsc-testnet" })).toEqual({
      receiptDir: ".gate1/receipts",
    });
  });
});

describe("CLI argument parsing", () => {
  it("parses an executable run", () => {
    expect(parseArgs(["run", "--agent-id", "7", "--execute"])).toEqual({
      command: "run",
      agentId: "7",
      jobId: undefined,
      execute: true,
    });
  });

  it("keeps resume read-only", () => {
    expect(() =>
      parseArgs(["resume", "--job-id", "7", "--execute"]),
    ).toThrow(/read-only/);
  });
});
