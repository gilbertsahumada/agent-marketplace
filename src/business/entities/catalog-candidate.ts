import type { MarketplaceCategory } from "./marketplace-agent.ts";

export const CATALOG_STATUSES = [
  "declared", "pending", "a2a", "mcp", "erc8183", "quote_capable", "hireable", "failed",
] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export interface CatalogCandidateDeclaration {
  endpointKey: string;
  protocol: "a2a" | "mcp" | "web" | "erc8183_http";
  endpoint: string | null;
  originKey: string | null;
  safety: "safe" | "unsafe";
  safetyReason: string | null;
  representativeAgentKey: string | null;
  lastProbedAt: number | null;
  nextProbeAt: number;
  consecutiveFailures: number;
  priority: number;
}

export interface CatalogCandidateObservation {
  id: number;
  agentKey: string;
  endpointKey: string | null;
  protocol: "a2a" | "mcp" | "web" | "erc8183_http" | "erc8183";
  source: "browser_reported" | "marketplace_probe" | "worker_probe" | "chain_index";
  outcome: "protocol_valid" | "cors_blocked" | "http_error" | "timeout" | "network_error"
    | "invalid_response" | "unsafe_url" | "erc8183_detected" | "quote_verified"
    | "quote_rejected" | "unreachable" | "error";
  observedAt: number;
  expiresAt: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  durationMs: number;
  details: unknown;
}

export interface CatalogCandidate {
  agentKey: string;
  agentId: string;
  chainId: 56;
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
  declarations: CatalogCandidateDeclaration[];
  observations: CatalogCandidateObservation[];
}

export interface CatalogCandidatePage {
  status: CatalogStatus;
  query: string;
  category: MarketplaceCategory | null;
  generatedAt: number;
  page: number;
  limit: number;
  total: number;
  items: CatalogCandidate[];
}
