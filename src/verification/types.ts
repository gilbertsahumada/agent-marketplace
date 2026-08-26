import type { Address } from "viem";
import type { MarketplaceCategory } from "../trust8004/types.ts";

export type IdentityVerificationStatus = "match" | "mismatch" | "read_error";
export type McpVerificationStatus =
  | "protocol_valid"
  | "no_tools"
  | "unauthorized"
  | "timeout"
  | "unsafe_url"
  | "http_error"
  | "protocol_error"
  | "not_probed";

export interface VerificationError {
  code: string;
  message: string;
}

export interface OnchainIdentity {
  owner: Address;
  agentWallet: Address;
  metadataUri: string;
}

export interface IdentityVerification {
  status: IdentityVerificationStatus;
  declared: {
    owner: string;
    metadataUri: string | null;
    provenance: "declared:trust8004-public-api";
  };
  onchain: {
    owner: Address | null;
    agentWallet: Address | null;
    metadataUri: string | null;
    registryAddress: Address;
    blockNumber: string;
    provenance: "onchain:bsc-rpc";
  };
  checks: {
    ownerMatches: boolean | null;
    metadataUriMatches: boolean | null;
  };
  observedAt: string;
  error: VerificationError | null;
}

export interface McpEndpointVerification {
  status: McpVerificationStatus;
  endpoint: string;
  protocol: "mcp";
  declaredTools: string[];
  observedTools: string[];
  comparison: {
    matched: string[];
    declaredOnly: string[];
    observedOnly: string[];
  };
  negotiatedProtocolVersion: string | null;
  serverInfo: { name: string; version: string } | null;
  latencyMs: number | null;
  observedAt: string | null;
  provenance:
    | "observed:mcp-tools-list"
    | "declared:trust8004-public-api+derived:probe-budget";
  error: VerificationError | null;
}

export interface AgentVerification {
  agentId: string;
  name: string;
  categories: MarketplaceCategory[];
  identity: IdentityVerification;
  mcpEndpoints: McpEndpointVerification[];
  hireability: "not_assessed";
}

export interface BscVerificationReport {
  schemaVersion: 2;
  generatedAt: string;
  chainId: 56;
  catalog: {
    source: "trust8004";
    coverage: "partial";
    snapshotGeneratedAt: string;
  };
  onchain: {
    network: "bsc-mainnet";
    registryAddress: Address;
    blockNumber: string;
  };
  categories: Record<MarketplaceCategory, {
    status: "candidates" | "unverified";
    agentIds: string[];
    note: string;
  }>;
  summary: {
    status: "complete" | "attention_required";
    agentsTotal: number;
    identityMatches: number;
    identityAttention: number;
    endpointsTotal: number;
    endpointsValid: number;
    endpointsNotProbed: number;
    endpointAttention: number;
    agentsWithoutMcpEndpoint: number;
    toolDriftEndpoints: number;
  };
  agents: AgentVerification[];
}
