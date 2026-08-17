export type MarketplaceCategory =
  | "rebalancing"
  | "grid_trading"
  | "yield_optimisation"
  | "health_factor_monitoring";

export type ProvenanceKind = "declared" | "observed" | "onchain" | "derived";

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
  categories: MarketplaceCategory[];
  href: string;
  hireability: "hireable" | "mcp_only" | "listed_only";
  evidence: EvidenceStepViewModel[];
  trustScore?: number;
}
