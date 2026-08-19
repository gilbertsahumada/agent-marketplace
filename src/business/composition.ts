import {
  erc8183SpikeRepository,
  marketplaceAgentRepository,
  publicJobProofRepository,
} from "../data/composition.js";
import { CompareMarketplaceAgents } from "./use-cases/compare-marketplace-agents.js";
import { GetMarketplaceAgent } from "./use-cases/get-marketplace-agent.js";
import { ListMarketplaceAgents } from "./use-cases/list-marketplace-agents.js";
import { GetPublicJobProof } from "./use-cases/get-public-job-proof.js";
import { GetErc8183JobStatus } from "./use-cases/get-erc8183-job-status.js";
import { NotifyFundedJob } from "./use-cases/notify-funded-job.js";
import { PrepareErc8183Hire } from "./use-cases/prepare-erc8183-hire.js";
import { RequestErc8183Quote } from "./use-cases/request-erc8183-quote.js";
import { GetErc8183TestnetJobTracking } from "./use-cases/get-erc8183-testnet-job-tracking.js";

export const listMarketplaceAgents = new ListMarketplaceAgents(marketplaceAgentRepository);
export const getMarketplaceAgent = new GetMarketplaceAgent(marketplaceAgentRepository);
export const compareMarketplaceAgents = new CompareMarketplaceAgents(marketplaceAgentRepository);
export const getPublicJobProof = new GetPublicJobProof(publicJobProofRepository);
export const requestErc8183Quote = new RequestErc8183Quote(erc8183SpikeRepository);
export const prepareErc8183Hire = new PrepareErc8183Hire(erc8183SpikeRepository);
export const notifyFundedJob = new NotifyFundedJob(erc8183SpikeRepository);
export const getErc8183JobStatus = new GetErc8183JobStatus(erc8183SpikeRepository);
export const getErc8183TestnetJobTracking = new GetErc8183TestnetJobTracking(
  erc8183SpikeRepository,
  publicJobProofRepository,
);
