import "server-only";
import type { Address, Hex } from "viem";
import { loadMainnetHostedSellerConfig, MAINNET_SELLER_ORIGIN } from "./hosted-seller-config.ts";

export interface MainnetGridSellerConfig {
  origin: typeof MAINNET_SELLER_ORIGIN;
  endpoint: `${typeof MAINNET_SELLER_ORIGIN}/grid`;
  privateKey: Hex;
  address: Address;
  agentId: number | null;
}

type Environment = Readonly<Record<string, string | undefined>>;

// The Grid seller is the "grid" slug of the hosted seller config; this
// wrapper keeps its original shape for the CLIs and tests that predate it.
export function loadMainnetGridSellerConfig(
  env: Environment = process.env,
  options: { requireAgentId?: boolean } = {},
): MainnetGridSellerConfig {
  return loadMainnetHostedSellerConfig("grid", env, options) as unknown as MainnetGridSellerConfig;
}
