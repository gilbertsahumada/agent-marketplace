import type { EndpointObservation, NormalizedEndpoint, NormalizedService, TrustScoreDimension } from "../../trust8004/types.js";

export const MARKETPLACE_CATEGORIES = [
  "rebalancing",
  "grid_trading",
  "yield_optimisation",
  "health_factor_monitoring",
] as const;

export type MarketplaceCategory = typeof MARKETPLACE_CATEGORIES[number];
export type EvidenceKind = "declared" | "observed" | "onchain" | "derived";

export interface EvidenceRecord {
  kind: EvidenceKind;
  source: "trust8004-public-api" | "marketplace-inventory" | "bsc-rpc";
  observedAt: string;
  verifiedDirectly: boolean;
  note: string;
}

export interface MarketplaceCategoryAssignment {
  category: MarketplaceCategory;
  evidence: EvidenceRecord;
}

export type HireabilityStatus =
  | "quote_verified"
  | "mcp_only"
  | "protocol_discovered"
  | "not_declared"
  | "not_evaluated";

export interface MarketplaceHireability {
  status: HireabilityStatus;
  canHire: boolean;
  reason: string;
  evidence: EvidenceRecord;
}

export interface MarketplaceAgent {
  chainId: 56;
  agentId: string;
  name: string;
  description: string | null;
  owner: string | null;
  metadataUri: string | null;
  indexedIdentity: {
    owner: string | null;
    metadataUri: string | null;
    evidence: EvidenceRecord;
  };
  onchainIdentity: {
    status: "not_requested" | "match" | "mismatch" | "unavailable";
    owner: string | null;
    agentWallet: string | null;
    metadataUri: string | null;
    registryAddress: string | null;
    blockNumber: string | null;
    observedAt: string | null;
    checks: {
      ownerMatches: boolean | null;
      metadataUriMatches: boolean | null;
    };
    error: { code: string; message: string } | null;
    evidence: EvidenceRecord | null;
  };
  categoryEvaluation: "evaluated" | "not_evaluated";
  categories: MarketplaceCategoryAssignment[];
  services: NormalizedService[];
  endpoints: NormalizedEndpoint[];
  tools: string[];
  capabilities: string[];
  endpointObservation: EndpointObservation;
  reputation: {
    totalFeedbacks: number;
    averageScore: number | null;
    uniqueReviewers: number | null;
  };
  trustScore: {
    total: number | null;
    tier: string | null;
    dimensions: Record<string, TrustScoreDimension>;
    calculatedAt: string | null;
    expiresAt: string | null;
  };
  hireability: MarketplaceHireability;
  freshness: {
    fetchedAt: string;
    metadataUpdatedAt: string | null;
    indexedUpdatedAt: string | null;
  };
  catalogCoverage: "partial";
  provenance: {
    identity: EvidenceRecord;
    services: EvidenceRecord;
    endpointObservation: EvidenceRecord;
    reputation: EvidenceRecord;
    trustScore: EvidenceRecord;
  };
}

export interface MarketplaceCategorySummary {
  category: MarketplaceCategory;
  count: number;
  status: "candidates" | "unverified";
}

export interface MarketplaceAgentPage {
  view: "all" | "marketplace";
  items: MarketplaceAgent[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  categories: MarketplaceCategorySummary[];
  catalogCoverage: "partial";
  fetchedAt: string;
}

export interface MarketplaceAgentComparison {
  agents: MarketplaceAgent[];
  winner: null;
  note: string;
  catalogCoverage: "partial";
  fetchedAt: string;
}
