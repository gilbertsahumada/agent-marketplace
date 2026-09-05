import type { HireAddress, HireChainId, HireJob, HireJobsScope, HireLedger } from "../entities/hire-job.ts";
import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface AgentHireJobs {
  jobs: HireJob[];
  // Cursor of the next (older) Worker page, null when this page is the last;
  // callers show that the list is capped, they do not page here.
  nextBefore: string | null;
  scope: HireJobsScope;
  totals?: { total: number; completed: number; funded: number; submitted: number };
}

// Jobs sold by an agent, by its registry agent wallet when the marketplace
// knows it, otherwise only the jobs the
// marketplace itself recorded a chain-verified hire event for. An unavailable
// ledger yields null, never an error that hides the hire page and never an
// empty list that reads as "no jobs".
export class ListAgentHireJobs {
  constructor(private readonly ledger: HireLedger) {}

  async execute(input: { agent: MarketplaceAgent; before?: string; chainId?: HireChainId }): Promise<AgentHireJobs | null> {
    const provider = providerWallet(input.agent);
    const chainId = input.chainId ?? 56;
    // A Mainnet registration ID must never be reused as a Testnet identity.
    if (chainId !== 56 && provider === null) return null;
    const scope: HireJobsScope = provider === null ? "agent" : "wallet";
    try {
      const page = provider === null
        ? await this.ledger.listJobsByAgent({ chainId, agentId: input.agent.agentId, ...(input.before ? { before: input.before } : {}) })
        : await this.ledger.listJobsByProvider({ chainId, provider, ...(input.before ? { before: input.before } : {}) });
      if (page === null) return null;
      return { jobs: page.jobs, nextBefore: page.nextBefore, scope, ...(page.totals ? { totals: page.totals } : {}) };
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
