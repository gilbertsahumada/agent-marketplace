import type { Address } from "viem";
import type { MarketplaceAgent, MarketplaceCategory } from "../trust8004/types.ts";
import type { BscVerificationReport, VerificationError } from "../verification/types.ts";

export type SellerTransport = "a2a" | "erc8183_http";
export type TransportSummary = SellerTransport | "multiple" | "mcp_only" | "none";
export type QuoteStatus = "verified" | "expired" | "invalid" | "unavailable" | "not_requested" | "not_applicable";
export type HireabilityStatus =
  | "quote_verified"
  | "protocol_discovered"
  | "mcp_only"
  | "not_declared"
  | "unreachable"
  | "probe_incomplete"
  | "expired_quote"
  | "invalid_quote";

export interface OnchainTimestamp {
  unix: string;
  iso: string;
}

export interface QuoteEvidence {
  provider: Address;
  price: string;
  currency: Address;
  verifyingContract: Address;
  contractContext: {
    configuredContracts: {
      chainId: 56;
      commerce: Address;
      router: Address;
      policy: Address;
      provenance: "configured:bnbagent-sdk@0.5.0:bsc-mainnet";
    };
    onchainChecks: {
      paymentToken: Address;
      policyAllowlisted: true;
      blockNumber: string;
      blockTimestamp: OnchainTimestamp;
      observedAt: string;
      provenance: "onchain:bsc-mainnet-rpc";
    };
  };
  negotiationHash: `0x${string}`;
  signatureMethod: "eip191" | "erc1271";
  negotiatedAt: number;
  quoteExpiresAt: number;
  observedAt: string;
  provenance: "observed:erc8183-signed-quote";
}

export interface SellerProtocolVerification {
  transport: SellerTransport;
  endpoint: string;
  status: "quote_verified" | "quote_expired" | "protocol_valid" | "unreachable" | "unsafe_url" | "invalid_response" | "not_probed";
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
  probe: {
    totalDeclaredEndpoints: number;
    evaluatedEndpoints: number;
    skippedEndpoints: number;
    truncated: boolean;
  };
  note: string;
  provenance: "derived:marketplace-readiness";
}

export interface ReadinessCandidate extends Omit<MarketplaceAgent, "categories"> {
  categories: MarketplaceCategory[];
  profileDerivedCategories: MarketplaceAgent["categories"];
  activation: HireabilityAssessment;
  selection: "curated" | "marketplace_operated" | "operator_explicit";
  qualification: {
    status: "qualified" | "not_qualified" | "unavailable";
    reasons: Array<
      | "IDENTITY_NOT_VERIFIED"
      | "IDENTITY_UNAVAILABLE"
      | "SELLER_PROTOCOL_NOT_DECLARED"
      | "SELLER_PROTOCOL_UNAVAILABLE"
      | "SELLER_PROBE_INCOMPLETE"
      | "QUOTE_EXPIRED"
      | "QUOTE_NOT_VERIFIED"
    >;
    provenance: "derived:marketplace-seller-qualification";
  };
}

export interface TransactionEvidence {
  hash: `0x${string}`;
  status: "success" | "reverted";
  blockNumber: string;
  timestamp: string;
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
  schemaVersion: 3;
  generatedAt: string;
  catalog: {
    chainId: 56;
    source: "trust8004";
    coverage: "partial";
  };
  verification: BscVerificationReport;
  selection: {
    curatedAgentIds: string[];
    marketplaceOperatedAgentIds: string[];
    explicitAgentIds: string[];
    evaluatedAgentIds: string[];
  };
  categories: Record<MarketplaceCategory, {
    status: "candidates" | "unverified";
    agentIds: string[];
    quoteVerifiedAgentIds: string[];
    qualifiedAgentIds: string[];
    note: string;
  }>;
  candidates: ReadinessCandidate[];
  activationCoverage: {
    status: "none" | "partial" | "complete";
    quoteVerifiedAgents: number;
    quoteVerifiedAgentIds: string[];
    qualifiedSellerAgentIds: string[];
    qualifiedCuratedAgentIds: string[];
    quoteVerifiedCategories: number;
    requiredCategories: number;
  };
  sellerQualification: {
    status: "passed" | "pending_no_qualified_seller" | "attention_required";
    qualifiedAgentIds: string[];
    note: string;
  };
  buyerProof: Gate1Proof;
  frontendReady: boolean;
  blockers: string[];
  warnings: string[];
}
