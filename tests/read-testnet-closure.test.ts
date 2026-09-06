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
it.each(["0", "-1", "514x", "1.5", "", "100000000000000000000"])("rejects malformed ID %s before RPC", async id => {
  await expect(readTestnetClosure(id)).rejects.toThrow("Invalid job ID");
  expect(mock.chain).not.toHaveBeenCalled();
  expect(mock.read).not.toHaveBeenCalled();
});
it("rejects the correct job with an unsupported evaluator", async () => {
  mock.read.mockResolvedValueOnce({ id: 514n, client: pins.seller, evaluator: pins.seller, status: 2, submittedAt: 100n });
  await expect(readTestnetClosure("514")).rejects.toThrow("Unsupported");
});
it("rejects the correct job with an unbound policy", async () => {
  const implementation = mock.read.getMockImplementation()!;
  mock.read.mockImplementation(async args => args.functionName === "jobPolicy"
    ? "0x0000000000000000000000000000000000000000" : implementation(args));
  await expect(readTestnetClosure("514")).rejects.toThrow("Unsupported");
});
it("does not return actionable state when a policy read fails", async () => {
  const implementation = mock.read.getMockImplementation()!;
  mock.read.mockImplementation(async args => {
    if (args.functionName === "disputed") throw new Error("RPC unavailable");
    return implementation(args);
  });
  await expect(readTestnetClosure("514")).rejects.toThrow("RPC unavailable");
});
