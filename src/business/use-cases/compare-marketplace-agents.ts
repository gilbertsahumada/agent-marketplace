import type { MarketplaceAgentRepository } from "../../data/repositories/marketplace-agent-repository.ts";
import type { MarketplaceAgentComparison } from "../entities/marketplace-agent.ts";
import {
  InvalidMarketplaceInputError,
  MarketplaceAgentNotFoundError,
  MarketplaceDataUnavailableError,
} from "../errors/marketplace-errors.ts";
import { toMarketplaceAgent } from "../policies/marketplace-agent-policy.ts";

export class CompareMarketplaceAgents {
  constructor(private readonly repository: MarketplaceAgentRepository) {}

  async execute(input: { agentIds: string[] }): Promise<MarketplaceAgentComparison> {
    if (input.agentIds.length < 2 || input.agentIds.length > 3) {
      throw new InvalidMarketplaceInputError("Compare requires two or three agent IDs");
    }
    if (input.agentIds.some((agentId) => !/^\d+$/.test(agentId))) {
      throw new InvalidMarketplaceInputError("Every agentId must be numeric");
    }
    const uniqueIds = [...new Set(input.agentIds)];
    if (uniqueIds.length !== input.agentIds.length) {
      throw new InvalidMarketplaceInputError("Compare requires unique agent IDs");
    }

    const agents = [];
    try {
      for (const agentId of uniqueIds) {
        const record = await this.repository.getById(agentId);
        if (!record) throw new MarketplaceAgentNotFoundError(agentId);
        agents.push(toMarketplaceAgent(record, { evaluateMarketplace: true }));
      }
    } catch (error) {
      if (error instanceof MarketplaceAgentNotFoundError) throw error;
      throw new MarketplaceDataUnavailableError("compare agents", { cause: error });
    }

    return {
      agents,
      winner: null,
      note: "The marketplace does not calculate a universal winner; evidence remains comparable by field.",
      catalogCoverage: "partial",
      fetchedAt: agents.reduce(
        (latest, agent) => agent.freshness.fetchedAt > latest ? agent.freshness.fetchedAt : latest,
        agents[0]!.freshness.fetchedAt,
      ),
    };
  }
}
