import type { MarketplaceAgentRepository } from "../../data/repositories/marketplace-agent-repository.ts";
import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";
import {
  attachCatalogCandidate,
  catalogCandidateToMarketplaceAgentData,
  type CatalogCandidateReader,
} from "../../data/observation/catalog-marketplace-adapter.ts";
import {
  InvalidMarketplaceInputError,
  MarketplaceAgentNotFoundError,
  MarketplaceDataUnavailableError,
} from "../errors/marketplace-errors.ts";
import { attachOnchainIdentity, toMarketplaceAgent } from "../policies/marketplace-agent-policy.ts";

export class GetMarketplaceAgent {
  constructor(
    private readonly repository: MarketplaceAgentRepository,
    private readonly catalogReader?: CatalogCandidateReader,
  ) {}

  async execute(input: { agentId: string }): Promise<MarketplaceAgent> {
    if (!/^\d+$/.test(input.agentId)) {
      throw new InvalidMarketplaceInputError("agentId must be numeric");
    }
    let record;
    const catalogCandidatePromise = this.catalogReader?.execute(input) ?? Promise.resolve(null);
    try {
      record = await this.repository.getById(input.agentId);
    } catch (error) {
      throw new MarketplaceDataUnavailableError("get agent", { cause: error });
    }
    const catalogCandidate = await catalogCandidatePromise;
    const enrichedRecord = record
      ? catalogCandidate ? attachCatalogCandidate(record, catalogCandidate) : record
      : catalogCandidate ? catalogCandidateToMarketplaceAgentData(catalogCandidate) : null;
    const agent = enrichedRecord ? toMarketplaceAgent(enrichedRecord, { evaluateMarketplace: true }) : null;
    if (!agent) throw new MarketplaceAgentNotFoundError(input.agentId);
    const onchainIdentity = await this.repository.getOnchainIdentity(input.agentId);
    return attachOnchainIdentity(agent, onchainIdentity);
  }
}
