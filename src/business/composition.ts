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
import { GetMarketplaceLandingCatalog } from "./use-cases/get-marketplace-landing-catalog.ts";
import { GetMainnetHiringExposure } from "./use-cases/get-mainnet-hiring-exposure.ts";
import { GetAgentEvidencePassport } from "./use-cases/get-agent-evidence-passport.ts";
import { ValidateMarketplaceAgent } from "./use-cases/validate-marketplace-agent.ts";
import { NotifyQualifiedMainnetFundedJob, PrepareQualifiedMainnetHire, RequestQualifiedMainnetQuote } from "./use-cases/qualified-mainnet-hire.ts";
import { RecordSellerObservation } from "./use-cases/record-seller-observation.ts";
import { GetFunnelEvidence } from "./use-cases/get-funnel-evidence.ts";

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
// Exported for the seller-observation cron only: it must be able to observe
// liveness *before* a qualification exists, so it deliberately skips the
// release-qualification gate that guards every buyer-facing route.
export const probeMainnetErc8183Quote = new RequestErc8183Quote(mainnetErc8183Repository);
const unqualifiedMainnetQuote = probeMainnetErc8183Quote;
const unqualifiedMainnetPrepare = new PrepareErc8183Hire(mainnetErc8183Repository);
const unqualifiedMainnetNotify = new NotifyFundedJob(mainnetErc8183Repository);
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
  mainnetWritesEnabled,
  unqualifiedMainnetPrepare,
);
export const notifyMainnetFundedJob = new NotifyQualifiedMainnetFundedJob(
  getMainnetHiringExposure,
  mainnetWritesEnabled,
  getMainnetErc8183JobStatus,
  unqualifiedMainnetNotify,
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
