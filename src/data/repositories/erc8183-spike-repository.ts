import type { Address } from "viem";
import type {
  Erc8183BuyerFacts,
  Erc8183JobFacts,
  Erc8183QuoteEnvelope,
  NormalizedErc8183Quote,
  NotifyFundedResult,
} from "../../business/entities/erc8183-browser-spike.ts";
import type { Erc8183SpikeAllowlist } from "../../business/policies/erc8183-spike-policy.ts";

export interface Erc8183RegistryWallet {
  readonly registry: Address;
  readonly agentWallet: Address;
  readonly owner: Address;
}

export interface Erc8183SpikeRepository {
  readonly allowlist: Erc8183SpikeAllowlist;
  requestQuote(): Promise<NormalizedErc8183Quote>;
  validateQuote(envelope: Erc8183QuoteEnvelope): Promise<NormalizedErc8183Quote>;
  getBuyerFacts(buyer: Address): Promise<Erc8183BuyerFacts>;
  getJob(jobId: bigint): Promise<Erc8183JobFacts>;
  notifyFunded(jobId: bigint): Promise<NotifyFundedResult>;
  // Direct ERC-8004 registry read on the deployment's chain; optional because
  // fixtures and snapshots have no chain access.
  readAgentWallet?(agentId: bigint): Promise<Erc8183RegistryWallet>;
}
