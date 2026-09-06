import { expect, it, vi } from "vitest";
import { TESTNET_CLOSURE_PINS as pins, testnetClosurePinsMatch } from "../src/data/erc8183/testnet-closure-pins";
import { ERC8183_MAINNET } from "../src/mainnet/contracts";

it("checks both Testnet implementations at the same block, never Mainnet addresses", async () => {
  const getStorageAt = vi.fn(async ({ address }: { address: string }) => `0x${"0".repeat(24)}${(address === pins.commerce ? pins.commerceImplementation : pins.routerImplementation).slice(2)}` as `0x${string}`);
  expect(await testnetClosurePinsMatch({ getBlockNumber: async () => 123n, getStorageAt })).toBe(true);
  expect(getStorageAt).toHaveBeenCalledTimes(2);
  expect(getStorageAt.mock.calls.every(([args]) => args.address !== ERC8183_MAINNET.commerce && args.address !== ERC8183_MAINNET.router)).toBe(true);
  expect(getStorageAt).toHaveBeenCalledWith(expect.objectContaining({ address: pins.commerce, blockNumber: 123n }));
  expect(getStorageAt).toHaveBeenCalledWith(expect.objectContaining({ address: pins.router, blockNumber: 123n }));
});

it("fails closed when a Testnet implementation is changed or missing", async () => {
  expect(await testnetClosurePinsMatch({ getBlockNumber: async () => 123n, getStorageAt: async () => undefined })).toBe(false);
  expect(await testnetClosurePinsMatch({ getBlockNumber: async () => 123n, getStorageAt: async () => `0x${"0".repeat(24)}${ERC8183_MAINNET.commerceImplementation.slice(2)}` })).toBe(false);
});
