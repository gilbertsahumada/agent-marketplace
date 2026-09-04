import type { HireAddress, HireJob, HireJobsScope, HireLedger } from "../entities/hire-job.ts";
import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface AgentHireJobs {
  jobs: HireJob[];
  // Cursor of the next (older) Worker page, null when this page is the last;
  // callers show that the list is capped, they do not page here.
  nextBefore: string | null;
  scope: HireJobsScope;
}

// Jobs sold by an agent, by its registry wallet when the marketplace knows it
// (getAgentWallet, falling back to the owner), otherwise only the jobs the
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
        ? await this.ledger.listJobsByAgent({ chainId: 56, agentId: input.agent.agentId })
        : await this.ledger.listJobsByProvider({ chainId: 56, provider });
      if (page === null) return null;
      return { jobs: page.jobs, nextBefore: page.nextBefore, scope };
    } catch {
      return null;
    }
  }
}

export function providerWallet(agent: MarketplaceAgent): HireAddress | null {
  for (const candidate of [agent.onchainIdentity.agentWallet, agent.onchainIdentity.owner, agent.owner]) {
    if (candidate !== null && ADDRESS.test(candidate) && candidate.toLowerCase() !== ZERO_ADDRESS) {
      return candidate as HireAddress;
    }
  }
  return null;
}
