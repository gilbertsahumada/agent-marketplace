import { beforeEach, expect, it, vi } from "vitest";
import { encodeFunctionData, encodeEventTopics } from "viem";
import { ERC8183_MAINNET as pins, mainnetCommerceEvidenceAbi as abi } from "../src/mainnet/contracts";
import { readJobDelivery } from "../src/mainnet/read-job-delivery";
import type { HireJobDetail } from "../src/business/entities/hire-job";
const mocks = vi.hoisted(() => ({ getJob: vi.fn(), getReceipt: vi.fn(), getTx: vi.fn(), transport: vi.fn(), fetch: vi.fn(), close: vi.fn(), pins: vi.fn() }));
vi.mock("../src/mainnet/implementation-pins", () => ({ mainnetImplementationPinsMatch: mocks.pins }));
vi.mock("../src/verification/safe-http", () => ({ createSafeEndpointTransport: mocks.transport }));
vi.mock("viem", async original => ({ ...await original<object>(), createPublicClient: () => ({
  getChainId: async () => 56, getBlock: async () => ({ timestamp: 200n }), getTransaction: mocks.getTx, getTransactionReceipt: mocks.getReceipt,
}) }));
vi.mock("@bnbagent/sdk/erc8183", async original => ({
  ...await original<object>(),
  CommerceClient: class { getJob = mocks.getJob; },
  RouterClient: class { jobPolicy = async () => pins.policy; },
  PolicyClient: class { disputeWindow = async () => 100n; disputed = async () => false; check = async () => [0, "0x"]; },
}));
const hash = `0x${"11".repeat(32)}` as const;
const txHash = `0x${"22".repeat(32)}` as const;
const ledger = { chainId: 56, jobId: "1", buyer: pins.token, provider: pins.registry, status: "SUBMITTED", events: [{ eventName: "JobSubmitted", txHash, deliverable: hash }] } as unknown as HireJobDetail;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pins.mockResolvedValue(true);
  mocks.getJob.mockResolvedValue({ status: 2, client: ledger.buyer, provider: ledger.provider, evaluator: pins.router, submittedAt: 150n, deliverable: hash });
  mocks.getReceipt.mockResolvedValue({ status: "success", logs: [{ address: pins.commerce, topics: encodeEventTopics({ abi, eventName: "JobSubmitted", args: { jobId: 1n, provider: pins.registry } }), data: hash }] });
  mocks.getTx.mockResolvedValue({ to: pins.commerce, input: encodeFunctionData({ abi, functionName: "submit", args: [1n, hash, `0x${Buffer.from(JSON.stringify({ deliverable_url: "https://seller.example/result" })).toString("hex")}`] }) });
  mocks.transport.mockResolvedValue({ url: new URL("https://seller.example/result"), fetch: mocks.fetch, close: mocks.close });
  mocks.fetch.mockImplementation(async () => Response.json({ version: 1, job_id: 1, response: { content: "legacy" } }));
});
it("retrieves only the URL anchored by the matching successful submission", async () => {
  const report = await readJobDelivery(ledger);
  expect(report.delivery).toMatchObject({ status: "unsupported", content: "legacy" });
  expect(report.closure).toBe("review_window");
  expect(mocks.transport).toHaveBeenCalledWith("https://seller.example/result", { timeoutMs: 8000, maxResponseBytes: 65536 });
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("does not fetch any URL for a reverted submission", async () => {
  mocks.getReceipt.mockResolvedValue({ status: "reverted", logs: [] });
  expect((await readJobDelivery(ledger)).delivery.status).toBe("unavailable");
  expect(mocks.transport).not.toHaveBeenCalled();
});
it("does not trust a transaction without the matching Commerce event", async () => {
  mocks.getReceipt.mockResolvedValue({ status: "success", logs: [] });
  await readJobDelivery(ledger);
  expect(mocks.transport).not.toHaveBeenCalled();
});
it("rejects changed implementation pins", async () => {
  mocks.pins.mockResolvedValue(false);
  await readJobDelivery(ledger);
  expect(mocks.transport).not.toHaveBeenCalled();
});
it("keeps the review window when the delivery transport blocks an unsafe URL", async () => {
  mocks.transport.mockRejectedValue(new Error("Private IP blocked"));
  const report = await readJobDelivery(ledger);
  expect(report.closure).toBe("review_window");
  expect(report.delivery).toEqual({ status: "unavailable", content: null, url: null });
});
