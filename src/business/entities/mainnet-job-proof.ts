export interface MainnetJobTransactionProof {
  hash: `0x${string}`;
  blockNumber: string;
  timestamp: string;
  gasUsed: string;
  effectiveGasPrice: string;
  gasCostWei: string;
  explorerUrl: string;
  provenance: "onchain:bsc-mainnet-rpc";
}

export interface MainnetJobProof {
  schemaVersion: 1;
  capturedAt: string;
  chainId: 56;
  agentId: string;
  jobId: string;
  buyer: `0x${string}`;
  seller: `0x${string}`;
  token: `0x${string}`;
  budgetRaw: string;
  finalState: "SUBMITTED" | "COMPLETED";
  deliverableHash: `0x${string}`;
  resultHashVerified: true;
  deterministicResultVerified: true;
  durationSeconds: string;
  totalGasCostWei: string;
  transactions: Record<string, MainnetJobTransactionProof>;
}
