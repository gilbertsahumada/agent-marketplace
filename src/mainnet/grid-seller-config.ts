import "server-only";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HostedSellerUnavailableError } from "../business/errors/hosted-seller-errors.js";

export interface MainnetGridSellerConfig {
  origin: "https://bnb-agent-marketplace-ruby.vercel.app";
  endpoint: "https://bnb-agent-marketplace-ruby.vercel.app/grid";
  privateKey: Hex;
  address: Address;
  agentId: number | null;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function loadMainnetGridSellerConfig(
  env: Environment = process.env,
  options: { requireAgentId?: boolean } = {},
): MainnetGridSellerConfig {
  if (Reflect.get(env, "ERC8183_MAINNET_SELLER_ENABLED") !== "true") {
    throw new HostedSellerUnavailableError("The Mainnet Grid seller is disabled");
  }
  const rawOrigin = Reflect.get(env, "ERC8183_MAINNET_SELLER_ORIGIN")?.trim();
  if (rawOrigin !== "https://bnb-agent-marketplace-ruby.vercel.app") {
    throw new HostedSellerUnavailableError("The Mainnet Grid seller origin is not allowlisted");
  }
  const rawKey = Reflect.get(env, "MAINNET_SELLER_PRIVATE_KEY")?.trim();
  if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
    throw new HostedSellerUnavailableError("The Mainnet Grid seller signer is unavailable");
  }
  const rawAddress = Reflect.get(env, "ERC8183_MAINNET_SELLER_ADDRESS")?.trim();
  if (!rawAddress) throw new HostedSellerUnavailableError("The Mainnet Grid seller address is unavailable");
  const privateKey = rawKey as Hex;
  const address = getAddress(rawAddress);
  if (getAddress(privateKeyToAccount(privateKey).address) !== address) {
    throw new HostedSellerUnavailableError("The Mainnet Grid seller signer does not match its public allowlist");
  }
  const rawAgentId = Reflect.get(env, "ERC8183_MAINNET_SELLER_AGENT_ID")?.trim();
  if (options.requireAgentId !== false && (!rawAgentId || !/^\d+$/.test(rawAgentId) || !Number.isSafeInteger(Number(rawAgentId)) || Number(rawAgentId) <= 0)) {
    throw new HostedSellerUnavailableError("The Mainnet Grid seller Agent ID is unavailable");
  }
  const config = {
    origin: rawOrigin,
    endpoint: `${rawOrigin}/grid`,
    address,
    agentId: rawAgentId && /^\d+$/.test(rawAgentId) ? Number(rawAgentId) : null,
  } as Omit<MainnetGridSellerConfig, "privateKey">;
  return Object.defineProperty(config, "privateKey", {
    value: privateKey,
    enumerable: false,
    configurable: false,
    writable: false,
  }) as MainnetGridSellerConfig;
}
