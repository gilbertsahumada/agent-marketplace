import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHireJob,
  getHireJobs,
  getHireLedgerSummary,
  parseHireJobDetail,
  parseHireJobPage,
  parseHireLedgerSummary,
} from "../src/data/observation/hire-ledger-feed.ts";
import { MarketplaceDataUnavailableError } from "../src/business/errors/marketplace-errors.ts";

const ENV = { OBSERVATIONS_URL: "https://probe.example.workers.dev/observations" };
const BUYER = "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52";
const SELLER = "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5";
const TX = `0x${"ab".repeat(32)}`;
const NOW = 1_788_000_000_000;

function job(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "56696", client: BUYER, provider: SELLER, budget: "10000000000000000", status: 2,
    expiredAt: NOW + 600_000, submittedAt: NOW, marketplace: true, updatedAt: NOW, ...overrides,
  };
}

function page(overrides: Record<string, unknown> = {}, jobOverrides: Record<string, unknown> = {}) {
  return { schemaVersion: 1, chainId: 56, jobs: [job(jobOverrides)], nextBefore: null, ...overrides };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    chainId: 56,
    job: { ...job(), evaluator: SELLER, hook: SELLER, deliverable: null, firstSeenAt: NOW },
    events: [{
      phase: "funded", eventName: "JobFunded", txHash: TX, logIndex: 1, blockNumber: "119000000",
      occurredAt: NOW, actor: BUYER, amount: "10000000000000000", deliverable: null, reason: null,
    }],
    hireEvents: [{ agentId: "303779", phase: "funded", txHash: TX, blockNumber: "119000000", occurredAt: NOW, verifiedAt: NOW }],
    marketplace: true,
    ...overrides,
  };
}

function summary(overrides: Record<string, unknown> = {}) {
  const byStatus = { OPEN: 1, FUNDED: 2, SUBMITTED: 3, COMPLETED: 4, REJECTED: 0, EXPIRED: 0 };
  return {
    schemaVersion: 1, chainId: 56,
    indexedThrough: { blockNumber: "119000000", at: NOW },
    protocol: { jobs: 10, byStatus },
    marketplace: { jobs: 1, byStatus: { ...byStatus, OPEN: 0, FUNDED: 1, SUBMITTED: 0, COMPLETED: 0 } },
    lastIndexRun: { status: "ok", at: NOW },
    ...overrides,
  };
}

describe("hire ledger feed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves independent scope totals and rejects malformed aggregates", () => {
    const totals = { total: 17, completed: 8, funded: 2, submitted: 3 };
    expect(parseHireJobPage(page({ totals, nextBefore: "56000" }), 56)).toHaveProperty("totals", totals);
    expect(() => parseHireJobPage(page({ totals: { ...totals, completed: 18 } }), 56)).toThrow();
    expect(() => parseHireJobPage(page({ totals: { ...totals, total: -1 } }), 56)).toThrow();
  });

  it("parses only the allowlisted job fields and maps numeric status to its name", () => {
    expect(parseHireJobPage(page({}, { extra: "dropped" }), 56)).toEqual({
      chainId: 56,
      jobs: [{
        chainId: 56, jobId: "56696", buyer: BUYER, provider: SELLER, budgetRaw: "10000000000000000", status: "SUBMITTED",
        expiresAt: new Date(NOW + 600_000).toISOString(), submittedAt: new Date(NOW).toISOString(),
        marketplace: true, updatedAt: new Date(NOW).toISOString(),
      }],
      nextBefore: null,
    });
    expect(parseHireJobPage(page({ nextBefore: "56600" }), 56).nextBefore).toBe("56600");
  });

  it.each<[string, unknown]>([
    ["schema", page({ schemaVersion: 2 })],
    ["chain", page({ chainId: 97 })],
    ["status", page({}, { status: 6 })],
    ["address", page({}, { client: "0x12" })],
    ["job id", page({}, { jobId: "-1" })],
    ["budget", page({}, { budget: "1e18" })],
    ["cursor", page({ nextBefore: "x" })],
    ["jobs", page({ jobs: null })],
    ["marketplace flag", page({}, { marketplace: "yes" })],
  ])("rejects a malformed %s instead of returning a partial page", (_label, value) => {
    expect(() => parseHireJobPage(value, 56)).toThrow("HIRE_LEDGER_FEED_INVALID");
  });

  it("parses a job detail with its phase ledger (including logIndex) and verified hire events", () => {
    const at = new Date(NOW).toISOString();
    expect(parseHireJobDetail(detail(), 56)).toEqual({
      chainId: 56, jobId: "56696", buyer: BUYER, provider: SELLER, budgetRaw: "10000000000000000", status: "SUBMITTED",
      expiresAt: new Date(NOW + 600_000).toISOString(), submittedAt: at, marketplace: true, updatedAt: at,
      evaluator: SELLER, hook: SELLER, deliverable: null, firstSeenAt: at,
      events: [{
        phase: "funded", eventName: "JobFunded", txHash: TX, logIndex: 1, blockNumber: "119000000", occurredAt: at,
        actor: BUYER, amount: "10000000000000000", deliverable: null, reason: null,
      }],
      hireEvents: [{ chainId: 56, agentId: "303779", phase: "funded", jobId: "56696", txHash: TX, blockNumber: "119000000", occurredAt: at, verifiedAt: at }],
    });
    expect(() => parseHireJobDetail(detail({ events: [{ phase: "clicked" }] }), 56)).toThrow("HIRE_LEDGER_FEED_INVALID");
    for (const logIndex of ["1", -1, 1.5, undefined]) {
      expect(() => parseHireJobDetail(detail({ events: [{ ...detail().events[0], logIndex }] }), 56)).toThrow("HIRE_LEDGER_FEED_INVALID");
    }
  });

  it("parses the summary and rejects a status name it does not know", () => {
    const at = new Date(NOW).toISOString();
    expect(parseHireLedgerSummary(summary(), 56)).toEqual({
      chainId: 56,
      indexedThrough: { blockNumber: "119000000", at },
      protocol: { jobs: 10, byStatus: { OPEN: 1, FUNDED: 2, SUBMITTED: 3, COMPLETED: 4, REJECTED: 0, EXPIRED: 0 } },
      marketplace: { jobs: 1, byStatus: { OPEN: 0, FUNDED: 1, SUBMITTED: 0, COMPLETED: 0, REJECTED: 0, EXPIRED: 0 } },
      lastIndexRun: { status: "ok", at },
    });
    expect(parseHireLedgerSummary(summary({ indexedThrough: null, lastIndexRun: null }), 56)).toMatchObject({ indexedThrough: null, lastIndexRun: null });
    expect(() => parseHireLedgerSummary(summary({ protocol: { jobs: 1, byStatus: { OPEN: 1 } } }), 56)).toThrow("HIRE_LEDGER_FEED_INVALID");
  });

  it("builds the three Worker URLs and refuses two identity filters before any request", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/commerce-summary")) return Response.json(summary());
      if (/\/commerce-jobs\/56\/\d+$/.test(url)) return Response.json(detail());
      return Response.json(page());
    }));
    await expect(getHireJobs({ chainId: 56, buyer: BUYER, before: "100", env: ENV })).resolves.toMatchObject({ jobs: [{ jobId: "56696" }] });
    await expect(getHireJob({ chainId: 56, jobId: "56696", env: ENV })).resolves.toMatchObject({ jobId: "56696" });
    await expect(getHireLedgerSummary({ chainId: 56, env: ENV })).resolves.toMatchObject({ protocol: { jobs: 10 } });
    expect(requested).toEqual([
      `https://probe.example.workers.dev/commerce-jobs?chainId=56&limit=25&buyer=${BUYER}&before=100`,
      "https://probe.example.workers.dev/commerce-jobs/56/56696",
      "https://probe.example.workers.dev/commerce-summary?chainId=56",
    ]);
    await expect(getHireJobs({ chainId: 56, buyer: BUYER, provider: SELLER, env: ENV })).resolves.toBeNull();
    await expect(getHireJobs({ chainId: 56, agentId: "0x1", env: ENV })).resolves.toBeNull();
    await expect(getHireJob({ chainId: 56, jobId: "abc", env: ENV })).resolves.toBeNull();
    expect(requested).toHaveLength(3);
  });

  it("rejects a detail response for a different job than the one requested", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(detail({ job: { ...detail().job, jobId: "56695" } }))));

    await expect(getHireJob({ chainId: 56, jobId: "56694", env: ENV }))
      .rejects.toBeInstanceOf(MarketplaceDataUnavailableError);
  });

  it.each<[string, () => Promise<Response>, Record<string, string | undefined>]>([
    ["missing origin", async () => Response.json(page()), {}],
    ["non-https origin", async () => Response.json(page()), { OBSERVATIONS_URL: "http://probe.example/observations" }],
    ["upstream failure", async () => new Response(null, { status: 503 }), ENV],
    ["not found", async () => new Response(null, { status: 404 }), ENV],
    ["malformed payload", async () => Response.json({ schemaVersion: 1 }), ENV],
    ["transport error", async () => { throw new Error("offline"); }, ENV],
  ])("list fails closed to null on %s", async (_label, response, env) => {
    vi.stubGlobal("fetch", vi.fn(response));
    await expect(getHireJobs({ chainId: 97, env })).resolves.toBeNull();
  });

  // A job the Worker has not indexed is a miss; a Worker the marketplace
  // cannot read is an outage. Callers must never confuse the two.
  it("getHireJob answers null only for a Worker 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(getHireJob({ chainId: 56, jobId: "404001", env: ENV })).resolves.toBeNull();
  });

  it.each<[string, () => Promise<Response>, Record<string, string | undefined>, string]>([
    ["missing origin", async () => Response.json(detail()), {}, "503000"],
    ["non-https origin", async () => Response.json(detail()), { OBSERVATIONS_URL: "http://probe.example/observations" }, "503000"],
    ["upstream failure", async () => new Response(null, { status: 503 }), ENV, "503001"],
    ["malformed payload", async () => Response.json({ schemaVersion: 1 }), ENV, "503002"],
    ["transport error", async () => { throw new Error("offline"); }, ENV, "503003"],
    ["timeout", async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }, ENV, "503004"],
  ])("getHireJob throws MarketplaceDataUnavailableError on %s", async (_label, response, env, jobId) => {
    vi.stubGlobal("fetch", vi.fn(response));
    await expect(getHireJob({ chainId: 56, jobId, env })).rejects.toBeInstanceOf(MarketplaceDataUnavailableError);
  });
});

describe("hire ledger feed cache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("serves a repeat read within 30 s from cache and hands fetch an abort signal", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(page()));
    vi.stubGlobal("fetch", fetchMock);
    await getHireJobs({ chainId: 56, before: "30001", env: ENV });
    await getHireJobs({ chainId: 56, before: "30001", env: ENV });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    vi.advanceTimersByTime(30_001);
    await getHireJobs({ chainId: 56, before: "30001", env: ENV });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a 503: the next call refetches", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json(page()));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getHireJobs({ chainId: 56, before: "30002", env: ENV })).resolves.toBeNull();
    await expect(getHireJobs({ chainId: 56, before: "30002", env: ENV })).resolves.toMatchObject({ jobs: [{ jobId: "56696" }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("remembers a 404 miss for 10 s so an unknown job does not cost a Worker round-trip per view", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(detail({ job: { ...detail().job, jobId: "30003" } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getHireJob({ chainId: 56, jobId: "30003", env: ENV })).resolves.toBeNull();
    vi.advanceTimersByTime(9_000);
    await expect(getHireJob({ chainId: 56, jobId: "30003", env: ENV })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_001);
    await expect(getHireJob({ chainId: 56, jobId: "30003", env: ENV })).resolves.toMatchObject({ jobId: "30003" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds remembered misses so arbitrary job ids cannot grow memory without limit", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    for (let index = 0; index <= 256; index += 1) {
      await getHireJob({ chainId: 56, jobId: String(40000 + index), env: ENV });
    }

    await getHireJob({ chainId: 56, jobId: "40000", env: ENV });

    expect(fetchMock).toHaveBeenCalledTimes(258);
  });
});
