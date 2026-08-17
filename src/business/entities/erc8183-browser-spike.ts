import type { Address, Hash } from "viem";

export const ERC8183_SPIKE_CHAIN_ID = 97 as const;
export const ERC8183_SPIKE_AGENT_ID = 1815 as const;
export const ERC8183_SPIKE_MAX_BUDGET = 1n;

export type Erc8183QuoteEnvelope = Record<string, unknown>;

export interface NormalizedErc8183Quote {
  envelope: Erc8183QuoteEnvelope;
  agentId: typeof ERC8183_SPIKE_AGENT_ID;
  chainId: typeof ERC8183_SPIKE_CHAIN_ID;
  provider: Address;
  endpoint: string;
  commerce: Address;
  router: Address;
  policy: Address;
  token: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  priceRaw: string;
  priceDisplay: string;
  negotiatedAt: number;
  quoteExpiresAt: number;
  description: string;
}

export interface Erc8183BuyerFacts {
  buyer: Address;
  nativeBalanceRaw: string;
  tokenBalanceRaw: string;
  allowanceRaw: string;
  disputeWindowSeconds: string;
  policyAllowlisted: boolean;
}

export type Erc8183TransactionKind =
  | "createJob"
  | "registerJob"
  | "setBudget"
  | "approve"
  | "fund";

export interface Erc8183TransactionIntent {
  kind: Erc8183TransactionKind;
  contract: Address;
  purpose: string;
  required: boolean;
}

export interface Erc8183HirePlan {
  quote: NormalizedErc8183Quote;
  buyer: Address;
  seller: Address;
  nativeBalanceRaw: string;
  tokenBalanceRaw: string;
  allowanceRaw: string;
  approvalRequired: boolean;
  approvalAmountRaw: string;
  deadline: string;
  executeBefore: number;
  maximumSignatures: 4 | 5;
  transactions: Erc8183TransactionIntent[];
}

export interface Erc8183JobFacts {
  chainId: typeof ERC8183_SPIKE_CHAIN_ID;
  jobId: string;
  buyer: Address;
  provider: Address;
  evaluator: Address;
  policy: Address;
  description: string;
  budgetRaw: string;
  deadline: string;
  status: "OPEN" | "FUNDED" | "SUBMITTED" | "COMPLETED" | "REJECTED" | "EXPIRED";
  submittedAt: string;
  deliverableHash: Hash;
  deliverableUrl: string | null;
  result: {
    content: string;
    contentType: string | null;
    hashVerified: true;
  } | null;
  quotedToken: Address | null;
  quotedPriceRaw: string | null;
  quoteExpiresAt: number | null;
}

export interface NotifyFundedResult {
  acknowledged: true;
  alreadySubmitted: boolean;
  job: Erc8183JobFacts;
}

export type Erc8183JournalStep =
  | "connected"
  | "created"
  | "registered"
  | "budgeted"
  | "approved"
  | "funded"
  | "notified"
  | "submitted";

export interface Erc8183BrowserJournal {
  schemaVersion: 1;
  chainId: typeof ERC8183_SPIKE_CHAIN_ID;
  buyer: Address;
  seller: Address;
  jobId: string | null;
  transactions: Partial<Record<Erc8183TransactionKind, Hash>>;
  lastConfirmedStep: Erc8183JournalStep;
}
