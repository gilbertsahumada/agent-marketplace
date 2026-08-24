import {
  erc8183SpikeRepository,
  mainnetErc8183Repository,
  mainnetBrowserDemoConfigRepository,
  mainnetJobProofRepository,
  marketplaceAgentRepository,
  publicJobProofRepository,
  publicVerificationRepository,
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
import { GetPublicVerificationSnapshot } from "./use-cases/get-public-verification-snapshot.js";
import { GetMainnetBrowserDemoConfig } from "./use-cases/get-mainnet-browser-demo-config.js";
import { GetMainnetJobProof } from "./use-cases/get-mainnet-job-proof.js";
import { GetMarketplaceLandingCatalog } from "./use-cases/get-marketplace-landing-catalog.js";
import { GetMainnetHiringExposure } from "./use-cases/get-mainnet-hiring-exposure.js";
import { PrepareQualifiedMainnetHire, RequestQualifiedMainnetQuote } from "./use-cases/qualified-mainnet-hire.js";

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
const unqualifiedMainnetQuote = new RequestErc8183Quote(mainnetErc8183Repository);
const unqualifiedMainnetPrepare = new PrepareErc8183Hire(mainnetErc8183Repository);
export const notifyMainnetFundedJob = new NotifyFundedJob(mainnetErc8183Repository);
export const getMainnetErc8183JobStatus = new GetErc8183JobStatus(mainnetErc8183Repository);
export const getPublicVerificationSnapshot = new GetPublicVerificationSnapshot(publicVerificationRepository);
export const getMarketplaceLandingCatalog = new GetMarketplaceLandingCatalog(getPublicVerificationSnapshot);
export const getMainnetHiringExposure = new GetMainnetHiringExposure(
  publicVerificationRepository,
  mainnetBrowserDemoConfigRepository,
);
export const requestMainnetErc8183Quote = new RequestQualifiedMainnetQuote(
  getMainnetHiringExposure,
  unqualifiedMainnetQuote,
);
export const prepareMainnetErc8183Hire = new PrepareQualifiedMainnetHire(
  getMainnetHiringExposure,
  unqualifiedMainnetPrepare,
);
export const getMainnetBrowserDemoConfig = new GetMainnetBrowserDemoConfig(mainnetBrowserDemoConfigRepository);
export const getMainnetJobProof = new GetMainnetJobProof(mainnetJobProofRepository);
