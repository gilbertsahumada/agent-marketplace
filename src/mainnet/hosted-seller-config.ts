import "server-only";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { HostedSellerSlug } from "../business/entities/hosted-seller-service.ts";
import { HostedSellerUnavailableError } from "../business/errors/hosted-seller-errors.ts";
import { hostedSellerEndpoint } from "../business/policies/hosted-seller-catalog.ts";
import { hostedSellerEnvKey, hostedSellerEnvNames } from "../shared/hosted-seller-env.ts";

export const MAINNET_SELLER_ORIGIN = "https://bnb-agent-marketplace-ruby.vercel.app" as const;

export interface MainnetHostedSellerConfig {
  slug: HostedSellerSlug;
  origin: typeof MAINNET_SELLER_ORIGIN;
  endpoint: string;
  privateKey: Hex;
  address: Address;
  agentId: number | null;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function hostedSellerPrivateKeyEnvName(slug: HostedSellerSlug): string {
  const key = hostedSellerEnvKey(slug);
  return key === null ? "MAINNET_SELLER_PRIVATE_KEY" : `MAINNET_SELLER_${key}_PRIVATE_KEY`;
}

function label(slug: HostedSellerSlug): string {
  return slug === "grid" ? "The Mainnet Grid seller" : `The Mainnet ${slug} seller`;
}

// The shared enable flag and origin gate every seller; keys, addresses and
// Agent IDs are per seller (see hostedSellerEnvNames). The private key is a
// non-enumerable property so it never lands in logs or JSON.
export function loadMainnetHostedSellerConfig(
  slug: HostedSellerSlug,
  env: Environment = process.env,
  options: { requireAgentId?: boolean } = {},
): MainnetHostedSellerConfig {
  const names = hostedSellerEnvNames(slug);
  if (Reflect.get(env, "ERC8183_MAINNET_SELLER_ENABLED") !== "true") {
    throw new HostedSellerUnavailableError(`${label(slug)} is disabled`);
  }
  const rawOrigin = Reflect.get(env, "ERC8183_MAINNET_SELLER_ORIGIN")?.trim();
  if (rawOrigin !== MAINNET_SELLER_ORIGIN) {
    throw new HostedSellerUnavailableError(`${label(slug)} origin is not allowlisted`);
  }
  const rawKey = Reflect.get(env, hostedSellerPrivateKeyEnvName(slug))?.trim();
  if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
    throw new HostedSellerUnavailableError(`${label(slug)} signer is unavailable`);
  }
  const rawAddress = Reflect.get(env, names.address)?.trim();
  if (!rawAddress) throw new HostedSellerUnavailableError(`${label(slug)} address is unavailable`);
  const privateKey = rawKey as Hex;
  const address = getAddress(rawAddress);
  if (getAddress(privateKeyToAccount(privateKey).address) !== address) {
    throw new HostedSellerUnavailableError(`${label(slug)} signer does not match its public allowlist`);
  }
  const rawAgentId = Reflect.get(env, names.agentId)?.trim();
  const validAgentId = Boolean(rawAgentId && /^\d+$/.test(rawAgentId) && Number.isSafeInteger(Number(rawAgentId)) && Number(rawAgentId) > 0);
  if (options.requireAgentId !== false && !validAgentId) {
    throw new HostedSellerUnavailableError(`${label(slug)} Agent ID is unavailable`);
  }
  const config = {
    slug,
    origin: rawOrigin,
    endpoint: hostedSellerEndpoint(rawOrigin, slug),
    address,
    agentId: validAgentId ? Number(rawAgentId) : null,
  } as Omit<MainnetHostedSellerConfig, "privateKey">;
  return Object.defineProperty(config, "privateKey", {
    value: privateKey,
    enumerable: false,
    configurable: false,
    writable: false,
  }) as MainnetHostedSellerConfig;
}
