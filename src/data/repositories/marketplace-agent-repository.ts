import type {
  EndpointObservation,
  NormalizedEndpoint,
  NormalizedService,
  TrustScoreDimension,
} from "../../trust8004/types.js";
import type { Address } from "viem";

export const MARKETPLACE_DATA_SORTS = ["newest", "reputation", "trust_score", "agent_id"] as const;
export type MarketplaceDataSort = typeof MARKETPLACE_DATA_SORTS[number];
export const DEFAULT_REGISTERED_AGENT_SORT: MarketplaceDataSort = "newest";

export interface MarketplaceAgentData {
  sourceDetail: "summary" | "profile";
  chainId: 56;
  agentId: string;
  name: string;
  description: string | null;
  owner: string | null;
  metadataUri: string | null;
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
  freshness: {
    fetchedAt: string;
    metadataUpdatedAt: string | null;
    indexedUpdatedAt: string | null;
  };
}

export interface MarketplaceAgentDataPage {
  items: MarketplaceAgentData[];
  total: number;
  limit: number;
  offset: number;
  fetchedAt: string;
  catalogCoverage: "partial";
}

export type OnchainIdentityData =
  | {
    status: "available";
    owner: Address;
    agentWallet: Address;
    metadataUri: string;
    registryAddress: Address;
    blockNumber: string;
    observedAt: string;
    error: null;
  }
  | {
    status: "unavailable";
    owner: null;
    agentWallet: null;
    metadataUri: null;
    registryAddress: Address | null;
    blockNumber: string | null;
    observedAt: string;
    error: { code: "ONCHAIN_IDENTITY_UNAVAILABLE"; message: string };
  };

export interface MarketplaceAgentRepository {
  listRegisteredPage(options: {
    page: number;
    limit: number;
    q?: string;
    sort?: MarketplaceDataSort;
  }): Promise<MarketplaceAgentDataPage>;
  getById(agentId: string): Promise<MarketplaceAgentData | null>;
  getOnchainIdentity(agentId: string): Promise<OnchainIdentityData>;
}
