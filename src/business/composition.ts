import {
  erc8183SpikeRepository,
  mainnetErc8183Repository,
  mainnetBrowserDemoConfigRepository,
  mainnetJobProofRepository,
  mainnetWritesEnabled,
  marketplaceAgentRepository,
  publicJobProofRepository,
  publicVerificationRepository,
  agentValidationRepository,
  sellerObservationStoreFactory,
  funnelEvidenceRepository,
  workerObservationFeed,
} from "../data/composition.ts";
import { CompareMarketplaceAgents } from "./use-cases/compare-marketplace-agents.ts";
import { GetMarketplaceAgent } from "./use-cases/get-marketplace-agent.ts";
import { ListMarketplaceAgents } from "./use-cases/list-marketplace-agents.ts";
import { GetPublicJobProof } from "./use-cases/get-public-job-proof.ts";
import { GetErc8183JobStatus } from "./use-cases/get-erc8183-job-status.ts";
import { NotifyFundedJob } from "./use-cases/notify-funded-job.ts";
import { PrepareErc8183Hire } from "./use-cases/prepare-erc8183-hire.ts";
import { RequestErc8183Quote } from "./use-cases/request-erc8183-quote.ts";
import { GetErc8183TestnetJobTracking } from "./use-cases/get-erc8183-testnet-job-tracking.ts";
import { GetPublicVerificationSnapshot } from "./use-cases/get-public-verification-snapshot.ts";
import { GetMainnetBrowserDemoConfig } from "./use-cases/get-mainnet-browser-demo-config.ts";
import { GetMainnetJobProof, GetPublicMainnetJobProof } from "./use-cases/get-mainnet-job-proof.ts";
import { GetMainnetHiringExposure } from "./use-cases/get-mainnet-hiring-exposure.ts";
import { GetAgentEvidencePassport } from "./use-cases/get-agent-evidence-passport.ts";
import { ValidateMarketplaceAgent } from "./use-cases/validate-marketplace-agent.ts";
import { NotifyQualifiedMainnetFundedJob, PrepareQualifiedMainnetHire, RequestQualifiedMainnetQuote } from "./use-cases/qualified-mainnet-hire.ts";
import { RecordSellerObservation } from "./use-cases/record-seller-observation.ts";
import { GetFunnelEvidence } from "./use-cases/get-funnel-evidence.ts";
import { requestQuoteWithObservationSync } from "../data/observation/on-demand-observation-sync.ts";
import {
  getCatalogCandidate as loadCatalogCandidate,
  getCatalogCandidatePage as loadCatalogCandidatePage,
} from "../data/observation/catalog-candidate-feed.ts";
import { syncCatalogObservation } from "../data/observation/catalog-observation-sync.ts";

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
// Exported for the seller-observation cron and reused by the buyer-triggered
// refresh. Both paths validate the live identity, endpoint and signed quote;
// the observation feed is evidence, not an authorization dependency.
export const probeMainnetErc8183Quote = new RequestErc8183Quote(mainnetErc8183Repository);
const liveMainnetQuote = probeMainnetErc8183Quote;
const liveMainnetPrepare = new PrepareErc8183Hire(mainnetErc8183Repository);
const liveMainnetNotify = new NotifyFundedJob(mainnetErc8183Repository);
export const getMainnetErc8183JobStatus = new GetErc8183JobStatus(mainnetErc8183Repository);
export const getPublicVerificationSnapshot = new GetPublicVerificationSnapshot(publicVerificationRepository);
export const getMainnetHiringExposure = new GetMainnetHiringExposure(
  { getObservations: workerObservationFeed },
  mainnetBrowserDemoConfigRepository,
);
export const requestMainnetErc8183Quote = new RequestQualifiedMainnetQuote(
  liveMainnetQuote,
);
export const requestMainnetErc8183QuoteWithObservationSync = {
  execute: () => requestQuoteWithObservationSync(requestMainnetErc8183Quote),
};
export const prepareMainnetErc8183Hire = new PrepareQualifiedMainnetHire(
  mainnetWritesEnabled,
  liveMainnetPrepare,
);
export const notifyMainnetFundedJob = new NotifyQualifiedMainnetFundedJob(
  getMainnetHiringExposure,
  mainnetWritesEnabled,
  getMainnetErc8183JobStatus,
  liveMainnetNotify,
);
export const getMainnetBrowserDemoConfig = new GetMainnetBrowserDemoConfig(mainnetBrowserDemoConfigRepository);
export const recordMainnetSellerObservation = new RecordSellerObservation(
  getMainnetBrowserDemoConfig,
  probeMainnetErc8183Quote,
  sellerObservationStoreFactory,
);
export const getMainnetJobProof = new GetMainnetJobProof(mainnetJobProofRepository);
export const getPublicMainnetJobProof = new GetPublicMainnetJobProof(mainnetJobProofRepository);
export const getAgentEvidencePassport = new GetAgentEvidencePassport(
  getMarketplaceAgent,
  mainnetJobProofRepository,
);
export const validateMarketplaceAgent = new ValidateMarketplaceAgent(agentValidationRepository);
export const getFunnelEvidence = new GetFunnelEvidence(funnelEvidenceRepository);
export const getWorkerObservations = workerObservationFeed;
export const getCatalogCandidate = loadCatalogCandidate;
export const getCatalogCandidatePage = loadCatalogCandidatePage;
export const recordCatalogObservation = syncCatalogObservation;
