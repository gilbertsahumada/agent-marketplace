export type EvmAddressRecord = `0x${string}`;
export type TransactionHashRecord = `0x${string}`;

export type Gate1TransactionPhase =
  | "createJob"
  | "registerJob"
  | "setBudget"
  | "approve"
  | "fund"
  | "submit";

export interface PublicProofTimestampRecord {
  unix: string;
  iso: string;
}

export interface PublicProofTransactionSnapshotRecord {
  hash: TransactionHashRecord;
  status: "success";
  blockNumber: string;
  timestamp: string;
  explorerUrl: string;
  provenance: "onchain:bsc-testnet";
}

export interface PublicJobProofSnapshotRecord {
  schemaVersion: 1;
  source: "snapshot:gate1-job-514" | "snapshot:gate6a-job-551";
  recordedAt: string;
  network: "bsc-testnet";
  chainId: 97;
  jobId: string;
  sellerAgentId: string;
  buyer: EvmAddressRecord;
  seller: EvmAddressRecord;
  sellerEndpoint?: string;
  contracts?: {
    identityRegistry: EvmAddressRecord;
    commerce: EvmAddressRecord;
    router: EvmAddressRecord;
    policy: EvmAddressRecord;
  };
  payment: {
    token: EvmAddressRecord;
    symbol: string;
    decimals: 18;
    budgetRaw: "1";
    budgetFormatted?: string;
  };
  quote?: {
    negotiationHash: TransactionHashRecord;
    negotiatedAt: string;
    expiresAt: string;
    signatureVerified: true;
  };
  lifecycle: {
    expectedState: "SUBMITTED";
    deadline: PublicProofTimestampRecord;
    submittedAt: PublicProofTimestampRecord;
  };
  deliverable: {
    hash: TransactionHashRecord;
    receipt: "deterministic-text";
    availability: "hash_only" | "public_hash_verified";
    note: string;
    url?: string;
    contentType?: string;
    content?: string;
    hashVerified?: true;
  };
  transactions: Record<Gate1TransactionPhase, PublicProofTransactionSnapshotRecord>;
  fixture: {
    testInfrastructure: true;
    marketplaceAgent: false;
    officialReferenceAgent: false;
  };
  custody?: {
    buyerWallet: "injected-eip1193";
    buyerPrivateKeyReceivedByServer: false;
    sellerKeyStorage: "server-side-sensitive-environment-variable";
  };
}

export interface PublicProofLiveTransactionRecord {
  hash: TransactionHashRecord;
  status: "success" | "reverted";
  blockNumber: string;
  timestamp: string;
}

export interface PublicJobProofLiveEvidenceRecord {
  status: "verified" | "mismatch" | "unavailable";
  source: "onchain:bsc-testnet-rpc";
  observedAt: string;
  observedState: string | null;
  buyer: EvmAddressRecord | null;
  seller: EvmAddressRecord | null;
  agentWallet: EvmAddressRecord | null;
  paymentToken: EvmAddressRecord | null;
  budgetRaw: string | null;
  deadline: PublicProofTimestampRecord | null;
  submittedAt: PublicProofTimestampRecord | null;
  deliverableHash: TransactionHashRecord | null;
  transactions: Partial<Record<Gate1TransactionPhase, PublicProofLiveTransactionRecord>>;
  checks: Record<string, boolean | null>;
  error: { code: string; message: string } | null;
}

export interface PublicJobProofRecord {
  schemaVersion: 1;
  snapshot: PublicJobProofSnapshotRecord;
  live: PublicJobProofLiveEvidenceRecord;
}

export interface PublicJobProofRepository {
  findByJobId(jobId: string): Promise<PublicJobProofRecord | null>;
  findSnapshotByJobId(jobId: string): Promise<PublicJobProofSnapshotRecord | null>;
}
