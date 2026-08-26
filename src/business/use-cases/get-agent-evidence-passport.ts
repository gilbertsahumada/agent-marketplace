import type { AgentEvidencePassport } from "../entities/evidence-passport.ts";
import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";
import type { MainnetJobProof } from "../entities/mainnet-job-proof.ts";
import { buildEvidencePassport } from "../policies/evidence-passport-policy.ts";

export interface MarketplaceAgentReader {
  execute(input: { agentId: string }): Promise<MarketplaceAgent>;
}

export interface MainnetJobProofReader {
  listByAgentId(agentId: string): MainnetJobProof[];
}

export class GetAgentEvidencePassport {
  constructor(
    private readonly getAgent: MarketplaceAgentReader,
    private readonly jobProofs: MainnetJobProofReader,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: { agentId: string }): Promise<AgentEvidencePassport> {
    const agent = await this.getAgent.execute(input);
    return this.build(agent);
  }

  async executeWithAgent(input: { agentId: string }): Promise<{
    agent: MarketplaceAgent;
    passport: AgentEvidencePassport;
  }> {
    const agent = await this.getAgent.execute(input);
    return { agent, passport: this.build(agent) };
  }

  private build(agent: MarketplaceAgent): AgentEvidencePassport {
    return buildEvidencePassport({
      chainId: agent.chainId,
      agentId: agent.agentId,
      name: agent.name,
      operator: agent.operator,
      indexedAt: agent.freshness.fetchedAt,
      onchainIdentity: {
        status: agent.onchainIdentity.status,
        observedAt: agent.onchainIdentity.observedAt,
        blockNumber: agent.onchainIdentity.blockNumber,
      },
      verification: agent.verification ? {
        freshness: agent.verification.freshness,
        identityStatus: agent.verification.identity.status,
        endpointStatus: agent.verification.tools.reachability,
        observedAt: agent.verification.tools.observedAt ?? agent.verification.generatedAt,
        staleAfter: agent.verification.staleAfter,
      } : null,
      hireability: {
        canHire: agent.hireability.canHire,
        status: agent.hireability.status,
        observedAt: agent.hireability.evidence.observedAt,
      },
      jobProofs: this.jobProofs.listByAgentId(agent.agentId),
      generatedAt: new Date(this.now()).toISOString(),
    });
  }
}
