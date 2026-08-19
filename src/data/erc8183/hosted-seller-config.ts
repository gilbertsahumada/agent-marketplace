import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HostedSellerUnavailableError } from "../../business/errors/hosted-seller-errors.js";

export interface HostedSellerConfig {
  origin: string;
  privateKey: Hex;
  address: Address;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function loadHostedSellerConfig(
  env: Environment = process.env,
): HostedSellerConfig {
  const rawKey = Reflect.get(env, "SELLER_PRIVATE_KEY")?.trim();
  if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
    throw new HostedSellerUnavailableError("SELLER_PRIVATE_KEY is not configured");
  }
  const rawOrigin = Reflect.get(
    env,
    "ERC8183_BROWSER_SPIKE_SELLER_ORIGIN",
  )?.trim();
  if (!rawOrigin) {
    throw new HostedSellerUnavailableError("The hosted seller origin is not configured");
  }
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new HostedSellerUnavailableError("The hosted seller origin is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new HostedSellerUnavailableError(
      "The hosted seller origin must be a bare HTTPS origin",
    );
  }
  const privateKey = rawKey as Hex;
  return {
    origin: url.origin,
    privateKey,
    address: getAddress(privateKeyToAccount(privateKey).address),
  };
}
