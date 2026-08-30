import { getAddress } from "viem";
import { Erc8183SpikeDisabledError, Erc8183SpikeUnavailableError } from "../business/errors/erc8183-spike-errors.ts";
import type { Erc8183BrowserDeployment } from "../data/erc8183/browser-wallet-adapter.ts";
import { ERC8183_MAINNET } from "./contracts.ts";

type Environment = Readonly<Record<string, string | undefined>>;

export interface MainnetBrowserDemoConfig {
  sellerOrigin: "https://bnb-agent-marketplace-ruby.vercel.app";
  deployment: Erc8183BrowserDeployment;
  onDemandQuote: {
    timeoutMs: number;
    maxResponseBytes: number;
    minRemainingSeconds: number;
  };
}

function boundedInteger(
  env: Environment,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = Reflect.get(env, key)?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Erc8183SpikeUnavailableError(`${key} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Erc8183SpikeUnavailableError(`${key} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function isMainnetBrowserDemoEnabled(env: Environment = process.env): boolean {
  return Reflect.get(env, "ERC8183_MAINNET_DEMO_ENABLED") === "true";
}

export function loadMainnetBrowserDemoConfig(env: Environment = process.env): MainnetBrowserDemoConfig {
  if (!isMainnetBrowserDemoEnabled(env)) throw new Erc8183SpikeDisabledError();
  const origin = Reflect.get(env, "ERC8183_MAINNET_SELLER_ORIGIN")?.trim();
  if (origin !== "https://bnb-agent-marketplace-ruby.vercel.app") {
    throw new Erc8183SpikeUnavailableError("The Mainnet seller origin is not allowlisted");
  }
  const agentIdRaw = Reflect.get(env, "ERC8183_MAINNET_SELLER_AGENT_ID")?.trim();
  if (!agentIdRaw || !/^\d+$/.test(agentIdRaw) || !Number.isSafeInteger(Number(agentIdRaw)) || Number(agentIdRaw) <= 0) {
    throw new Erc8183SpikeUnavailableError("The Mainnet seller Agent ID is unavailable");
  }
  const sellerRaw = Reflect.get(env, "ERC8183_MAINNET_SELLER_ADDRESS")?.trim();
  if (!sellerRaw) throw new Erc8183SpikeUnavailableError("The Mainnet seller address is unavailable");
  return {
    sellerOrigin: origin,
    onDemandQuote: {
      timeoutMs: boundedInteger(env, "ON_DEMAND_QUOTE_TIMEOUT_MS", 30_000, 1_000, 30_000),
      maxResponseBytes: boundedInteger(env, "MAX_SELLER_RESPONSE_BYTES", 32 * 1024, 1_024, 64 * 1024),
      minRemainingSeconds: boundedInteger(env, "QUOTE_MIN_REMAINING_SECONDS", 120, 1, 900),
    },
    deployment: {
      chainId: 56,
      networkName: ERC8183_MAINNET.networkName,
      nativeCurrencyName: "BNB",
      nativeCurrencySymbol: "BNB",
      rpcUrl: ERC8183_MAINNET.rpcUrl,
      explorerUrl: ERC8183_MAINNET.explorerUrl,
      agentId: Number(agentIdRaw),
      commerce: ERC8183_MAINNET.commerce,
      router: ERC8183_MAINNET.router,
      policy: ERC8183_MAINNET.policy,
      token: ERC8183_MAINNET.token,
      seller: getAddress(sellerRaw),
      maximumBudgetRaw: ERC8183_MAINNET.maximumDemoBudgetRaw,
    },
  };
}
