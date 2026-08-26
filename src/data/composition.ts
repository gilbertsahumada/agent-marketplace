import { Trust8004MarketplaceAgentRepository } from "./repositories/trust8004-marketplace-agent-repository.js";
import { Gate1PublicProofRepository } from "./proofs/gate1-public-proof-repository.js";
import { TrustlessErc8183SpikeRepository } from "./erc8183/trustless-erc8183-spike-repository.js";
import { MainnetErc8183Repository } from "../mainnet/mainnet-erc8183-repository.js";
import { StaticPublicVerificationRepository } from "./repositories/public-verification-repository.js";
import { MainnetBrowserDemoConfigRepository } from "../mainnet/browser-demo-config-repository.js";
import { StaticMainnetJobProofRepository } from "./proofs/mainnet-job-proof-repository.js";
import { areMainnetWritesEnabled } from "../mainnet/mainnet-write-gate.js";
import { Trust8004AgentValidationRepository } from "./repositories/trust8004-agent-validation-repository.js";
import { RateLimitedAgentValidationRepository } from "./repositories/rate-limited-agent-validation-repository.js";
import { Trust8004Provider } from "../trust8004/provider.js";

const trust8004Provider = new Trust8004Provider();
export const marketplaceAgentRepository = new Trust8004MarketplaceAgentRepository({ provider: trust8004Provider });
export const erc8183SpikeRepository = new TrustlessErc8183SpikeRepository();
export const mainnetErc8183Repository = new MainnetErc8183Repository();
export const publicVerificationRepository = new StaticPublicVerificationRepository();
export const mainnetBrowserDemoConfigRepository = new MainnetBrowserDemoConfigRepository();
export const mainnetJobProofRepository = new StaticMainnetJobProofRepository();
export const mainnetWritesEnabled = areMainnetWritesEnabled;
export const publicJobProofRepository = new Gate1PublicProofRepository({
  loadGate6aJob: () => erc8183SpikeRepository.getJob(551n),
});
const configuredMarketplaceSellerId = Reflect.get(process.env, "ERC8183_MAINNET_SELLER_AGENT_ID")?.trim();
export const agentValidationRepository = new RateLimitedAgentValidationRepository(
  new Trust8004AgentValidationRepository({
    provider: trust8004Provider,
    ...(configuredMarketplaceSellerId
      ? { marketplaceOperatedGridSellerAgentId: configuredMarketplaceSellerId }
      : {}),
  }),
);
