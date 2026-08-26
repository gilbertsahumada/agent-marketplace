import { Erc8183SpikeDisabledError, Erc8183SpikeUnavailableError } from "../../business/errors/erc8183-spike-errors.ts";

export interface Erc8183BrowserSpikeConfig {
  sellerOrigin: string;
  bearerToken: string | null;
}

type Environment = Readonly<Record<string, string | undefined>>;

function environmentValue(env: Environment, key: string): string | undefined {
  return Reflect.get(env, key) as string | undefined;
}

export function isErc8183BrowserSpikeEnabled(env: Environment = process.env): boolean {
  return environmentValue(env, "ERC8183_BROWSER_SPIKE_ENABLED") === "true";
}

export function loadErc8183BrowserSpikeConfig(env: Environment = process.env): Erc8183BrowserSpikeConfig {
  if (!isErc8183BrowserSpikeEnabled(env)) throw new Erc8183SpikeDisabledError();
  const rawOrigin = environmentValue(env, "ERC8183_BROWSER_SPIKE_SELLER_ORIGIN")?.trim();
  if (!rawOrigin) {
    throw new Erc8183SpikeUnavailableError("The fixed seller origin is not configured");
  }
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new Erc8183SpikeUnavailableError("The fixed seller origin is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Erc8183SpikeUnavailableError("The fixed seller origin must be a bare HTTPS origin");
  }
  return {
    sellerOrigin: url.origin,
    bearerToken: environmentValue(env, "ERC8183_BROWSER_SPIKE_BEARER_TOKEN")?.trim() || null,
  };
}
