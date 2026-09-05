// A hire lifecycle phase the observation Worker stored only after verifying
// it on chain: successful receipt to the pinned Commerce contract, a matching
// Commerce event for the job, compatible job state, and the job's provider
// equal to the ERC-8004 registry wallet (or owner) of the agent. It proves a
// phase happened for an agent; it says nothing about deliverable verification.
export const HIRE_PHASES = ["created", "funded", "submitted", "settled", "refunded"] as const;
export type VerifiedHirePhase = (typeof HIRE_PHASES)[number];

export interface VerifiedHireEvent {
  chainId: 56 | 97;
  agentId: string;
  phase: VerifiedHirePhase;
  jobId: string;
  txHash: `0x${string}`;
  blockNumber: string;
  occurredAt: string;
  verifiedAt: string | null;
}

export interface VerifiedHireEventReader {
  listByAgent(input: { chainId: 56 | 97; agentId: string }): Promise<VerifiedHireEvent[] | null>;
}
