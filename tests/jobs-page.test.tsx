import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HireActivity, HireJob, HireJobDetail, HireLedgerSummary } from "../src/business/entities/hire-job.ts";
import {
  Erc8183DemoJobNotFoundError,
  Erc8183SpikeUnavailableError,
  InvalidErc8183SpikeInputError,
} from "../src/business/errors/erc8183-spike-errors.ts";
import { MarketplaceDataUnavailableError } from "../src/business/errors/marketplace-errors.ts";

const ledger = vi.hoisted(() => ({
  listRecentJobs: vi.fn(),
  listJobsByProvider: vi.fn(),
  getJob: vi.fn(),
  summary: vi.fn(),
  activity: vi.fn(),
}));
const mainnetJobStatus = vi.hoisted(() => vi.fn());
const testnetTracking = vi.hoisted(() => vi.fn());
const resolveAgents = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock("@/src/business/composition", () => ({
  getHireLedger: ledger,
  resolveJobAgents: { execute: resolveAgents },
  getMainnetErc8183JobStatus: { execute: mainnetJobStatus },
  getErc8183TestnetJobTracking: { execute: testnetTracking },
}));

vi.mock("@/components/marketplace/my-hire-jobs", () => ({
  MyHireJobs: ({ chainId }: { chainId: number }) => createElement("section", { "data-my-jobs": chainId }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: JobsPage } = await import("../app/jobs/page.tsx");
const { default: MainnetJobPage } = await import("../app/jobs/mainnet/[jobId]/page.tsx");
const { default: TestnetJobPage } = await import("../app/jobs/testnet/[jobId]/page.tsx");

const BUYER = "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52" as const;
const SELLER = "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5" as const;
const NOW = "2026-09-03T12:00:00.000Z";

function job(jobId: string, overrides: Partial<HireJob> = {}): HireJob {
  return {
    chainId: 56, jobId, buyer: BUYER, provider: SELLER, budgetRaw: "10000000000000000", status: "SUBMITTED",
    expiresAt: NOW, submittedAt: NOW, marketplace: false, updatedAt: NOW, ...overrides,
  };
}

function summary(chainId: 56 | 97 = 56): HireLedgerSummary {
  const zero = { OPEN: 0, FUNDED: 0, SUBMITTED: 0, COMPLETED: 0, REJECTED: 0, EXPIRED: 0 };
  return {
    chainId,
    indexedThrough: { blockNumber: "119000000", at: NOW },
    protocol: { jobs: 56_697, byStatus: { ...zero, SUBMITTED: 56_000, COMPLETED: 697 } },
    marketplace: { jobs: 2, byStatus: { ...zero, SUBMITTED: 1, FUNDED: 1 } },
    lastIndexRun: { status: "ok", at: NOW },
  };
}

function activity(chainId: 56 | 97 = 56): HireActivity {
  const zero = { created: 0, funded: 0, submitted: 0, settled: 0, refunded: 0 };
  return {
    chainId,
    days: 30,
    from: "2026-08-04T12:00:00.000Z",
    to: NOW,
    byDay: [
      { day: "2026-09-01", ...zero, created: 3, funded: 2 },
      { day: "2026-09-02", ...zero, settled: 1 },
    ],
    totals: { ...zero, created: 3, funded: 2, settled: 1 },
  };
}

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await JobsPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("/jobs ledger page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ledger.activity.mockResolvedValue(null);
  });

  it("shows protocol and marketplace totals with recent jobs, defaulting to Mainnet", async () => {
    ledger.summary.mockResolvedValue(summary());
    ledger.listRecentJobs.mockResolvedValue({ chainId: 56, jobs: [job("56696", { marketplace: true }), job("56695", { status: "FUNDED" })], nextBefore: "56695" });

    const html = await render();

    expect(ledger.summary).toHaveBeenCalledWith({ chainId: 56 });
    expect(ledger.listRecentJobs).toHaveBeenCalledWith({ chainId: 56 });
    expect(html).toContain("56,697 indexed");
    expect(html).toContain("Index cursor 119000000");
    expect(html).toContain('href="/jobs/mainnet/56696"');
    expect(html).toContain('href="/jobs?chainId=56&amp;before=56695"');
    expect(html).not.toContain('data-my-jobs="56"');
    expect(html).not.toMatch(/proven/i);
    expect(html).toContain("not deliverable quality");
  });

  it("reads the last 30 days of phase events for the chain and renders the interactive chart with the indexing note", async () => {
    ledger.summary.mockResolvedValue(summary());
    ledger.listRecentJobs.mockResolvedValue({ chainId: 56, jobs: [], nextBefore: null });
    ledger.activity.mockResolvedValue(activity());

    const html = await render();

    // No explicit days: the default window is the Worker's default, so the
    // page and the agent profile share one cached read.
    expect(ledger.activity).toHaveBeenCalledWith({ chainId: 56 });
    expect(html).toContain("ERC-8183 activity");
    expect(html).toContain("Past 30 days");
    expect(html).toContain("Created events per UTC day over the last 30 days");
    expect(html).toContain("Refunded events per UTC day over the last 30 days");
    expect(html).not.toContain("Phase events per UTC day");
    expect(html).toContain("Counts phase events indexed since the ledger started; earlier jobs are present by state only.");
    expect(html).not.toContain("Recent activity temporarily unavailable");
    expect(html).not.toMatch(/proven|track record/i);
  });

  it("scopes the activity window to ?provider= and reports it unavailable on its own", async () => {
    ledger.summary.mockResolvedValue(summary());
    ledger.listJobsByProvider.mockResolvedValue({ chainId: 56, jobs: [], nextBefore: null });

    const html = await render({ chainId: "97", provider: BUYER });

    expect(ledger.activity).toHaveBeenCalledWith({ chainId: 97, provider: BUYER });
    expect(html).toContain("Recent activity temporarily unavailable.");
    expect(html).toContain("Coverage details");
    expect(html).not.toContain("Indexed ledger temporarily unavailable");
  });

  it("uses the batch resolver and displays names with profile links", async () => {
    ledger.listRecentJobs.mockResolvedValue({ chainId: 56, jobs: [job("99", { marketplace: true }), job("98")], nextBefore: null });
    resolveAgents.mockResolvedValueOnce({ "56:99": { status: "registered", coverage: "partial", evidence: [], agents: [{
      agentId: "303779", name: "Grid Agent", chainId: 56, registryAddress: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", profileAvailable: true,
    }] } });
    const html = await render();
    expect(resolveAgents).toHaveBeenCalledTimes(1);
    expect(resolveAgents.mock.calls[0]?.[0]).toHaveLength(2);
    expect(ledger.getJob).not.toHaveBeenCalled();
    expect(html).toContain('href="/agents/303779"');
    expect(html).toContain("Grid Agent · #303779");
  });

  it("retains job rows if profile enrichment fails", async () => {
    ledger.listRecentJobs.mockResolvedValue({ chainId: 56, jobs: [job("99", { marketplace: true })], nextBefore: null });
    ledger.getJob.mockRejectedValue(new Error("Unavailable"));
    const html = await render();
    expect(html).toContain('href="/jobs/mainnet/99"');
    expect(html).not.toContain('href="/agents/');
  });

  it("switches to Testnet by query and hides the pager when there is no older page", async () => {
    ledger.summary.mockResolvedValue(summary(97));
    ledger.listRecentJobs.mockResolvedValue({ chainId: 97, jobs: [{ ...job("551"), chainId: 97 }], nextBefore: null });

    const html = await render({ chainId: "97", before: "600" });

    expect(ledger.listRecentJobs).toHaveBeenCalledWith({ chainId: 97, before: "600" });
    expect(html).toContain('href="/jobs/testnet/551"');
    expect(html).not.toContain("before #600");
    expect(html).not.toContain('href="/jobs?chainId=97&amp;before=');
    // aria-current sits on the Testnet link and only there.
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/jobs\?chainId=97"[^>]*>BSC Testnet<\/a>/);
    expect(html).not.toMatch(/<a aria-current="page"[^>]*href="\/jobs\?chainId=56"/);
  });

  it.each(["x", "0", "-1", "1".repeat(17)])("ignores the malformed cursor %s and renders the unavailable state without inventing counts", async (before) => {
    ledger.summary.mockResolvedValue(null);
    ledger.listRecentJobs.mockResolvedValue(null);

    const html = await render({ before });

    expect(ledger.listRecentJobs).toHaveBeenCalledWith({ chainId: 56 });
    expect(html).not.toContain("Jobs before #");
    expect(html).toContain("Indexed ledger temporarily unavailable");
    expect(html).toContain("Counts temporarily unavailable");
    expect(html).not.toContain("tabular-nums\">0");
  });

  it.each(["1", "abc", "56 ", ""])("404s ?chainId=%s instead of coercing it to Mainnet", async (chainId) => {
    await expect(render({ chainId })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(ledger.summary).not.toHaveBeenCalled();
    expect(ledger.listRecentJobs).not.toHaveBeenCalled();
  });

  it("requests a selected activity window and preserves it in navigation", async () => {
    ledger.summary.mockResolvedValue(summary());
    ledger.listRecentJobs.mockResolvedValue({ chainId: 56, jobs: [job("99")], nextBefore: "98" });
    ledger.activity.mockResolvedValue({ ...activity(), days: 7 });

    const html = await render({ days: "7" });

    expect(ledger.activity).toHaveBeenCalledWith({ chainId: 56, days: 7 });
    expect(html).toContain("Past 7 days");
    expect(html).toContain('href="/jobs?chainId=97&amp;days=7"');
    expect(html).toContain('href="/jobs?chainId=56&amp;before=98&amp;days=7"');
  });

  it.each(["0", "14", "91", "7 "])("404s unsupported activity window ?days=%s", async (days) => {
    await expect(render({ days })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(ledger.summary).not.toHaveBeenCalled();
  });

  // The agent profile links here for "All indexed jobs" sold by a wallet:
  // the list is scoped to the provider, the summary stays chain-wide.
  it("scopes the list to ?provider= with the cursor, names the filter and links back to all jobs", async () => {
    ledger.summary.mockResolvedValue(summary());
    ledger.listJobsByProvider.mockResolvedValue({ chainId: 56, jobs: [job("56696", { provider: BUYER })], nextBefore: "56600" });

    const html = await render({ chainId: "56", provider: BUYER, before: "600" });

    expect(ledger.listJobsByProvider).toHaveBeenCalledWith({ chainId: 56, provider: BUYER, before: "600" });
    expect(ledger.listRecentJobs).not.toHaveBeenCalled();
    expect(ledger.summary).toHaveBeenCalledWith({ chainId: 56 });
    expect(html).not.toContain("Jobs sold by ");
    expect(html).toContain('href="https://bscscan.com/address/0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52"');
    expect(html).toContain("0x5ee7…cc52");
    expect(html).toMatch(/<a[^>]*href="\/jobs\?chainId=56"[^>]*>All jobs<\/a>/);
    expect(html).toContain('href="/jobs/mainnet/56696"');
    // Pager and network selector keep the provider scope.
    expect(html).toContain(`href="/jobs?chainId=56&amp;provider=${BUYER}&amp;before=56600&amp;trail=600"`);
    expect(html).toContain(`href="/jobs?chainId=97&amp;provider=${BUYER}"`);
    expect(html).not.toMatch(/proven/i);
  });

  it.each(["0x12", "abc", `${BUYER} `, ""])("404s ?provider=%s without reading the ledger", async (provider) => {
    await expect(render({ chainId: "56", provider })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(ledger.summary).not.toHaveBeenCalled();
    expect(ledger.listRecentJobs).not.toHaveBeenCalled();
    expect(ledger.listJobsByProvider).not.toHaveBeenCalled();
  });
});

const TX = `0x${"ab".repeat(32)}` as const;

function detail(jobId: string, chainId: 56 | 97 = 56): HireJobDetail {
  return {
    ...job(jobId, { chainId, status: "COMPLETED", marketplace: true }),
    evaluator: SELLER, hook: SELLER, deliverable: null, firstSeenAt: NOW,
    events: [{ phase: "settled", eventName: "JobCompleted", txHash: TX, logIndex: 3, blockNumber: "119000000", occurredAt: NOW, actor: SELLER, amount: null, deliverable: null, reason: null }],
    hireEvents: [],
  };
}

// Indexed state is a legitimate degraded answer: the ledger page must be
// reachable both when the demo allowlist rejects the job and when the live
// chain read itself fails.
const LIVE_FAILURES: [string, Error][] = [
  ["the live demo allowlist rejects the job", new Erc8183DemoJobNotFoundError()],
  ["the live chain read fails", new Erc8183SpikeUnavailableError("RPC down")],
];

describe("/jobs/mainnet/[jobId] ledger fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(LIVE_FAILURES)("renders the indexed ledger when %s", async (_label, error) => {
    mainnetJobStatus.mockRejectedValue(error);
    ledger.getJob.mockResolvedValue(detail("56662"));

    const html = renderToStaticMarkup(await MainnetJobPage({ params: Promise.resolve({ jobId: "56662" }) }));

    expect(ledger.getJob).toHaveBeenCalledWith({ chainId: 56, jobId: "56662" });
    expect(html).toContain("ERC-8183 Job #56662");
    expect(html).toContain("Indexed Completed");
    expect(html).toContain("Hired via this marketplace");
    expect(html).toContain(`https://bscscan.com/tx/0x${"ab".repeat(32)}`);
    expect(html).toContain("Delivery &amp; closure");
  });

  it("still 404s when the ledger has no row", async () => {
    mainnetJobStatus.mockRejectedValue(new Erc8183DemoJobNotFoundError());
    ledger.getJob.mockResolvedValue(null);
    await expect(MainnetJobPage({ params: Promise.resolve({ jobId: "1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(LIVE_FAILURES)("renders the unavailable state, not 404, when %s and the ledger cannot be read", async (_label, error) => {
    mainnetJobStatus.mockRejectedValue(error);
    ledger.getJob.mockRejectedValue(new MarketplaceDataUnavailableError("hire ledger job"));
    const html = renderToStaticMarkup(await MainnetJobPage({ params: Promise.resolve({ jobId: "56662" }) }));
    expect(html).toContain("temporarily unavailable");
    expect(html).toContain('href="/jobs/mainnet/56662"');
    expect(html).not.toMatch(/proven/i);
  });
});

describe("/jobs/testnet/[jobId] ledger fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(LIVE_FAILURES)("renders the indexed ledger when %s", async (_label, error) => {
    testnetTracking.mockRejectedValue(error);
    ledger.getJob.mockResolvedValue(detail("551", 97));

    const html = renderToStaticMarkup(await TestnetJobPage({ params: Promise.resolve({ jobId: "551" }) }));

    expect(testnetTracking).toHaveBeenCalledWith({ jobId: "551" });
    expect(ledger.getJob).toHaveBeenCalledWith({ chainId: 97, jobId: "551" });
    expect(html).toContain("ERC-8183 Job #551");
    expect(html).toContain("BNB Smart Chain Testnet");
    expect(html).toContain(`https://testnet.bscscan.com/tx/${TX}`);
    expect(html).not.toMatch(/proven/i);
  });

  it("404s a malformed id without reading the ledger, and a well-formed id the ledger has no row for", async () => {
    testnetTracking.mockRejectedValue(new Erc8183DemoJobNotFoundError());
    await expect(TestnetJobPage({ params: Promise.resolve({ jobId: "abc" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    testnetTracking.mockRejectedValue(new InvalidErc8183SpikeInputError());
    await expect(TestnetJobPage({ params: Promise.resolve({ jobId: "-1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(ledger.getJob).not.toHaveBeenCalled();

    testnetTracking.mockRejectedValue(new Erc8183DemoJobNotFoundError());
    ledger.getJob.mockResolvedValue(null);
    await expect(TestnetJobPage({ params: Promise.resolve({ jobId: "5" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(ledger.getJob).toHaveBeenCalledWith({ chainId: 97, jobId: "5" });
  });

  it("renders the unavailable state, not 404, when the ledger cannot be read", async () => {
    testnetTracking.mockRejectedValue(new Erc8183SpikeUnavailableError("RPC down"));
    ledger.getJob.mockRejectedValue(new MarketplaceDataUnavailableError("hire ledger job"));
    const html = renderToStaticMarkup(await TestnetJobPage({ params: Promise.resolve({ jobId: "551" }) }));
    expect(html).toContain("temporarily unavailable");
    expect(html).toContain('href="/jobs/testnet/551"');
  });
});
