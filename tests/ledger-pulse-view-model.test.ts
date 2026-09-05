import { describe, expect, it } from "vitest";
import { LEDGER_PULSE_RECENT_JOBS, ledgerPulseViewModel } from "@/components/marketplace/ledger-pulse-view-model";
import type { HireActivity, HireJob, HireJobPage, HireLedgerSummary } from "@/src/business/entities/hire-job";

const NOW = Date.parse("2026-09-05T20:00:00.000Z");
const counts = { OPEN: 1, FUNDED: 2, SUBMITTED: 3, COMPLETED: 4, REJECTED: 0, EXPIRED: 0 } as const;
const summary: HireLedgerSummary = {
  chainId: 56,
  indexedThrough: { blockNumber: "120146010", at: "2026-09-05T19:59:48.000Z" },
  protocol: { jobs: 56716, byStatus: { ...counts } },
  marketplace: { jobs: 1, byStatus: { ...counts } },
  lastIndexRun: { status: "ok", at: "2026-09-05T19:59:48.000Z" },
};
const activity: HireActivity = {
  chainId: 56, days: 7, from: "2026-08-30T00:00:00.000Z", to: "2026-09-05T20:00:00.000Z",
  byDay: [],
  totals: { created: 1048, funded: 900, submitted: 800, settled: 730, refunded: 9 },
};
function job(jobId: string, status: HireJob["status"], minutesAgo: number, marketplace = false): HireJob {
  return {
    chainId: 56, jobId, status, marketplace,
    buyer: "0x5ee7a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c", provider: "0x1111111111111111111111111111111111111111",
    budgetRaw: "10000000000000000", expiresAt: "2026-09-06T00:00:00.000Z", submittedAt: null,
    updatedAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
  };
}
const page: HireJobPage = { chainId: 56, nextBefore: null, jobs: [job("56713", "COMPLETED", 2, true), job("56712", "FUNDED", 15), job("56711", "OPEN", 70), job("56710", "SUBMITTED", 1_500), job("56709", "EXPIRED", 3_000)] };

describe("ledgerPulseViewModel", () => {
  it("formats the indexed state with fixed relative ages so the client never recomputes them", () => {
    const pulse = ledgerPulseViewModel({ summary, activity, page }, NOW);
    expect(pulse).toMatchObject({
      network: "ERC-8183 Commerce · BSC Mainnet",
      jobsIndexed: "56,716",
      processedHere: "1",
      indexedThrough: { blockNumber: "120,146,010", ago: "12s ago" },
      window: { days: 7, created: "1,048", settled: "730", refunded: "9" },
    });
    expect(pulse?.recent).toHaveLength(LEDGER_PULSE_RECENT_JOBS);
    expect(pulse?.recent[0]).toEqual({
      jobId: "56713", status: "COMPLETED", href: "/jobs/mainnet/56713", buyerShort: "0x5ee7…0b1c", updatedAgo: "2m ago", marketplace: true,
    });
    expect(pulse?.recent.map((entry) => entry.updatedAgo)).toEqual(["2m ago", "15m ago", "1h ago", "1d ago"]);
  });

  it("is null without a summary, and degrades field by field otherwise", () => {
    expect(ledgerPulseViewModel({ summary: null, activity, page }, NOW)).toBeNull();
    const partial = ledgerPulseViewModel({ summary: { ...summary, indexedThrough: null }, activity: null, page: null }, NOW);
    expect(partial).toMatchObject({ jobsIndexed: "56,716", indexedThrough: null, window: null, recent: [] });
  });
});
