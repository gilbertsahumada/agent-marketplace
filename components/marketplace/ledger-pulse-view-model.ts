import { shortAddress } from "@/lib/bsc-chains";
import type { HireActivity, HireJobPage, HireLedgerSummary } from "@/src/business/entities/hire-job";
import type { LedgerPulseViewModel } from "./presentation-types";
import { relativeAge } from "./relative-time";

const COUNT = new Intl.NumberFormat("en");
export const LEDGER_PULSE_RECENT_JOBS = 4;

// Null when the summary is missing: the panel then says the indexer is
// unreachable instead of showing zeros that would read as "no jobs".
export function ledgerPulseViewModel(
  { summary, activity, page }: { summary: HireLedgerSummary | null; activity: HireActivity | null; page: HireJobPage | null },
  now = Date.now(),
): LedgerPulseViewModel | null {
  if (summary === null) return null;
  return {
    network: "ERC-8183 Commerce · BSC Mainnet",
    jobsIndexed: COUNT.format(summary.protocol.jobs),
    jobsIndexedCount: summary.protocol.jobs,
    processedHere: COUNT.format(summary.marketplace.jobs),
    indexedThrough: summary.indexedThrough
      ? { blockNumber: COUNT.format(Number(summary.indexedThrough.blockNumber)), ago: relativeAge(summary.indexedThrough.at, now) }
      : null,
    window: activity
      ? {
        days: activity.days,
        created: COUNT.format(activity.totals.created),
        settled: COUNT.format(activity.totals.settled),
        refunded: COUNT.format(activity.totals.refunded),
      }
      : null,
    recent: (page?.jobs ?? []).slice(0, LEDGER_PULSE_RECENT_JOBS).map((job) => ({
      jobId: job.jobId,
      status: job.status,
      href: `/jobs/mainnet/${job.jobId}`,
      buyerShort: shortAddress(job.buyer),
      updatedAgo: relativeAge(job.updatedAt, now),
      marketplace: job.marketplace,
    })),
  };
}
