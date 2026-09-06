import { getAddress } from "viem";
import { ERC8183_TESTNET } from "./contracts.ts";
import { implementationPinsMatch } from "../../mainnet/implementation-pins.ts";

// Observed on chain 97 at block 129514337 (2026-09-06).
// These freeze the observed deployment, not a security audit or rollout approval.
export const TESTNET_CLOSURE_PINS = Object.freeze({
  ...ERC8183_TESTNET,
  commerceImplementation: getAddress("0x153783ddbdf5233c591965f04644b1df2d1a7815"),
  routerImplementation: getAddress("0x40c0254610d92f1eb9c2d7d5d2114bc4c99d935e"),
});

export function testnetClosurePinsMatch(client: Parameters<typeof implementationPinsMatch>[0]) {
  return implementationPinsMatch(client, TESTNET_CLOSURE_PINS);
}
