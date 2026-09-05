import type { HireActivity, HireAddress, HireChainId, HireJob, HireJobsScope, HireLedger, HireJobTotals } from "../entities/hire-job.ts";
import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";
import { providerIdentity } from "../../../shared/agent-identity.ts";

export interface AgentHireJobs {
  jobs: HireJob[];
  nextBefore: string | null;
  scope: HireJobsScope;
  totals?: HireJobTotals;
  activity: HireActivity | null;
}

export class ListAgentHireJobs {
  constructor(private readonly ledger: HireLedger) {}

  async execute(input: { agent: MarketplaceAgent; before?: string; chainId?: HireChainId }): Promise<AgentHireJobs | null> {
    const provider = providerWallet(input.agent);
    const chainId = input.chainId ?? input.agent.chainId;
    if (chainId !== input.agent.chainId && provider === null) return null;
    const scope: HireJobsScope = provider === null ? "agent" : "wallet";
    const filter = provider === null ? { chainId, agentId: input.agent.agentId } : { chainId, provider };
    const page = (async () => {
      try {
        return provider === null
          ? await this.ledger.listJobsByAgent({ chainId, agentId: input.agent.agentId, ...(input.before ? { before: input.before } : {}) })
          : await this.ledger.listJobsByProvider({ chainId, provider, ...(input.before ? { before: input.before } : {}) });
      } catch { return null; }
    })();
    // Optional activity shares network and identity scope, never the cursor.
    const activity = (async () => {
      try { return await this.ledger.activity(filter); } catch { return null; }
    })();
    const [jobs, window] = await Promise.all([page, activity]);
    return jobs === null ? null : {
      jobs: jobs.jobs, nextBefore: jobs.nextBefore, scope, activity: window,
      ...(jobs.totals ? { totals: jobs.totals } : {}),
    };
  }
}

export function providerWallet(agent: MarketplaceAgent): HireAddress | null {
  const identity = providerIdentity({ agentWallet: agent.onchainIdentity.agentWallet });
  return identity ? agent.onchainIdentity.agentWallet as HireAddress : null;
}
