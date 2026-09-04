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
import { GetFunnelEvidence } from "./use-cases/get-funnel-evidence.ts";
import { requestQuoteWithObservationSync } from "../data/observation/on-demand-observation-sync.ts";
import {
  getCatalogCandidate as loadCatalogCandidate,
  getCatalogCandidatePage as loadCatalogCandidatePage,
} from "../data/observation/catalog-candidate-feed.ts";
import { syncCatalogObservation } from "../data/observation/catalog-observation-sync.ts";
import { getVerifiedHireEvents } from "../data/observation/hire-event-feed.ts";
import { getHireJob, getHireJobs, getHireLedgerSummary } from "../data/observation/hire-ledger-feed.ts";
import { ListAgentHireJobs } from "./use-cases/list-agent-hire-jobs.ts";
import type { HireLedger } from "./entities/hire-job.ts";
import { syncHireEvent } from "../data/observation/hire-event-sync.ts";
import {
  fallbackBuyerQuote,
  getBuyerQuoteHistory,
  reportBuyerQuoteFailure,
  startBuyerQuote,
  submitBuyerQuoteResult,
} from "../data/observation/quote-request-sync.ts";
import {
  CatalogValidationRequestError,
  getCatalogValidationStatus as loadCatalogValidationStatus,
  issueCatalogValidationRequestToken as createCatalogValidationRequestToken,
  readCatalogValidationRequestToken as parseCatalogValidationRequestToken,
  requestCatalogValidation as enqueueCatalogValidation,
} from "../data/observation/catalog-validation-sync.ts";

const catalogPageReader = { execute: loadCatalogCandidatePage };
const catalogReader = { execute: loadCatalogCandidate };
export const listMarketplaceAgents = new ListMarketplaceAgents(marketplaceAgentRepository, catalogPageReader);
export const getMarketplaceAgent = new GetMarketplaceAgent(marketplaceAgentRepository, catalogReader);
export const compareMarketplaceAgents = new CompareMarketplaceAgents(marketplaceAgentRepository, catalogReader);
export const getPublicJobProof = new GetPublicJobProof(publicJobProofRepository);
export const requestErc8183Quote = new RequestErc8183Quote(erc8183SpikeRepository);
export const prepareErc8183Hire = new PrepareErc8183Hire(erc8183SpikeRepository);
export const notifyFundedJob = new NotifyFundedJob(erc8183SpikeRepository);
export const getErc8183JobStatus = new GetErc8183JobStatus(erc8183SpikeRepository);
const verifiedHireEventReader = { listByAgent: getVerifiedHireEvents };
export const getErc8183TestnetJobTracking = new GetErc8183TestnetJobTracking(
  erc8183SpikeRepository,
  publicJobProofRepository,
  verifiedHireEventReader,
);
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
  mainnetBrowserDemoConfigRepository,
  mainnetWritesEnabled,
  getMainnetErc8183JobStatus,
  liveMainnetNotify,
);
export const getMainnetBrowserDemoConfig = new GetMainnetBrowserDemoConfig(mainnetBrowserDemoConfigRepository);
export const getMainnetJobProof = new GetMainnetJobProof(mainnetJobProofRepository);
export const getPublicMainnetJobProof = new GetPublicMainnetJobProof(mainnetJobProofRepository);
export const getAgentEvidencePassport = new GetAgentEvidencePassport(
  getMarketplaceAgent,
  mainnetJobProofRepository,
  Date.now,
  { execute: loadCatalogCandidate },
  verifiedHireEventReader,
);
// One reader over the Worker's Commerce indexer; HTTP, pages, MCP and the CLI
// all consume it through this port.
const hireLedger: HireLedger = {
  listRecentJobs: (input) => getHireJobs(input),
  listJobsByBuyer: (input) => getHireJobs(input),
  listJobsByProvider: (input) => getHireJobs(input),
  listJobsByAgent: (input) => getHireJobs(input),
  getJob: (input) => getHireJob(input),
  summary: (input) => getHireLedgerSummary(input),
};
export const getHireLedger = hireLedger;
export const listAgentHireJobs = new ListAgentHireJobs(hireLedger);
export const validateMarketplaceAgent = new ValidateMarketplaceAgent(agentValidationRepository);
export const getFunnelEvidence = new GetFunnelEvidence(funnelEvidenceRepository);
export const getWorkerObservations = workerObservationFeed;
export const getCatalogCandidate = loadCatalogCandidate;
export const getCatalogCandidatePage = loadCatalogCandidatePage;
export const recordCatalogObservation = syncCatalogObservation;
export const recordHireEvent = syncHireEvent;
// Quote request ports keep Next route handlers free of infrastructure imports.
export { fallbackBuyerQuote, getBuyerQuoteHistory, reportBuyerQuoteFailure, startBuyerQuote, submitBuyerQuoteResult };
export {
  CatalogValidationRequestError,
  loadCatalogValidationStatus as getCatalogValidationStatus,
  createCatalogValidationRequestToken as issueCatalogValidationRequestToken,
  parseCatalogValidationRequestToken as readCatalogValidationRequestToken,
  enqueueCatalogValidation as requestCatalogValidation,
};
