import type {
  EndpointObservation,
  NormalizedEndpoint,
  NormalizedService,
  TrustScoreDimension,
} from "../../trust8004/types.ts";
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
  verification?: {
    freshness: "current" | "stale";
    generatedAt: string;
    staleAfter: string;
    blockNumber: string;
    selection: "curated" | "marketplace_operated" | "operator_explicit";
    operator: "third_party" | "marketplace";
    qualification: {
      status: "qualified" | "not_qualified" | "unavailable";
      observedAt: string;
      provenance: "derived:marketplace-seller-qualification";
    };
    identity: {
      status: "match" | "mismatch" | "read_error";
      mismatchFields: Array<"owner" | "metadata_uri">;
      observedAt: string;
      provenance: readonly ["declared", "onchain" | "unavailable"];
      walletAttribution?: {
        status: "unique" | "ambiguous" | "not_checked";
        candidateCount: number;
        candidateAgentIds: string[];
        provenance: "derived:marketplace-readiness";
      };
    };
    tools: {
      status: "observed" | "not_probed";
      probeOutcomes: Array<
        | "protocol_valid"
        | "no_tools"
        | "unauthorized"
        | "timeout"
        | "unsafe_url"
        | "http_error"
        | "protocol_error"
        | "not_probed"
      >;
      reachability: "verified" | "failed" | "not_probed";
      declaredOnly: string[];
      observedOnly: string[];
      observedAt: string | null;
    };
  } | null;
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
