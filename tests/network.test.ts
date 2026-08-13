import { describe, expect, it } from "vitest";
import { ACTIVE_TESTNET_POLICY, GATE1_NETWORK } from "../src/network.js";

describe("Gate 1 network", () => {
  it("pins the active BSC Testnet policy without changing the canonical stack", () => {
    expect(GATE1_NETWORK.chainId).toBe(97);
    expect(GATE1_NETWORK.commerceContract.toLowerCase()).toBe(
      "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
    );
    expect(GATE1_NETWORK.routerContract.toLowerCase()).toBe(
      "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
    );
    expect(GATE1_NETWORK.policyContract).toBe(ACTIVE_TESTNET_POLICY);
  });
});
