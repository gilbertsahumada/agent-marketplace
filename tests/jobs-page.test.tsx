import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HireJob, HireJobDetail, HireLedgerSummary } from "../src/business/entities/hire-job.ts";
import { Erc8183DemoJobNotFoundError } from "../src/business/errors/erc8183-spike-errors.ts";

const ledger = vi.hoisted(() => ({
  listRecentJobs: vi.fn(),
  getJob: vi.fn(),
  summary: vi.fn(),
}));
const mainnetJobStatus = vi.hoisted(() => vi.fn());

vi.mock("@/src/business/composition", () => ({
  getHireLedger: ledger,
  getMainnetErc8183JobStatus: { execute: mainnetJobStatus },
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

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await JobsPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("/jobs ledger page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows protocol and marketplace totals with recent jobs, defaulting to Mainnet", async () => {
    ledger.summary.mockResolvedValue(summary());
    ledger.listRecentJobs.mockResolvedValue({ chainId: 56, jobs: [job("56696", { marketplace: true }), job("56695", { status: "FUNDED" })], nextBefore: "56695" });

    const html = await render();

    expect(ledger.summary).toHaveBeenCalledWith({ chainId: 56 });
    expect(ledger.listRecentJobs).toHaveBeenCalledWith({ chainId: 56 });
    expect(html).toContain("56,697");
    expect(html).toContain("Processed through this marketplace");
    expect(html).toContain("Indexed through block 119000000");
    expect(html).toContain('href="/jobs/mainnet/56696"');
    expect(html).toContain('href="/jobs?chainId=56&amp;before=56695"');
    expect(html).toContain('data-my-jobs="56"');
    // The only "track record" on the page is the disclaimer that this is not one.
    expect(html).not.toMatch(/proven/i);
    expect(html.match(/track record/gi)).toHaveLength(1);
    expect(html).toContain("not a track record");
  });

  it("switches to Testnet by query and hides the pager when there is no older page", async () => {
    ledger.summary.mockResolvedValue(summary(97));
    ledger.listRecentJobs.mockResolvedValue({ chainId: 97, jobs: [{ ...job("551"), chainId: 97 }], nextBefore: null });

    const html = await render({ chainId: "97", before: "600" });

    expect(ledger.listRecentJobs).toHaveBeenCalledWith({ chainId: 97, before: "600" });
    expect(html).toContain('href="/jobs/testnet/551"');
    expect(html).toContain("Jobs before #600");
    expect(html).not.toContain("Older jobs");
    expect(html).toContain('aria-current="page"');
  });

  it("ignores a malformed cursor and renders the unavailable state without inventing counts", async () => {
    ledger.summary.mockResolvedValue(null);
    ledger.listRecentJobs.mockResolvedValue(null);

    const html = await render({ before: "x" });

    expect(ledger.listRecentJobs).toHaveBeenCalledWith({ chainId: 56 });
    expect(html).toContain("Indexed ledger temporarily unavailable");
    expect(html).not.toContain("Protocol");
  });
});

describe("/jobs/mainnet/[jobId] ledger fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the indexed ledger when the live demo allowlist rejects the job", async () => {
    mainnetJobStatus.mockRejectedValue(new Erc8183DemoJobNotFoundError());
    const detail: HireJobDetail = {
      ...job("56662", { status: "COMPLETED", marketplace: true }),
      evaluator: SELLER, hook: SELLER, deliverable: null, firstSeenAt: NOW,
      events: [{ phase: "settled", eventName: "JobCompleted", txHash: `0x${"ab".repeat(32)}`, blockNumber: "119000000", occurredAt: NOW, actor: SELLER, amount: null, deliverable: null, reason: null }],
      hireEvents: [],
    };
    ledger.getJob.mockResolvedValue(detail);

    const html = renderToStaticMarkup(await MainnetJobPage({ params: Promise.resolve({ jobId: "56662" }) }));

    expect(ledger.getJob).toHaveBeenCalledWith({ chainId: 56, jobId: "56662" });
    expect(html).toContain("ERC-8183 Job #56662");
    expect(html).toContain("Indexed Completed");
    expect(html).toContain("Processed through this marketplace");
    expect(html).toContain(`https://bscscan.com/tx/0x${"ab".repeat(32)}`);
    expect(html).toContain("Not a hash-verified deliverable");
  });

  it("still 404s when the ledger has no row", async () => {
    mainnetJobStatus.mockRejectedValue(new Erc8183DemoJobNotFoundError());
    ledger.getJob.mockResolvedValue(null);
    await expect(MainnetJobPage({ params: Promise.resolve({ jobId: "1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
