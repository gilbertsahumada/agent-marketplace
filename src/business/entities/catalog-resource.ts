import type { CatalogCandidatePage, CatalogFacetCounts } from "./catalog-candidate.ts";
import type { MarketplaceAgentPage } from "./marketplace-agent.ts";

export type CatalogReadError = { kind: "timeout" | "network" | "upstream" | "invalid_response" | "unavailable"; status?: number };
export type CatalogReadResult<T> = { ok: true; data: T } | { ok: false; error: CatalogReadError };
export type CatalogResourceMap = { results: { catalog?: CatalogCandidatePage; data?: MarketplaceAgentPage; provenAgentId?: string }; facets: CatalogFacetCounts; scopes: { hiring?: number; evaluation?: number } };
export type CatalogResourceName = keyof CatalogResourceMap;
export type CatalogResources = { [K in CatalogResourceName]: Promise<CatalogReadResult<CatalogResourceMap[K]>> };
