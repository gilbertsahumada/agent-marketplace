import { Trust8004MarketplaceAgentRepository } from "./repositories/trust8004-marketplace-agent-repository.ts";
import { Gate1PublicProofRepository } from "./proofs/gate1-public-proof-repository.ts";
import { TrustlessErc8183SpikeRepository } from "./erc8183/trustless-erc8183-spike-repository.ts";
import { MainnetErc8183Repository } from "../mainnet/mainnet-erc8183-repository.ts";
import { StaticPublicVerificationRepository } from "./repositories/public-verification-repository.ts";
import { MainnetBrowserDemoConfigRepository } from "../mainnet/browser-demo-config-repository.ts";
import { StaticMainnetJobProofRepository } from "./proofs/mainnet-job-proof-repository.ts";
import { areMainnetWritesEnabled } from "../mainnet/mainnet-write-gate.ts";
import { Trust8004AgentValidationRepository } from "./repositories/trust8004-agent-validation-repository.ts";
import { RateLimitedAgentValidationRepository } from "./repositories/rate-limited-agent-validation-repository.ts";
import { Trust8004Provider } from "../trust8004/provider.ts";
import { createNeonSellerObservationStore } from "./observations/seller-observation-store.ts";

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
export const sellerObservationStoreFactory = () => createNeonSellerObservationStore();
