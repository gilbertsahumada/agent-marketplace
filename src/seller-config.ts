import { getAddress, type Address } from "viem";
import { TESTNET_NETWORK } from "./config.js";

export type SellerCommand = "serve" | "register";

export interface SellerConfig {
  command: SellerCommand;
  address: Address;
  walletPassword: string;
  walletsDir?: string;
  baseUrl: string;
  port: number;
  servicePrice: bigint;
  storageDir: string;
}

const RAW_KEY_VARIABLES = [
  "PRIVATE_KEY",
  "SELLER_PRIVATE_KEY",
  "PROVIDER_PRIVATE_KEY",
] as const;

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer, received ${raw}`);
  }
  return value;
}

export function parseSellerCommand(argv: string[]): SellerCommand {
  const [command, ...rest] = argv;
  if ((command !== "serve" && command !== "register") || rest.length > 0) {
    throw new Error("Expected seller command: serve or register");
  }
  return command;
}

export function loadSellerConfig(
  env: NodeJS.ProcessEnv,
  command: SellerCommand,
): SellerConfig {
  const network = env.NETWORK ?? TESTNET_NETWORK;
  if (network !== TESTNET_NETWORK) {
    throw new Error(`Seller fixture is locked to ${TESTNET_NETWORK}`);
  }
  const rawKeys = RAW_KEY_VARIABLES.filter((name) => Boolean(env[name]));
  if (rawKeys.length > 0) {
    throw new Error(
      `Raw private-key variables are forbidden: ${rawKeys.join(", ")}`,
    );
  }
  const overrides = Object.keys(env).filter(
    (name) =>
      name === "ERC8004_REGISTRY_ADDRESS" ||
      /^ERC8183_.*_ADDRESS$/.test(name),
  );
  if (overrides.length > 0) {
    throw new Error(
      `Seller fixture rejects contract overrides: ${overrides.sort().join(", ")}`,
    );
  }
  if (!env.SELLER_ADDRESS) {
    throw new Error("SELLER_ADDRESS is required");
  }
  if (!env.SELLER_WALLET_PASSWORD) {
    throw new Error(
      "SELLER_WALLET_PASSWORD is required through an external secret mechanism",
    );
  }
  if (!env.A2A_BASE_URL) {
    throw new Error("A2A_BASE_URL is required");
  }
  const url = new URL(env.A2A_BASE_URL);
  if (url.protocol !== "https:") {
    throw new Error("A2A_BASE_URL must be a public HTTPS URL");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("A2A_BASE_URL must not contain credentials, query, or hash");
  }
  if (url.pathname !== "/") {
    throw new Error("A2A_BASE_URL must be an origin without a path");
  }
  const rawPrice = env.ERC8183_SERVICE_PRICE ?? "1";
  if (!/^\d+$/.test(rawPrice) || BigInt(rawPrice) <= 0n) {
    throw new Error("ERC8183_SERVICE_PRICE must be a positive raw-unit integer");
  }

  return {
    command,
    address: getAddress(env.SELLER_ADDRESS),
    walletPassword: env.SELLER_WALLET_PASSWORD,
    ...(env.SELLER_WALLETS_DIR
      ? { walletsDir: env.SELLER_WALLETS_DIR }
      : {}),
    baseUrl: url.origin,
    port: positiveInteger(env.SELLER_PORT, 8010),
    servicePrice: BigInt(rawPrice),
    storageDir: env.SELLER_STORAGE_DIR?.trim() || ".gate1/seller-data",
  };
}
