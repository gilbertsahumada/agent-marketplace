import { describe, expect, it } from "vitest";
import { PAYMENT_TOKENS, paymentTokenMetadata } from "../src/business/entities/payment-token";

describe("payment token catalog", () => {
  it("resolves every supported Mainnet token by address without trusting casing", () => {
    expect(PAYMENT_TOKENS.filter((token) => token.chainId === 56).map((token) => token.symbol))
      .toEqual(["U", "USDC", "USDT", "USD1"]);
    for (const token of PAYMENT_TOKENS) {
      expect(paymentTokenMetadata(token.chainId, token.address.toLowerCase())).toBe(token);
      expect(token.logoUrl).toContain("assets-cdn.trustwallet.com/blockchains/smartchain/assets/");
    }
  });

  it("does not assign a trusted brand to an unknown or malformed address", () => {
    expect(paymentTokenMetadata(56, "0x1111111111111111111111111111111111111111")).toBeNull();
    expect(paymentTokenMetadata(56, "USDC")).toBeNull();
  });
});
