import { beforeEach, describe, expect, it, vi } from "vitest";
import { HIRE_ACTIVITY_CACHE_SECONDS } from "../src/business/entities/hire-job.ts";
import { MarketplaceDataUnavailableError } from "../src/business/errors/marketplace-errors.ts";

const ledger = vi.hoisted(() => ({
  listRecentJobs: vi.fn(),
  listJobsByBuyer: vi.fn(),
  listJobsByProvider: vi.fn(),
  listJobsByAgent: vi.fn(),
  getJob: vi.fn(),
  summary: vi.fn(),
  activity: vi.fn(),
}));

vi.mock("@/src/business/composition", () => ({ getHireLedger: ledger }));

const jobs = await import("../app/api/marketplace/jobs/route.ts");
const summary = await import("../app/api/marketplace/jobs/summary/route.ts");
const activity = await import("../app/api/marketplace/jobs/activity/route.ts");
const mainnetLedger = await import("../app/api/marketplace/jobs/mainnet/[jobId]/ledger/route.ts");
const testnetLedger = await import("../app/api/marketplace/jobs/testnet/[jobId]/ledger/route.ts");

const BUYER = "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52";
const PAGE = { chainId: 56, jobs: [], nextBefore: null };

describe("hire ledger controllers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes each identity filter to its reader and passes the cursor through", async () => {
    ledger.listRecentJobs.mockResolvedValue(PAGE);
    ledger.listJobsByBuyer.mockResolvedValue(PAGE);
    ledger.listJobsByProvider.mockResolvedValue(PAGE);
    ledger.listJobsByAgent.mockResolvedValue(PAGE);

    const recent = await jobs.GET(new Request("http://local/api/marketplace/jobs?chainId=56"));
    expect(recent.status).toBe(200);
    expect(recent.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=60");
    expect(await recent.json()).toEqual(PAGE);
    expect(ledger.listRecentJobs).toHaveBeenCalledWith({ chainId: 56 });

    await jobs.GET(new Request(`http://local/api/marketplace/jobs?chainId=97&buyer=${BUYER}&before=100`));
    expect(ledger.listJobsByBuyer).toHaveBeenCalledWith({ chainId: 97, buyer: BUYER, before: "100" });
    await jobs.GET(new Request(`http://local/api/marketplace/jobs?chainId=56&provider=${BUYER}`));
    expect(ledger.listJobsByProvider).toHaveBeenCalledWith({ chainId: 56, provider: BUYER });
    // A wrongly cased (invalid EIP-55) address is still 0x + 40 hex: the route
    // accepts it and the data layer normalises it, never a 503 for a bad case.
    const badChecksum = "0x5EE75A1b1648c023E885e58Bd3735aE273F2CC52";
    const mixed = await jobs.GET(new Request(`http://local/api/marketplace/jobs?chainId=56&provider=${badChecksum}`));
    expect(mixed.status).toBe(200);
    expect(ledger.listJobsByProvider).toHaveBeenLastCalledWith({ chainId: 56, provider: badChecksum });
    await jobs.GET(new Request("http://local/api/marketplace/jobs?chainId=56&agentId=303779"));
    expect(ledger.listJobsByAgent).toHaveBeenCalledWith({ chainId: 56, agentId: "303779" });
  });

  it.each([
    "chainId=1",
    "",
    `chainId=56&buyer=${BUYER}&agentId=303779`,
    "chainId=56&buyer=0x12",
    "chainId=56&agentId=0",
    "chainId=56&before=x",
    "chainId=56&chainId=97",
    "chainId=56&unknown=1",
  ])("rejects ?%s with 400 before reading the ledger", async (query) => {
    const response = await jobs.GET(new Request(`http://local/api/marketplace/jobs?${query}`));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("InvalidMarketplaceInputError");
    for (const reader of [ledger.listRecentJobs, ledger.listJobsByBuyer, ledger.listJobsByProvider, ledger.listJobsByAgent, ledger.summary, ledger.activity]) {
      expect(reader).not.toHaveBeenCalled();
    }
  });

  it("answers 503 when the ledger is unavailable", async () => {
    ledger.listRecentJobs.mockResolvedValue(null);
    ledger.summary.mockResolvedValue(null);
    expect((await jobs.GET(new Request("http://local/api/marketplace/jobs?chainId=56"))).status).toBe(503);
    expect((await summary.GET(new Request("http://local/api/marketplace/jobs/summary?chainId=56"))).status).toBe(503);
  });

  it("serves the summary for one chain only", async () => {
    ledger.summary.mockResolvedValue({ chainId: 97, protocol: { jobs: 3 } });
    const response = await summary.GET(new Request("http://local/api/marketplace/jobs/summary?chainId=97"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ chainId: 97 });
    expect(ledger.summary).toHaveBeenCalledWith({ chainId: 97 });
    expect((await summary.GET(new Request("http://local/api/marketplace/jobs/summary?chainId=97&x=1"))).status).toBe(400);
  });

  it("serves one job's ledger per network and 404s when it is not indexed", async () => {
    ledger.getJob.mockResolvedValueOnce({ chainId: 56, jobId: "56696" }).mockResolvedValueOnce(null);
    const found = await mainnetLedger.GET(new Request("http://local/x"), { params: Promise.resolve({ jobId: "56696" }) });
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ jobId: "56696" });
    expect(ledger.getJob).toHaveBeenCalledWith({ chainId: 56, jobId: "56696" });

    const missing = await testnetLedger.GET(new Request("http://local/x"), { params: Promise.resolve({ jobId: "5" }) });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("HireJobNotFoundError");
    expect(ledger.getJob).toHaveBeenLastCalledWith({ chainId: 97, jobId: "5" });

    const invalid = await testnetLedger.GET(new Request("http://local/x"), { params: Promise.resolve({ jobId: "abc" }) });
    expect(invalid.status).toBe(400);
  });

  it("answers 503, not 404, when the ledger cannot be read for one job", async () => {
    ledger.getJob.mockRejectedValue(new MarketplaceDataUnavailableError("hire ledger job"));
    for (const route of [mainnetLedger, testnetLedger]) {
      const response = await route.GET(new Request("http://local/x"), { params: Promise.resolve({ jobId: "56696" }) });
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("MarketplaceDataUnavailableError");
    }
  });

  it("serves the activity window with the Worker's 60 s cache window", async () => {
    const window = { chainId: 56, days: 30, from: "2026-08-04T00:00:00.000Z", to: "2026-09-03T12:00:00.000Z", byDay: [], totals: { created: 1, funded: 0, submitted: 0, settled: 0, refunded: 0 } };
    ledger.activity.mockResolvedValue(window);

    const response = await activity.GET(new Request("http://local/api/marketplace/jobs/activity?chainId=56"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(`public, max-age=${HIRE_ACTIVITY_CACHE_SECONDS}, stale-while-revalidate=${HIRE_ACTIVITY_CACHE_SECONDS}`);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=60");
    expect(await response.json()).toEqual(window);
    expect(ledger.activity).toHaveBeenCalledWith({ chainId: 56 });

    await activity.GET(new Request(`http://local/api/marketplace/jobs/activity?chainId=97&days=7&provider=${BUYER}`));
    expect(ledger.activity).toHaveBeenLastCalledWith({ chainId: 97, days: 7, provider: BUYER });
    await activity.GET(new Request("http://local/api/marketplace/jobs/activity?chainId=56&days=90&agentId=303779"));
    expect(ledger.activity).toHaveBeenLastCalledWith({ chainId: 56, days: 90, agentId: "303779" });
  });

  it.each([
    "",
    "chainId=1",
    "chainId=56&days=0",
    "chainId=56&days=91",
    "chainId=56&days=abc",
    "chainId=56&days=7.5",
    "chainId=56&days=07",
    `chainId=56&provider=${BUYER}&agentId=303779`,
    "chainId=56&provider=0x12",
    "chainId=56&agentId=0",
    "chainId=56&buyer=0x12",
    "chainId=56&days=7&days=8",
  ])("rejects activity ?%s with 400 before reading the ledger", async (query) => {
    const response = await activity.GET(new Request(`http://local/api/marketplace/jobs/activity?${query}`));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("InvalidMarketplaceInputError");
    expect(ledger.activity).not.toHaveBeenCalled();
  });

  it("answers 503 when the activity window is unavailable", async () => {
    ledger.activity.mockResolvedValue(null);
    const response = await activity.GET(new Request("http://local/api/marketplace/jobs/activity?chainId=56&days=30"));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("MarketplaceDataUnavailableError");
  });
});
