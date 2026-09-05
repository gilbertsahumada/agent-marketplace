export type MarketplaceCategory =
  | "rebalancing"
  | "grid_trading"
  | "yield_optimisation"
  | "health_factor_monitoring";

export type ProvenanceKind = "declared" | "observed" | "onchain" | "derived" | "not_probed" | "unavailable";

export type EvidenceKind = "declared" | "reachable" | "quote" | "job";

export type EvidenceStatus = "verified" | "failed" | "current" | "unavailable" | "unknown";

export type AgentProtocolLabel = "A2A" | "MCP" | "ERC-8183 HTTP" | "Web" | "x402";

export interface EvidenceStepViewModel {
  kind: EvidenceKind;
  label: string;
  status: EvidenceStatus;
  provenance: ProvenanceKind;
  detail: string;
  source?: string;
  timestamp?: string;
  link?: { href: string; label: string };
}

export interface CategoryCardViewModel {
  category: MarketplaceCategory;
  title: string;
  description: string;
  href: string;
  availability: "listed" | "empty";
  availabilityLabel: string;
}

export interface AgentCardViewModel {
  agentId: string;
  name: string;
  description: string;
  imageUrl?: string;
  operator: "third_party" | "marketplace";
  quoteRequestAvailable?: boolean;
  /** Public, sanitised quote-request counters from the Worker ledger. */
  quoteRequestCount?: number;
  quoteSuccessCount?: number;
  lastQuoteAttemptAt?: string | null;
  jobCount?: number;
  completedJobCount?: number;
  capabilityState?: "unsupported" | "discovered" | "ready" | "stale" | "failed" | "suspended";
  capabilityExpiresAt?: string | null;
  buyerAction?: "unavailable" | "check_availability" | "request_quote" | "prepare_hire";
  blockingReasons?: string[];
  categories: MarketplaceCategory[];
  protocols?: AgentProtocolLabel[];
  href: string;
  hireability: "hireable" | "mcp_only" | "quote_stale" | "wallet_ambiguous" | "listed_only";
  evidence: EvidenceStepViewModel[];
  trustScore?: number;
  verification?: VerificationDriftViewModel | null;
  passportState: "registered" | "evaluated" | "hireable" | "job_proven" | "attention";
  monitoring?: {
    state: "feed_unavailable" | "no_endpoint_declared" | "not_monitored" | "never_probed" | "probed";
    source?: "worker" | "release_snapshot";
    attemptCount?: number;
    lastAttemptAt?: string;
    latestOutcome?: WorkerProbeOutcome;
    latestErrorCode?: string;
    latestHttpStatus?: number;
    latestDurationMs?: number;
  };
}

export type WorkerProbeOutcome =
  | "quote_verified"
  | "protocol_valid"
  | "quote_rejected"
  | "quote_invalid"
  | "reachable"
  | "unreachable"
  | "unsafe_url"
  | "error";

export interface FunnelStageViewModel {
  label: string;
  detail: string;
  count: string | null;
  share: string | null;
  provenance: ProvenanceKind | null;
}

export interface FunnelSectionViewModel {
  stages: FunnelStageViewModel[];
  citation: {
    artifact: string;
    sha256: string;
    blockNumber: string;
    generatedAt: string;
    scanDurationMs: number;
  };
}

export interface VerificationDriftViewModel {
  freshness: "current" | "stale";
  generatedAt: string;
  blockNumber: string;
  identityStatus: "match" | "mismatch" | "read_error";
  identityMismatchFields: Array<"owner" | "metadata_uri">;
  identityObservedAt: string;
  identityOnchainProvenance: "onchain" | "unavailable";
  walletAttribution?: {
    status: "unique" | "ambiguous" | "not_checked";
    candidateCount: number;
    candidateAgentIds: string[];
  };
  toolsStatus: "observed" | "not_probed";
  toolReachability: "verified" | "failed" | "not_probed";
  toolProbeOutcomes: string[];
  declaredOnlyTools: string[];
  observedOnlyTools: string[];
  toolsObservedAt: string | null;
}

// The hero's live ledger panel: indexed ERC-8183 Commerce state for BSC
// Mainnet, built on the server so every string (including relative ages) is
// fixed before the client component renders it. Counts are activity and
// indexed state, never a claim about the quality of any job.
export interface LedgerPulseJobViewModel {
  jobId: string;
  status: "OPEN" | "FUNDED" | "SUBMITTED" | "COMPLETED" | "REJECTED" | "EXPIRED";
  href: string;
  buyerShort: string;
  updatedAgo: string;
  marketplace: boolean;
}

export interface LedgerPulseViewModel {
  network: string;
  jobsIndexed: string;
  jobsIndexedCount: number;
  processedHere: string;
  indexedThrough: { blockNumber: string; ago: string } | null;
  window: { days: number; created: string; settled: string; refunded: string } | null;
  recent: LedgerPulseJobViewModel[];
}
