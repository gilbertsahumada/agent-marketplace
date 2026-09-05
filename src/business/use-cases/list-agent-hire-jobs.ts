import type { HireAddress, HireJob, HireJobsScope, HireLedger } from "../entities/hire-job.ts";
import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";

import { providerIdentity } from "../../../shared/agent-identity.ts";

export interface AgentHireJobs {
  jobs: HireJob[];
  // Cursor of the next (older) Worker page, null when this page is the last;
  // callers show that the list is capped, they do not page here.
  nextBefore: string | null;
  scope: HireJobsScope;
}

// Jobs sold by an agent, by its registry agent wallet when the marketplace
// knows it, otherwise only the jobs the
// marketplace itself recorded a chain-verified hire event for. An unavailable
// ledger yields null, never an error that hides the hire page and never an
// empty list that reads as "no jobs".
export class ListAgentHireJobs {
  constructor(private readonly ledger: HireLedger) {}

  async execute(input: { agent: MarketplaceAgent }): Promise<AgentHireJobs | null> {
    const provider = providerWallet(input.agent);
    const scope: HireJobsScope = provider === null ? "agent" : "wallet";
    try {
      const page = provider === null
        ? await this.ledger.listJobsByAgent({ chainId: input.agent.chainId, agentId: input.agent.agentId })
        : await this.ledger.listJobsByProvider({ chainId: input.agent.chainId, provider });
      if (page === null) return null;
      return { jobs: page.jobs, nextBefore: page.nextBefore, scope };
    } catch {
      return null;
    }
  }
}

export function providerWallet(agent: MarketplaceAgent): HireAddress | null {
  const identity = providerIdentity({ agentWallet: agent.onchainIdentity.agentWallet });
  return identity ? agent.onchainIdentity.agentWallet as HireAddress : null;
}
