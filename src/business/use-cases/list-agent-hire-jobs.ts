import type { HireActivity, HireAddress, HireJob, HireJobPage, HireJobsScope, HireLedger } from "../entities/hire-job.ts";
import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";

import { providerIdentity } from "../../../shared/agent-identity.ts";

export interface AgentHireJobs {
  jobs: HireJob[];
  // Cursor of the next (older) Worker page, null when this page is the last;
  // callers show that the list is capped, they do not page here.
  nextBefore: string | null;
  scope: HireJobsScope;
  // Phase events over the last HIRE_ACTIVITY_DEFAULT_DAYS in the same scope;
  // null when that window could not be read, which never hides the jobs.
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
    // The required read starts first; the optional window follows and runs
    // alongside it.
    const page = this.jobs(provider, input.agent);
    const activity = this.activity(provider, input.agent);
    const [jobs, window] = await Promise.all([page, activity]);
    if (jobs === null) return null;
    return { jobs: jobs.jobs, nextBefore: jobs.nextBefore, scope, activity: window };
  }

  // Never rejects: a ledger that throws is an unavailable ledger (null).
  private async jobs(provider: HireAddress | null, agent: MarketplaceAgent): Promise<HireJobPage | null> {
    try {
      return provider === null
        ? await this.ledger.listJobsByAgent({ chainId: agent.chainId, agentId: agent.agentId })
        : await this.ledger.listJobsByProvider({ chainId: agent.chainId, provider });
    } catch {
      return null;
    }
  }

  // Read alongside the list, never rejects: a failed window is null. The
  // default window (HIRE_ACTIVITY_DEFAULT_DAYS) is the Worker's own, so no
  // `days` is sent: the read shares its cache entry with the /jobs page.
  private async activity(provider: HireAddress | null, agent: MarketplaceAgent): Promise<HireActivity | null> {
    try {
      return await this.ledger.activity(provider === null
        ? { chainId: agent.chainId, agentId: agent.agentId }
        : { chainId: agent.chainId, provider });
    } catch {
      return null;
    }
  }
}

export function providerWallet(agent: MarketplaceAgent): HireAddress | null {
  const identity = providerIdentity({ agentWallet: agent.onchainIdentity.agentWallet });
  return identity ? agent.onchainIdentity.agentWallet as HireAddress : null;
}
