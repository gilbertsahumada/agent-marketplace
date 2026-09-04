import {
  isCatalogOperationalDeclaration,
  isCatalogOperationalObservation,
  type CatalogCandidate,
  type CatalogCandidateObservation,
  type CatalogCandidatePage,
} from "../../business/entities/catalog-candidate.ts";
import type { MarketplaceAgentData } from "../repositories/marketplace-agent-repository.ts";
import type { EndpointObservation } from "../../trust8004/types.ts";

export interface CatalogCandidatePageReader {
  execute(input: {
    page: number;
    limit: number;
    q?: string;
    category?: "rebalancing" | "grid_trading" | "yield_optimisation" | "health_factor_monitoring";
    categories?: Array<"rebalancing" | "grid_trading" | "yield_optimisation" | "health_factor_monitoring">;
    protocols?: Array<"a2a" | "mcp" | "erc8183_http">;
    reachability?: Array<"live" | "historical" | "never" | "browser_observed">;
    commerce?: Array<"declared" | "candidate" | "admitted" | "suspended" | "none">;
    quote?: Array<"verified" | "expired" | "missing">;
    latestFailure?: boolean;
    inventory?: "operational" | "registry";
    statuses?: Array<"declared" | "pending" | "a2a" | "mcp" | "mcp_only" | "erc8183" | "quote_capable" | "hireable" | "failed">;
  }): Promise<CatalogCandidatePage | null>;
}

export interface CatalogCandidateReader {
  execute(input: { agentId: string }): Promise<CatalogCandidate | null>;
}

const PLATFORM_SOURCES = new Set(["worker_probe", "buyer_refresh", "migration"]);

function latestPlatformObservation(candidate: CatalogCandidate): CatalogCandidateObservation | undefined {
  const observations = candidate.observations
    .filter((observation) => PLATFORM_SOURCES.has(observation.source)
      && (observation.validationKind === "reachability" || observation.validationKind === "protocol")
      && observation.verificationLevel === "platform_observed"
      && isCatalogOperationalObservation(candidate, observation))
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);
  const capableEndpointKey = candidate.state?.capabilityState === undefined
    ? candidate.admission?.endpointKey ?? null
    : candidate.state.capabilityEndpointKey ?? null;
  return (capableEndpointKey === null
    ? observations
    : observations.filter((observation) => observation.endpointKey === capableEndpointKey))[0]
    ?? observations[0];
}

function endpointObservation(candidate: CatalogCandidate): EndpointObservation {
  const observation = latestPlatformObservation(candidate);
  if (!observation) {
    return {
      status: "not_observed", protocol: null, endpoint: null, lastTestedAt: null,
      httpStatus: null, capabilitiesCount: 0, requiresAuth: null, error: null,
    };
  }
  const declaration = candidate.declarations.find(({ endpointKey }) => endpointKey === observation.endpointKey);
  return {
    status: observation.outcome === "protocol_valid" || observation.outcome === "quote_verified"
      ? "observed_ok" : "observed_failed",
    protocol: observation.protocol === "mcp" ? "mcp"
      : observation.protocol === "erc8183_http" ? "erc8183_http"
        : observation.protocol === "web" ? "web" : "a2a",
    endpoint: declaration?.endpoint ?? null,
    lastTestedAt: new Date(observation.observedAt).toISOString(),
    httpStatus: observation.httpStatus,
    capabilitiesCount: 0,
    requiresAuth: null,
    error: observation.outcome === "protocol_valid" || observation.outcome === "quote_verified"
      ? null : observation.errorCode ?? observation.outcome,
  };
}

/**
 * Builds the minimum repository shape when the catalog has an identity that
 * trust8004 cannot hydrate during the same request. The catalog remains the
 * evidence authority; missing enrichment is represented as unavailable data.
 */
export function catalogCandidateToMarketplaceAgentData(
  candidate: CatalogCandidate,
  fetchedAt = new Date().toISOString(),
): MarketplaceAgentData {
  const declarations = candidate.declarations
    .filter(isCatalogOperationalDeclaration)
    .filter(({ endpoint }) => endpoint !== null)
    .map(({ protocol, validationProtocol, endpoint }) => ({
      name: (validationProtocol ?? protocol).toUpperCase(),
      endpoint: endpoint!,
      version: null,
      tools: [],
      capabilities: [],
    }));
  return {
    sourceDetail: "profile",
    chainId: 56,
    agentId: candidate.agentId,
    name: candidate.name ?? `Agent #${candidate.agentId}`,
    description: candidate.description,
    ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
    owner: candidate.owner,
    metadataUri: candidate.metadataUri,
    services: declarations,
    endpoints: declarations.map(({ name, endpoint }) => ({ name, endpoint })),
    tools: [],
    capabilities: [],
    endpointObservation: endpointObservation(candidate),
    reputation: { totalFeedbacks: 0, averageScore: null, uniqueReviewers: null },
    trustScore: { total: null, tier: null, dimensions: {}, calculatedAt: null, expiresAt: null },
    freshness: {
      fetchedAt,
      metadataUpdatedAt: candidate.metadataObservedAt == null
        ? null : new Date(candidate.metadataObservedAt).toISOString(),
      indexedUpdatedAt: fetchedAt,
    },
    catalogCandidate: candidate,
  };
}

export function attachCatalogCandidate(
  data: MarketplaceAgentData,
  candidate: CatalogCandidate,
): MarketplaceAgentData {
  return { ...data, catalogCandidate: candidate };
}
