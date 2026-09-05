import type { AgentReference, IndexedAgentIdentity, JobIdentityBatch, IdentityChainId } from "../../../shared/agent-identity.ts";

export interface AgentIdentityRepository {
  readForJobs(input: { chainId: IdentityChainId; jobIds: string[] }): Promise<JobIdentityBatch>;
}
export type JobAgentResolution = {
  status: "registered" | "wallet_match" | "ambiguous" | "stale" | "unmatched" | "unavailable";
  agents: AgentReference[];
  evidence: IndexedAgentIdentity[];
  coverage: "partial";
};
