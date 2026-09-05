import { IDENTITY_BATCH_LIMIT, IDENTITY_FRESHNESS_MS, IDENTITY_REGISTRIES } from "../../../shared/agent-identity.ts";
import type { AgentIdentityRepository, JobAgentResolution } from "../entities/job-agent-resolution.ts";
import type { HireJob } from "../entities/hire-job.ts";

export const unavailableJobAgent = (): JobAgentResolution => ({ status: "unavailable", agents: [], evidence: [], coverage: "partial" });

/** One resolver for list/detail/API consumers. Identity failure never hides jobs. */
export class ResolveJobAgents {
  constructor(private readonly identities: AgentIdentityRepository, private readonly now = Date.now) {}

  async execute(jobs: readonly Pick<HireJob, "chainId" | "jobId" | "provider">[]): Promise<Record<string, JobAgentResolution>> {
    const result: Record<string, JobAgentResolution> = {};
    for (const chainId of [56, 97] as const) {
      const scoped = [...new Map(jobs.filter(job => job.chainId === chainId).map(job => [job.jobId, job])).values()];
      for (let offset = 0; offset < scoped.length; offset += IDENTITY_BATCH_LIMIT) {
        const batch = scoped.slice(offset, offset + IDENTITY_BATCH_LIMIT);
        for (const job of batch) result[`${chainId}:${job.jobId}`] = unavailableJobAgent();
        try {
          const response = await this.identities.readForJobs({ chainId, jobIds: batch.map(job => job.jobId) });
          if (response.chainId !== chainId) continue;
          const evidenceByJob = new Map(response.jobs.map(entry => [entry.jobId, entry]));
          for (const job of batch) {
            const evidence = evidenceByJob.get(job.jobId);
            if (!evidence || evidence.provider.toLowerCase() !== job.provider.toLowerCase()) continue;
            const sameRegistry = (agent: { chainId: number; registryAddress: string }) =>
              agent.chainId === chainId && agent.registryAddress.toLowerCase() === IDENTITY_REGISTRIES[chainId];
            const registered = [...new Map(evidence.registered.filter(item => sameRegistry(item.agent))
              .map(item => [item.agent.agentId, item.agent])).values()];
            const candidates = evidence.candidates.filter(item => sameRegistry(item)
              && item.wallet.toLowerCase() === job.provider.toLowerCase());
            const fresh = candidates.filter(item => item.observedAt <= this.now()
              && this.now() - item.observedAt <= IDENTITY_FRESHNESS_MS);
            const agents = registered.length ? registered : candidates;
            const status = registered.length ? (registered.length > 1 ? "ambiguous" : "registered")
              : evidence.candidatesTruncated || candidates.length > 1 ? "ambiguous"
                : fresh.length ? "wallet_match" : candidates.length ? "stale" : "unmatched";
            result[`${chainId}:${job.jobId}`] = { status, agents, evidence: candidates, coverage: "partial" };
          }
        } catch { /* Separate failure from an empty, successfully read index. */ }
      }
    }
    return result;
  }
}
