import { describe, expect, it } from "vitest";
import { createEvmBuyerWallet } from "../src/buyer-wallet.ts";

const buyerAddress = "0x0000000000000000000000000000000000000001";

describe("buyer wallet factory", () => {
  it("requires the encrypted-keystore password", () => {
    expect(() =>
      createEvmBuyerWallet({ address: buyerAddress, password: null }),
    ).toThrow(/BUYER_WALLET_PASSWORD/);
  });

  it("refuses to create a missing buyer wallet", () => {
    expect(() =>
      createEvmBuyerWallet({
        address: buyerAddress,
        password: "<redacted-test-value>",
        walletsDir: ".gate1/nonexistent-test-wallets",
      }),
    ).toThrow(/No existing encrypted buyer keystore/);
  });
});
