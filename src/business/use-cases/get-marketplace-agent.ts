import type { MarketplaceAgentRepository } from "../../data/repositories/marketplace-agent-repository.ts";
import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";
import {
  InvalidMarketplaceInputError,
  MarketplaceAgentNotFoundError,
  MarketplaceDataUnavailableError,
} from "../errors/marketplace-errors.ts";
import { attachOnchainIdentity, toMarketplaceAgent } from "../policies/marketplace-agent-policy.ts";

export class GetMarketplaceAgent {
  constructor(private readonly repository: MarketplaceAgentRepository) {}

  async execute(input: { agentId: string }): Promise<MarketplaceAgent> {
    if (!/^\d+$/.test(input.agentId)) {
      throw new InvalidMarketplaceInputError("agentId must be numeric");
    }
    let record;
    try {
      record = await this.repository.getById(input.agentId);
    } catch (error) {
      throw new MarketplaceDataUnavailableError("get agent", { cause: error });
    }
    const agent = record ? toMarketplaceAgent(record, { evaluateMarketplace: true }) : null;
    if (!agent) throw new MarketplaceAgentNotFoundError(input.agentId);
    const onchainIdentity = await this.repository.getOnchainIdentity(input.agentId);
    return attachOnchainIdentity(agent, onchainIdentity);
  }
}
