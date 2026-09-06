import { beforeEach, expect, it, vi } from "vitest";
import { readTestnetClosure } from "../src/data/erc8183/read-testnet-closure";
import { TESTNET_CLOSURE_PINS as pins } from "../src/data/erc8183/testnet-closure-pins";
const mock = vi.hoisted(() => ({ chain: vi.fn(), pins: vi.fn(), read: vi.fn() }));
vi.mock("../src/mainnet/implementation-pins", () => ({ implementationPinsMatch: mock.pins }));
vi.mock("viem", async original => ({ ...await original<object>(), createPublicClient: () => ({ getChainId: mock.chain, getBlock: async () => ({ number: 123n, timestamp: 200n }), readContract: mock.read }) }));
beforeEach(() => {
  vi.clearAllMocks(); mock.chain.mockResolvedValue(97); mock.pins.mockResolvedValue(true);
  mock.read.mockImplementation(async ({ functionName }) => {
    if (functionName === "getJob") return { id: 514n, client: pins.seller, evaluator: pins.router, status: 2, submittedAt: 100n };
    if (functionName === "jobPolicy") return pins.policy;
    if (functionName === "disputeWindow") return 900n;
    if (functionName === "disputed") return true;
    return [2, "0x"];
  });
});
it("reads all facts at one block and prioritizes a resolved rejection", async () => {
  const report = await readTestnetClosure("514");
  expect(report).toMatchObject({ chainId: 97, closure: "settlement_available", settlementOutcome: "rejected", checkedBlock: "123" });
  expect(mock.read.mock.calls.every(([args]) => args.blockNumber === 123n)).toBe(true);
});
it("blocks wrong network and changed implementations before reading job state", async () => {
  mock.chain.mockResolvedValue(56);
  await expect(readTestnetClosure("514")).rejects.toThrow("Wrong network");
  expect(mock.read).not.toHaveBeenCalled();
  mock.chain.mockResolvedValue(97); mock.pins.mockResolvedValue(false);
  await expect(readTestnetClosure("514")).rejects.toThrow("Changed contracts");
});
it("rejects another job or unsupported evaluator", async () => {
  mock.read.mockResolvedValueOnce({ id: 515n, client: pins.seller, evaluator: pins.router, status: 2, submittedAt: 100n });
  await expect(readTestnetClosure("514")).rejects.toThrow("Unsupported");
});
