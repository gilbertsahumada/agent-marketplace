import type { Address } from "viem";
import type { MarketplaceAgent, MarketplaceCategory } from "../trust8004/types.js";
import type { BscVerificationReport, VerificationError } from "../verification/types.js";

export type SellerTransport = "a2a" | "erc8183_http";
export type TransportSummary = SellerTransport | "multiple" | "mcp_only" | "none";
export type QuoteStatus = "verified" | "invalid" | "unavailable" | "not_requested" | "not_applicable";
export type HireabilityStatus =
  | "quote_verified"
  | "protocol_discovered"
  | "mcp_only"
  | "not_declared"
  | "unreachable"
  | "invalid_quote";

export interface QuoteEvidence {
  provider: Address;
  price: string;
  currency: Address;
  negotiationHash: `0x${string}`;
  signatureMethod: "eip191" | "erc1271";
  observedAt: string;
  provenance: "observed:erc8183-signed-quote";
}

export interface SellerProtocolVerification {
  transport: SellerTransport;
  endpoint: string;
  status: "quote_verified" | "protocol_valid" | "unreachable" | "unsafe_url" | "invalid_response";
  quoteStatus: Exclude<QuoteStatus, "not_applicable">;
  agentCardSkills: string[] | null;
  healthObserved: boolean | null;
  statusObserved: boolean | null;
  quote: QuoteEvidence | null;
  observedAt: string;
  provenance: "declared:trust8004-public-api+observed:marketplace-probe";
  error: VerificationError | null;
}

export interface HireabilityAssessment {
  transport: TransportSummary;
  declaredSellerProtocols: SellerTransport[];
  quoteStatus: QuoteStatus;
  hireability: HireabilityStatus;
  protocols: SellerProtocolVerification[];
  note: string;
  provenance: "derived:marketplace-readiness";
}

export interface ReadinessCandidate extends MarketplaceAgent {
  activation: HireabilityAssessment;
}

export interface TransactionEvidence {
  hash: `0x${string}`;
  status: "success" | "reverted";
  blockNumber: string;
  timestamp: string;
}

export interface OnchainTimestamp {
  unix: string;
  iso: string;
}

export interface Gate1Proof {
  status: "verified" | "mismatch" | "read_error";
  network: "bsc-testnet";
  chainId: 97;
  agentId: "1815";
  jobId: "514";
  expectedState: "SUBMITTED";
  observedState: string | null;
  buyer: Address | null;
  provider: Address | null;
  agentWallet: Address | null;
  paymentToken: Address | null;
  budget: string | null;
  deadline: OnchainTimestamp | null;
  submittedAt: OnchainTimestamp | null;
  deliverableHash: `0x${string}` | null;
  deliverableUrl: string | null;
  transactions: Record<string, TransactionEvidence>;
  checks: Record<string, boolean | null>;
  observedAt: string;
  provenance: "onchain:bsc-testnet-rpc";
  error: VerificationError | null;
}

export interface BscMarketplaceReadinessReport {
  schemaVersion: 1;
  generatedAt: string;
  catalog: {
    chainId: 56;
    source: "trust8004";
    coverage: "partial";
  };
  verification: BscVerificationReport;
  categories: Record<MarketplaceCategory, {
    status: "candidates" | "unverified";
    agentIds: string[];
    quoteVerifiedAgentIds: string[];
    note: string;
  }>;
  candidates: ReadinessCandidate[];
  activationCoverage: {
    status: "none" | "partial" | "complete";
    quoteVerifiedAgents: number;
    quoteVerifiedCategories: number;
    requiredCategories: number;
  };
  buyerProof: Gate1Proof;
  frontendReady: boolean;
  blockers: string[];
  warnings: string[];
}
