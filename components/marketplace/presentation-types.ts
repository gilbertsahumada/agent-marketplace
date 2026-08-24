export type MarketplaceCategory =
  | "rebalancing"
  | "grid_trading"
  | "yield_optimisation"
  | "health_factor_monitoring";

export type ProvenanceKind = "declared" | "observed" | "onchain" | "derived" | "not_probed";

export type EvidenceKind = "declared" | "reachable" | "quote" | "job";

export type EvidenceStatus = "verified" | "current" | "unavailable" | "unknown";

export interface EvidenceStepViewModel {
  kind: EvidenceKind;
  label: string;
  status: EvidenceStatus;
  provenance: ProvenanceKind;
  detail: string;
  source?: string;
  timestamp?: string;
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
  operator: "third_party" | "marketplace";
  categories: MarketplaceCategory[];
  href: string;
  hireability: "hireable" | "mcp_only" | "listed_only";
  evidence: EvidenceStepViewModel[];
  trustScore?: number;
  verification?: VerificationDriftViewModel | null;
}

export interface VerificationDriftViewModel {
  freshness: "current" | "stale";
  generatedAt: string;
  blockNumber: string;
  identityStatus: "match" | "mismatch" | "read_error";
  identityMismatchFields: Array<"owner" | "metadata_uri">;
  identityObservedAt: string;
  toolsStatus: "observed" | "not_probed";
  declaredOnlyTools: string[];
  observedOnlyTools: string[];
  toolsObservedAt: string | null;
}
