// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { executeBrowserClosure } from "../src/data/erc8183/browser-closure-adapter";
import { ERC8183_MAINNET as pins } from "../src/mainnet/contracts";
const mock = vi.hoisted(() => ({ send: vi.fn(), call: vi.fn(), receipt: vi.fn(), tx: vi.fn(), job: vi.fn(), locks: vi.fn(), chain: vi.fn(), pins: vi.fn() }));
const wallet = pins.token;
const hash = `0x${"aa".repeat(32)}`;
vi.mock("../src/mainnet/implementation-pins", () => ({ mainnetImplementationPinsMatch: mock.pins }));
vi.mock("viem", async original => ({ ...await original<object>(), createPublicClient: () => ({ readContract: async ({ functionName }: { functionName: string }) => functionName === "getJob" ? mock.job() : functionName === "jobPolicy" ? pins.policy : functionName === "disputed" ? false : functionName === "disputeWindow" ? 100n : [1, "0x"], getChainId: mock.chain, call: mock.call, getBlock: async () => ({ timestamp: 200n }), waitForTransactionReceipt: mock.receipt, getTransaction: mock.tx }), createWalletClient: () => ({ getAddresses: async () => [wallet], sendTransaction: mock.send }) }));
vi.mock("@bnbagent/sdk/erc8183", async original => ({ ...await original<object>(),
  CommerceClient: class { getJob = mock.job; },
  RouterClient: class { jobPolicy = async () => pins.policy; },
  PolicyClient: class { disputeWindow = async () => 100n; disputed = async () => false; check = async () => [1, "0x"]; },
}));
const input = { provider: { request: vi.fn() }, wallet, jobId: "1", action: "settle" as const, mode: "send" as const };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal("navigator", { locks: { request: mock.locks } });
  mock.locks.mockImplementation((_key, _options, callback) => callback({}));
  mock.chain.mockResolvedValue(56); mock.pins.mockResolvedValue(true);
  mock.job.mockResolvedValue({ status: 2, client: wallet, evaluator: pins.router, submittedAt: 100n });
  mock.call.mockResolvedValue({});
  mock.send.mockImplementation(async (tx) => { mock.tx.mockResolvedValue({ from: wallet, to: tx.to, input: tx.data, value: 0n }); mock.job.mockResolvedValue({ status: 3 }); return hash; });
  mock.receipt.mockResolvedValue({ status: "success", transactionHash: hash });
});
afterEach(() => vi.unstubAllGlobals());
it("sends only the exact zero-value settlement and recovers without a second send", async () => {
  expect((await executeBrowserClosure(input)).state).toBe("confirmed");
  expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ to: pins.router, value: 0n }));
  expect((await executeBrowserClosure({ ...input, mode: "resume" })).state).toBe("confirmed");
  expect(mock.send).toHaveBeenCalledOnce();
});
it("blocks Testnet wallet and changed implementations before signing", async () => {
  mock.chain.mockResolvedValue(97);
  await expect(executeBrowserClosure(input)).rejects.toThrow(/network/);
  mock.chain.mockResolvedValue(56); mock.pins.mockResolvedValue(false);
  await expect(executeBrowserClosure(input)).rejects.toThrow(/Contract/);
  expect(mock.send).not.toHaveBeenCalled();
});
it("does not confirm a successful receipt for another calldata", async () => {
  await executeBrowserClosure(input);
  mock.tx.mockResolvedValue({ from: wallet, to: pins.router, input: "0x", value: 0n });
  await expect(executeBrowserClosure({ ...input, mode: "resume" })).rejects.toThrow(/does not belong/);
  expect(mock.send).toHaveBeenCalledOnce();
});
it("blocks concurrent tabs rather than queuing another send", async () => {
  mock.locks.mockImplementation((_key, _options, callback) => callback(null));
  await expect(executeBrowserClosure(input)).rejects.toThrow(/another tab/);
  expect(mock.send).not.toHaveBeenCalled();
});
it("leaves a timed-out receipt uncertain and prevents rebroadcast", async () => {
  mock.receipt.mockRejectedValue(new Error("timeout"));
  expect((await executeBrowserClosure(input)).state).toBe("uncertain");
  await expect(executeBrowserClosure(input)).rejects.toThrow(/already exists/);
  expect(mock.send).toHaveBeenCalledOnce();
});
it("recovers a wrapped wallet rejection while retaining the previous attempt", async () => {
  mock.send.mockRejectedValueOnce(new Error("Wallet wrapper", { cause: { code: 4001 } }));
  expect((await executeBrowserClosure(input)).state).toBe("rejected");
  const retry = await executeBrowserClosure(input);
  expect(retry.state).toBe("confirmed");
  expect(retry.previousAttempts).toEqual([expect.objectContaining({ state: "rejected" })]);
  expect(mock.send).toHaveBeenCalledTimes(2);
});
it("does not confirm or rebroadcast a replaced transaction", async () => {
  mock.receipt.mockResolvedValue({ status: "success", transactionHash: `0x${"bb".repeat(32)}` });
  expect((await executeBrowserClosure(input)).state).toBe("uncertain");
  await expect(executeBrowserClosure(input)).rejects.toThrow(/already exists/);
  expect(mock.send).toHaveBeenCalledOnce();
});
