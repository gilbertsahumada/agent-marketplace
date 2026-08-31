import type { MarketplaceCategory } from "./marketplace-agent.ts";

export const CATALOG_STATUSES = [
  "declared", "pending", "a2a", "mcp", "mcp_only", "erc8183", "quote_capable", "hireable", "failed",
] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

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
      && declaration.validationProtocol !== null;
  }
  // Legacy schema v1 has no normalized classification fields.
  return declaration.safety === "safe"
    && declaration.endpoint !== null
    && declaration.protocol !== "web";
}

export function isCatalogSellerDeclaration(declaration: CatalogCandidateDeclaration): boolean {
  const protocol = declaration.validationProtocol ?? declaration.protocol;
  return isCatalogOperationalDeclaration(declaration)
    && (protocol === "a2a" || protocol === "erc8183_http");
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
  chainId: 56;
  owner: string | null;
  metadataUri: string | null;
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  categories: MarketplaceCategory[];
  marketplaceConfigured: boolean;
  metadataState: "ok" | "http_unreachable" | "other";
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
    quoteStatus: "not_supported" | "not_requested" | "verified_fresh" | "verified_historical" | "rejected";
    buyerAction: "unavailable" | "check_availability" | "request_quote" | "prepare_hire";
    canRequestBrowserValidation: boolean;
    canRequestInfrastructureValidation: boolean;
    canRequestQuote: boolean;
    canPrepareHire: boolean;
    blockingReasons: string[];
  };
  declarations: CatalogCandidateDeclaration[];
  observations: CatalogCandidateObservation[];
}

export interface CatalogCandidatePage {
  status: CatalogStatus;
  statuses?: CatalogStatus[];
  query: string;
  category: MarketplaceCategory | null;
  categories?: MarketplaceCategory[];
  generatedAt: number;
  page: number;
  limit: number;
  total: number;
  nextCursor?: string | null;
  items: CatalogCandidate[];
}
