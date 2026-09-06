import type { MarketplaceCategory } from "./marketplace-agent.ts";

export const CATALOG_STATUSES = [
  "declared", "pending", "a2a", "mcp", "mcp_only", "erc8183", "quote_capable", "hireable", "failed", "requestable", "quote_failed", "completed_jobs",
] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export interface CatalogFacetCounts {
  statuses: Record<Exclude<CatalogStatus, "requestable" | "quote_failed" | "completed_jobs">, number> & Partial<Record<"requestable" | "quote_failed" | "completed_jobs", number>>;
  protocols?: Partial<Record<"a2a" | "mcp" | "erc8183_http", number>>;
  categories: Record<MarketplaceCategory, number>;
  /** Reachability facets are optional while older catalog feeds roll forward. */
  reachability?: {
    live: number;
    historical: number;
    never: number;
    browser_observed: number;
  };
}

export interface CatalogCandidateDeclaration {
  endpointKey: string;
  protocol: "a2a" | "mcp" | "web" | "erc8183_http";
  /** Normalized v2 classification; absent only on legacy compatibility feeds. */
  declaredProtocol?: "a2a" | "mcp" | "web" | "erc8183_http" | "x402" | "unknown";
  role?: "operational" | "external";
  validationProtocol?: "a2a" | "mcp" | "erc8183_http" | null;
  externalKind?: "website" | "social" | "repository" | "documentation" | "other" | null;
  eligibility?: "eligible" | "unsafe" | "invalid_declaration" | "unsupported";
  endpoint: string | null;
  originKey: string | null;
  safety: "safe" | "unsafe";
  safetyReason: string | null;
  representativeAgentKey: string | null;
  lastProbedAt: number | null;
  nextProbeAt: number | null;
  consecutiveFailures: number;
  priority: number;
}

export function isCatalogOperationalDeclaration(declaration: CatalogCandidateDeclaration): boolean {
  if (declaration.role !== undefined || declaration.eligibility !== undefined
    || declaration.validationProtocol !== undefined) {
    return declaration.role === "operational"
      && declaration.eligibility === "eligible"
      && declaration.validationProtocol !== null
      && declaration.safety === "safe"
      && declaration.endpoint !== null;
  }
  // Legacy schema v1 has no normalized classification fields.
  return declaration.safety === "safe"
    && declaration.endpoint !== null
    && declaration.protocol !== "web";
}

export function isCatalogSellerDeclaration(declaration: CatalogCandidateDeclaration): boolean {
  const protocol = declaration.validationProtocol ?? declaration.protocol;
  return isCatalogOperationalDeclaration(declaration)
    && (protocol === "a2a" || protocol === "mcp" || protocol === "erc8183_http");
}

export interface CatalogCandidateObservation {
  id: number;
  agentKey: string;
  endpointKey: string | null;
  protocol: "a2a" | "mcp" | "web" | "erc8183_http" | "erc8183";
  source: "browser_reported" | "worker_probe" | "buyer_refresh" | "chain_read" | "migration"
    | "marketplace_probe" | "chain_index";
  outcome: "protocol_valid" | "cors_blocked" | "http_error" | "timeout" | "network_error"
    | "invalid_response" | "unsafe_url" | "erc8183_detected" | "quote_verified"
    | "quote_rejected" | "unreachable" | "error";
  observedAt: number;
  expiresAt: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  durationMs: number;
  details: unknown;
  /** Present on normalized v2 rows; omitted by the legacy compatibility feed. */
  validationKind?: "reachability" | "protocol" | "quote" | "chain";
  verificationLevel?: "user_observed" | "platform_observed" | "cryptographic" | "onchain";
  artifactHash?: string | null;
}

export interface CatalogCandidate {
  agentKey: string;
  agentId: string;
  chainId: 56 | 97;
  owner: string | null;
  metadataUri: string | null;
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  categories: MarketplaceCategory[];
  marketplaceConfigured: boolean;
  metadataState: "ok" | "http_unreachable" | "other";
  /** Hash/version of the metadata document used for this normalized row. */
  metadataVersion?: string | null;
  /** Timestamp at which the metadata document was observed by the indexer. */
  metadataObservedAt?: number | null;
  registeredAt: number | null;
  blockNumber: string | null;
  priority: number;
  platformAttemptCount?: number;
  admission?: {
    state: "candidate" | "admitted" | "suspended";
    endpointKey: string | null;
  } | null;
  state?: {
    operationalStatus: "pending" | "browser_observed" | "platform_reachable" | "platform_failed"
      | "invalid_declaration" | "unsafe" | "unsupported";
    freshness: "never" | "live" | "historical" | "stale";
    commerceStatus: "none" | "declared" | "admission_pending" | "admitted" | "suspended";
    capabilityState?: "unsupported" | "discovered" | "ready" | "stale" | "failed" | "suspended";
    compatibilityState?: "pending" | "compatible" | "unsupported" | "unavailable";
    compatibilityCheckedAt?: number | null;
    compatibilityExpiresAt?: number | null;
    compatibilityErrorCode?: string | null;
    schemaHash?: string | null;
    /** Endpoint and transport currently selected by the capability ledger. */
    capabilityEndpointKey?: string | null;
    capabilityTransport?: "a2a" | "mcp" | "erc8183_http" | null;
    capabilityLastAttemptAt?: number | null;
    capabilityLastErrorCode?: string | null;
    capabilityExpiresAt?: number | null;
    quoteStatus: "not_supported" | "not_requested" | "verified_fresh" | "verified_historical" | "rejected";
    buyerAction: "unavailable" | "check_availability" | "request_quote" | "prepare_hire";
    canRequestBrowserValidation: boolean;
    canRequestInfrastructureValidation: boolean;
    canRequestQuote: boolean;
    canPrepareHire: boolean;
    quoteRequestCount?: number;
    quoteSuccessCount?: number;
    lastQuoteAttemptAt?: number | null;
    jobCount?: number;
    completedJobCount?: number;
    fundedJobCount?: number;
    submittedJobCount?: number;
    blockingReasons: string[];
  };
  declarations: CatalogCandidateDeclaration[];
  observations: CatalogCandidateObservation[];
}

export function isCatalogOperationalObservation(
  candidate: Pick<CatalogCandidate, "declarations">,
  observation: Pick<CatalogCandidateObservation, "endpointKey">,
): boolean {
  // Legacy observations may not have an endpoint key. Keep them readable
  // during the compatibility window; normalized v2 evidence is always scoped.
  if (observation.endpointKey === null) {
    return !candidate.declarations.some(({ role, eligibility, validationProtocol }) =>
      role !== undefined || eligibility !== undefined || validationProtocol !== undefined);
  }
  const declaration = candidate.declarations.find(({ endpointKey }) => endpointKey === observation.endpointKey);
  return declaration !== undefined && isCatalogOperationalDeclaration(declaration);
}

export interface CatalogCandidatePage {
  chainId?: 56 | 97;
  coverage?: {
    chainId: 56 | 97;
    catalogDiscovery: "enabled" | "not_configured";
    quoteExecution: "enabled" | "not_configured";
  };
  status: CatalogStatus;
  statuses?: CatalogStatus[];
  query: string;
  category: MarketplaceCategory | null;
  categories?: MarketplaceCategory[];
  generatedAt: number;
  page: number;
  limit: number;
  total: number;
  facets?: CatalogFacetCounts;
  nextCursor?: string | null;
  items: CatalogCandidate[];
}
