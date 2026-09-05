import type { HireActivity, HireAddress, HireJob, HireJobsScope, HireLedger } from "../entities/hire-job.ts";
import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ACTIVITY_DAYS = 30;

export interface AgentHireJobs {
  jobs: HireJob[];
  // Cursor of the next (older) Worker page, null when this page is the last;
  // callers show that the list is capped, they do not page here.
  nextBefore: string | null;
  scope: HireJobsScope;
  // Phase events over the last 30 days in the same scope; null when that
  // window could not be read, which never hides the jobs.
  activity: HireActivity | null;
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
    const activity = this.activity(provider, input.agent.agentId);
    try {
      const page = provider === null
        ? await this.ledger.listJobsByAgent({ chainId: 56, agentId: input.agent.agentId })
        : await this.ledger.listJobsByProvider({ chainId: 56, provider });
      if (page === null) return null;
      return { jobs: page.jobs, nextBefore: page.nextBefore, scope, activity: await activity };
    } catch {
      return null;
    }
  }

  // Read alongside the list, never rejects: a failed window is null.
  private async activity(provider: HireAddress | null, agentId: string): Promise<HireActivity | null> {
    try {
      return await this.ledger.activity(provider === null
        ? { chainId: 56, days: ACTIVITY_DAYS, agentId }
        : { chainId: 56, days: ACTIVITY_DAYS, provider });
    } catch {
      return null;
    }
  }
}

export function providerWallet(agent: MarketplaceAgent): HireAddress | null {
  const candidate = agent.onchainIdentity.agentWallet;
  return candidate !== null && ADDRESS.test(candidate) && candidate.toLowerCase() !== ZERO_ADDRESS
    ? candidate as HireAddress
    : null;
}
