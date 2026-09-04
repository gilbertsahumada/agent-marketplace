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
}
