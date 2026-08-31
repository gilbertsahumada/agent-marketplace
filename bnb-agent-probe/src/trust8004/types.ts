export const BSC_CHAIN_ID = 56 as const;

export type CatalogTransport = "a2a" | "erc8183_http";
export type CatalogEndpointProtocol = CatalogTransport | "mcp" | "web";

export interface CatalogDeclaredEndpoint {
  transport: CatalogTransport;
  endpoint: string;
  source: "services" | "endpoints";
  sourceIndex: number;
}

export interface CatalogIndexEndpoint {
  protocol: CatalogEndpointProtocol;
  endpoint: string;
}

export interface CatalogAgent {
  chainId: typeof BSC_CHAIN_ID;
  agentId: string;
  name: string | null;
  description?: string | null;
  imageUrl?: string | null;
  registeredAt: number | null;
  metadataUpdatedAt: number | null;
  metadataAvailable: boolean;
  declarations: {
    a2a: boolean;
    erc8183: boolean;
  };
  declaredEndpoints: CatalogDeclaredEndpoint[];
  indexEndpoints?: CatalogIndexEndpoint[];
}

export interface InvalidCatalogItem {
  index: number;
  message: string;
}

export interface CatalogPage {
  items: CatalogAgent[];
  invalidItems: InvalidCatalogItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface LiveTargetCandidate {
  chainId: typeof BSC_CHAIN_ID;
  agentId: string;
  transport: CatalogTransport;
  endpoint: string;
}
