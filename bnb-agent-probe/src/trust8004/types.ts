export const BSC_CHAIN_ID = 56 as const;

export type CatalogTransport = "a2a" | "erc8183_http";
export type CatalogEndpointProtocol = CatalogTransport | "mcp" | "x402" | "web" | "unknown";
export type CatalogEndpointSource = "services" | "endpoints" | "shortcut";

export interface CatalogDeclaredEndpoint {
  transport: CatalogTransport;
  endpoint: string;
  source: "services" | "endpoints";
  sourceIndex: number;
}

export interface CatalogIndexEndpoint {
  protocol: CatalogEndpointProtocol;
  endpoint: string;
  rawProtocol?: string | null;
  source?: CatalogEndpointSource;
  sourceIndex?: number;
}

export interface CatalogAgent {
  chainId: typeof BSC_CHAIN_ID;
  agentId: string;
  /** Identity and URI as declared by the trust8004 public catalog. */
  owner: string | null;
  metadataUri: string | null;
  blockNumber: string | null;
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
