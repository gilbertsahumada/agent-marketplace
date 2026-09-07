import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { keccak256, toBytes } from "viem";
import { POST } from "../app/api/marketplace/agents/[agentId]/hire/notify/route";
import { resolveCatalogHireTarget } from "../src/mainnet/catalog-hire";
import { notificationStore } from "../src/mainnet/hire-notification-store";
import { processHireNotification } from "../src/mainnet/hire-notification-recovery";

const f = vi.hoisted(() => ({ job: {} as Record<string, unknown>, allowlist: {} as Record<string, unknown>, send: vi.fn() }));
vi.mock("../src/mainnet/catalog-hire", async original => ({ ...await original<object>(), resolveCatalogHireTarget: vi.fn() }));
vi.mock("../src/mainnet/hire-notification-store", () => ({ notificationStore: vi.fn() }));
vi.mock("../src/mainnet/hire-notification-recovery", () => ({ processHireNotification: vi.fn() }));
vi.mock("../src/mainnet/catalog-erc8183-repository", () => ({ CatalogErc8183Repository: class {
  allowlist = f.allowlist;
  getJob = async () => f.job;
  notifyFunded = f.send;
} }));
const buyer = `0x${"11".repeat(20)}`;
const seller = `0x${"22".repeat(20)}`;
const token = `0x${"33".repeat(20)}`;
const router = `0x${"44".repeat(20)}`;
const policy = `0x${"55".repeat(20)}`;
const content = { currency: token, price: "1", task: "Original task", version: 1 };
const hash = keccak256(toBytes(JSON.stringify(content)));
const invoke = () => POST(new Request("https://app.test/notify?chainId=97", { method: "POST", body: JSON.stringify({ quoteRequestId: 1, jobId: "1066", buyer }) }), { params: Promise.resolve({ agentId: "2197" }) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ERC8183_TESTNET_HIRE_ENABLED", "true");
  vi.stubEnv("HIRE_NOTIFICATION_RECOVERY_ENABLED", "1");
  f.allowlist = { chainId: 97, seller, router, policy, token, maximumBudgetRaw: 10n };
  f.job = { jobId: "1066", chainId: 97, buyer, provider: seller, evaluator: router, policy, budgetRaw: "1", quotedToken: token, quotedPriceRaw: "1", status: "FUNDED", deadline: String(Math.floor(Date.now()/1000)+3600), description: JSON.stringify({ ...content, negotiation_hash: hash }) };
  vi.mocked(resolveCatalogHireTarget).mockResolvedValue({ chainId: 97, agentId: 2197, provider: seller, endpoint: "https://seller.test", transport: "a2a", requestHash: hash, negotiationHash: hash } as never);
  f.send.mockResolvedValue({ acknowledged: true, alreadySubmitted: false, job: f.job });
  vi.mocked(processHireNotification).mockResolvedValue({ result: { acknowledged: true, alreadySubmitted: false, job: f.job } } as never);
  vi.mocked(notificationStore).mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
it("does not bypass an uncertain dispatch after recovery is switched off", async () => {
  vi.stubEnv("HIRE_NOTIFICATION_RECOVERY_ENABLED", "0");
  vi.mocked(notificationStore).mockResolvedValue({ state: "uncertain" });
  expect((await invoke()).status).toBe(503);
  expect(f.send).not.toHaveBeenCalled();
  expect(processHireNotification).not.toHaveBeenCalled();
});
it("fails closed if the dispatch record cannot be read during rollback", async () => {
  vi.stubEnv("HIRE_NOTIFICATION_RECOVERY_ENABLED", undefined);
  vi.mocked(notificationStore).mockRejectedValue(new Error("offline"));
  expect((await invoke()).status).toBeGreaterThanOrEqual(400);
  expect(f.send).not.toHaveBeenCalled();
});
it.each(["sending", "uncertain", "notified", "pending"])("preserves a %s record when the activation flag is removed", async state => {
  vi.stubEnv("HIRE_NOTIFICATION_RECOVERY_ENABLED", undefined);
  vi.mocked(notificationStore).mockResolvedValue({ state });
  expect((await invoke()).status).toBe(503);
  expect(f.send).not.toHaveBeenCalled();
});
it("permits legacy notification only after confirming there is no durable record", async () => {
  vi.stubEnv("HIRE_NOTIFICATION_RECOVERY_ENABLED", undefined);
  expect((await invoke()).status).toBe(200);
  expect(notificationStore).toHaveBeenCalledWith({ action: "read", chainId: 97, jobId: "1066" });
  expect(f.send).toHaveBeenCalledOnce();
});
it.each([null, undefined, "invalid"])("fails closed when verified negotiation hash is %s", async negotiationHash => {
  const target = await resolveCatalogHireTarget("2197", 1);
  vi.mocked(resolveCatalogHireTarget).mockResolvedValue({ ...target, negotiationHash } as never);
  expect((await invoke()).status).toBeGreaterThanOrEqual(400);
  expect(notificationStore).not.toHaveBeenCalled();
});
it("rejects a different quote before enqueue, then accepts the original quote", async () => {
  f.job.description = JSON.stringify({ ...content, negotiation_hash: `0x${"aa".repeat(32)}` });
  expect((await invoke()).status).toBeGreaterThanOrEqual(400);
  expect(notificationStore).not.toHaveBeenCalled();
  f.job.description = JSON.stringify({ ...content, negotiation_hash: hash });
  expect((await invoke()).status).toBe(200);
  expect(notificationStore).toHaveBeenCalledWith(expect.objectContaining({ action: "enqueue", quoteRequestId: 1 }));
});
it("rejects copied hashes on altered content before enqueue", async () => {
  f.job.description = JSON.stringify({ ...content, task: "Tampered", negotiation_hash: hash });
  expect((await invoke()).status).toBeGreaterThanOrEqual(400);
  expect(notificationStore).not.toHaveBeenCalled();
});
