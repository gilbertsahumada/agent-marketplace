import type { Erc8183JobFacts } from "./erc8183-browser-spike.ts";
import type { VerifiedHireEvent, VerifiedHirePhase } from "./verified-hire-event.ts";

// Indexed on-chain state of ERC-8183 Commerce jobs, read from the observation
// Worker's Commerce indexer. `marketplace: true` means a chain-verified hire
// event exists for the job (it went through this marketplace); it never means
// the marketplace verified the deliverable. Nothing here is a track record:
// a settled job proves the phase happened, not the quality of the work.

export type HireJobStatus = Erc8183JobFacts["status"];
export type HireChainId = 56 | 97;
export type HireAddress = `0x${string}`;

// The activity window's cache decision, shared by the data layer's TTL and the
// HTTP cache-control header so the two never drift apart.
export const HIRE_ACTIVITY_CACHE_SECONDS = 60;
// The Worker's own default window. Callers wanting it send no `days` at all,
// so the default read is one cache entry, not one per spelling.
export const HIRE_ACTIVITY_DEFAULT_DAYS = 30;

export interface HireJob {
  chainId: HireChainId;
  jobId: string;
  buyer: HireAddress;
  provider: HireAddress;
  budgetRaw: string;
  status: HireJobStatus;
  expiresAt: string;
  submittedAt: string | null;
  marketplace: boolean;
  updatedAt: string;
}

export interface HireJobEvent {
  phase: VerifiedHirePhase;
  eventName: string;
  txHash: HireAddress;
  // Position of the log inside its transaction; with txHash it identifies the
  // event uniquely (two same-name events can share a transaction).
  logIndex: number;
  blockNumber: string;
  occurredAt: string;
  actor: HireAddress | null;
  amount: string | null;
  deliverable: string | null;
  reason: string | null;
}

export interface HireJobDetail extends HireJob {
  evaluator: HireAddress;
  hook: HireAddress;
  deliverable: string | null;
  firstSeenAt: string;
  events: HireJobEvent[];
  hireEvents: VerifiedHireEvent[];
}

export interface HireJobPage {
  chainId: HireChainId;
  jobs: HireJob[];
  nextBefore: string | null;
  /** All rows in this query scope, independent of the page cursor. */
  totals?: HireJobTotals;
}

export interface HireJobTotals {
  total: number;
  completed: number;
  funded: number;
  submitted: number;
}

// How an agent's indexed jobs were looked up: by its provider wallet, or only
// by the hire events the marketplace itself recorded for the agent id.
export type HireJobsScope = "wallet" | "agent";

export interface HireLedgerCounts {
  jobs: number;
  byStatus: Record<HireJobStatus, number>;
}

export interface HireLedgerSummary {
  chainId: HireChainId;
  indexedThrough: { blockNumber: string; at: string } | null;
  protocol: HireLedgerCounts;
  marketplace: HireLedgerCounts;
  lastIndexRun: { status: string; at: string } | null;
}

// Phase events per UTC day over a trailing window, for one chain, one provider
// wallet or one marketplace agent. Counts events the indexer saw since it
// started; jobs backfilled by state alone contribute nothing, so an old job
// present in the list may be absent here. Activity, never a track record.
export type HireActivityCounts = Record<VerifiedHirePhase, number>;

export interface HireActivity {
  chainId: HireChainId;
  days: number;
  from: string;
  to: string;
  byDay: Array<{ day: string } & HireActivityCounts>;
  totals: HireActivityCounts;
}

// Two failure contracts, on purpose. The list readers and the summary answer
// null when the ledger is unavailable; callers render the page as without
// them (HTTP maps null to 503). `getJob` answers null only when the ledger has
// no row for the job ("not indexed", a 404 for HTTP) and THROWS
// MarketplaceDataUnavailableError when the ledger cannot be read (upstream
// failure, timeout, malformed payload, unconfigured origin), so an outage is
// never reported as a missing job.
export interface HireLedger {
  listRecentJobs(input: { chainId: HireChainId; before?: string }): Promise<HireJobPage | null>;
  listJobsByBuyer(input: { chainId: HireChainId; buyer: HireAddress; before?: string }): Promise<HireJobPage | null>;
  listJobsByProvider(input: { chainId: HireChainId; provider: HireAddress; before?: string }): Promise<HireJobPage | null>;
  listJobsByAgent(input: { chainId: HireChainId; agentId: string; before?: string }): Promise<HireJobPage | null>;
  getJob(input: { chainId: HireChainId; jobId: string }): Promise<HireJobDetail | null>;
  summary(input: { chainId: HireChainId }): Promise<HireLedgerSummary | null>;
  // Trailing window of phase events (HIRE_ACTIVITY_DEFAULT_DAYS when `days` is
  // omitted, 1..90), scoped to at most one of provider/agentId; null when it
  // cannot be read.
  activity(input: { chainId: HireChainId; days?: number; provider?: HireAddress; agentId?: string }): Promise<HireActivity | null>;
}
