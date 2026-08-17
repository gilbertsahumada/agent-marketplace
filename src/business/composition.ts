import { marketplaceAgentRepository, publicJobProofRepository } from "../data/composition.js";
import { CompareMarketplaceAgents } from "./use-cases/compare-marketplace-agents.js";
import { GetMarketplaceAgent } from "./use-cases/get-marketplace-agent.js";
import { ListMarketplaceAgents } from "./use-cases/list-marketplace-agents.js";
import { GetPublicJobProof } from "./use-cases/get-public-job-proof.js";

export const listMarketplaceAgents = new ListMarketplaceAgents(marketplaceAgentRepository);
export const getMarketplaceAgent = new GetMarketplaceAgent(marketplaceAgentRepository);
export const compareMarketplaceAgents = new CompareMarketplaceAgents(marketplaceAgentRepository);
export const getPublicJobProof = new GetPublicJobProof(publicJobProofRepository);
