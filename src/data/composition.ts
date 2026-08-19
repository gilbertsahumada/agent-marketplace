import { Trust8004MarketplaceAgentRepository } from "./repositories/trust8004-marketplace-agent-repository.js";
import { Gate1PublicProofRepository } from "./proofs/gate1-public-proof-repository.js";
import { TrustlessErc8183SpikeRepository } from "./erc8183/trustless-erc8183-spike-repository.js";

export const marketplaceAgentRepository = new Trust8004MarketplaceAgentRepository();
export const publicJobProofRepository = new Gate1PublicProofRepository();
export const erc8183SpikeRepository = new TrustlessErc8183SpikeRepository();
