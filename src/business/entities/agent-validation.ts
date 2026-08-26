import type { Address } from "viem";
import type { AgentEvidencePassport } from "./evidence-passport.js";

export type AgentValidationEndpointStatus = "verified" | "failed" | "not_probed";

export interface AgentValidationEndpointCheck {
  protocol: "mcp" | "a2a" | "erc8183_http";
  status: AgentValidationEndpointStatus;
  declaredTools: string[];
  observedTools: string[];
  declaredOnlyTools: string[];
  observedOnlyTools: string[];
  observedAt: string | null;
  error: { code: string; message: string } | null;
}

export interface AgentValidationEvidence {
  chainId: 56;
  agent: {
    agentId: string;
    name: string;
    description: string | null;
    owner: string;
    metadataUri: string | null;
    operator: "third_party" | "marketplace";
    indexedAt: string;
    declaredServices: Array<{ name: string; hasEndpoint: boolean; tools: string[] }>;
  };
  identity: {
    status: "match" | "mismatch" | "read_error";
    ownerMatches: boolean | null;
    metadataUriMatches: boolean | null;
    agentWallet: Address | null;
    registryAddress: Address;
    blockNumber: string;
    observedAt: string;
    error: { code: string; message: string } | null;
  };
  endpointChecks: AgentValidationEndpointCheck[];
  quote: {
    status: "verified" | "expired" | "invalid" | "unavailable" | "not_requested";
    provider: Address | null;
    currency: Address | null;
    priceRaw: string | null;
    expiresAt: string | null;
    observedAt: string | null;
  };
  generatedAt: string;
}

export interface AgentValidationReport {
  schemaVersion: 1;
  chainId: 56;
  status: "complete" | "attention_required";
  generatedAt: string;
  agent: AgentValidationEvidence["agent"];
  classification: {
    status: "not_assigned";
    categories: [];
    note: string;
  };
  promotion: {
    status: "manual_review_required";
    note: string;
  };
  qualification: {
    status: "quote_verified_candidate" | "not_qualified";
    canHire: false;
    note: string;
  };
  evidence: {
    identity: AgentValidationEvidence["identity"];
    endpointChecks: AgentValidationEndpointCheck[];
    quote: AgentValidationEvidence["quote"];
  };
  passport: AgentEvidencePassport;
}
