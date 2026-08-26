import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";
import { boundResponseBody } from "./bounded-json.ts";

export type ResolveHostname = (hostname: string) => Promise<string[]>;

export interface SafeEndpointTransport {
  url: URL;
  fetch: typeof fetch;
  close: () => Promise<void>;
}

export interface SafeEndpointTransportOptions {
  resolveHostname?: ResolveHostname;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const NON_PUBLIC_IPV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC_IPV4.addSubnet(network, prefix, "ipv4");
}
const NON_PUBLIC_IPV6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["::ffff:0:0:0", 96],
  ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:2::", 48], ["2001:10::", 28], ["2001:20::", 28], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) {
  NON_PUBLIC_IPV6.addSubnet(network, prefix, "ipv6");
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !NON_PUBLIC_IPV4.check(address, "ipv4");
  if (version === 6) return !NON_PUBLIC_IPV6.check(address, "ipv6");
  return false;
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
}

export async function resolveSafePublicHttpsEndpoint(
  endpoint: string,
  resolveHostname: ResolveHostname = defaultResolveHostname,
): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Endpoint is not a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("Endpoint must use HTTPS");
  if (url.username || url.password) throw new Error("Endpoint URL must not contain credentials");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Endpoint hostname is not public");
  }
  const addresses = isIP(hostname) ? [hostname] : await resolveHostname(hostname);
  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
    throw new Error("Endpoint does not resolve exclusively to public IP addresses");
  }
  return { url, addresses: [...new Set(addresses)] };
}

export function createPinnedLookup(addresses: readonly string[]): LookupFunction {
  const records = addresses.map((address) => ({ address, family: isIP(address) }));
  return (_hostname, options, callback) => {
    const requestedFamily = options.family === "IPv4"
      ? 4
      : options.family === "IPv6"
        ? 6
        : options.family ?? 0;
    const matching = requestedFamily === 0
      ? records
      : records.filter((record) => record.family === requestedFamily);
    if (matching.length === 0) {
      const error = Object.assign(new Error("No validated address matches the requested family"), {
        code: "ENOTFOUND",
      });
      callback(error, []);
      return;
    }
    if (options.all) {
      callback(null, matching);
      return;
    }
    callback(null, matching[0]!.address, matching[0]!.family);
  };
}

export async function createSafeEndpointTransport(
  endpoint: string,
  options: SafeEndpointTransportOptions = {},
): Promise<SafeEndpointTransport> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const startedAt = Date.now();
  let resolutionTimer: ReturnType<typeof setTimeout> | undefined;
  const resolutionTimeout = new Promise<never>((_resolve, reject) => {
    resolutionTimer = setTimeout(() => reject(new DOMException("DNS resolution timed out", "TimeoutError")), timeoutMs);
  });
  let resolved: Awaited<ReturnType<typeof resolveSafePublicHttpsEndpoint>>;
  try {
    resolved = await Promise.race([
      resolveSafePublicHttpsEndpoint(endpoint, options.resolveHostname),
      resolutionTimeout,
    ]);
  } finally {
    if (resolutionTimer) clearTimeout(resolutionTimer);
  }
  const remainingTimeoutMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
  const dispatcher = new Agent({ connect: { lookup: createPinnedLookup(resolved.addresses) } });
  const transportTimeoutSignal = AbortSignal.timeout(remainingTimeoutMs);
  const controlledFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const requestedUrl = new URL(input instanceof Request ? input.url : input.toString());
    if (requestedUrl.protocol !== "https:" || requestedUrl.origin !== resolved.url.origin) {
      throw new Error("Protocol probe attempted to leave the validated origin");
    }
    const existingSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = existingSignal
      ? AbortSignal.any([existingSignal, transportTimeoutSignal])
      : transportTimeoutSignal;
    const requestInit = {
      ...init,
      redirect: "error" as const,
      signal,
      dispatcher,
    } as RequestInit;
    const response = await fetch(input, requestInit);
    return options.maxResponseBytes
      ? boundResponseBody(response, options.maxResponseBytes, "Endpoint response exceeded the allowed size")
      : response;
  }) as typeof fetch;
  return {
    url: resolved.url,
    fetch: controlledFetch,
    close: async () => {
      await dispatcher.close();
    },
  };
}
