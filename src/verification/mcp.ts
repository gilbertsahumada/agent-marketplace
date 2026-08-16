import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  Client,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type FetchLike,
} from "@modelcontextprotocol/client";
import type { McpEndpointVerification, McpVerificationStatus } from "./types.js";

export type ResolveHostname = (hostname: string) => Promise<string[]>;

export interface McpVerifierOptions {
  fetch?: typeof fetch;
  resolveHostname?: ResolveHostname;
  timeoutMs?: number;
  now?: () => number;
  monotonicNow?: () => number;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = parts as [number, number, number, number];
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168))
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized) || normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8:")) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isPrivateIpv4(mapped) : false;
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !isPrivateIpv4(address);
  if (version === 6) return !isPrivateIpv6(address);
  return false;
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
}

export async function assertSafeMcpEndpoint(
  endpoint: string,
  resolveHostname: ResolveHostname = defaultResolveHostname,
): Promise<URL> {
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
  return url;
}

function compareTools(declaredTools: string[], observedTools: string[]): {
  matched: string[];
  declaredOnly: string[];
  observedOnly: string[];
} {
  const declared = new Set(declaredTools);
  const observed = new Set(observedTools);
  return {
    matched: [...declared].filter((tool) => observed.has(tool)).sort(),
    declaredOnly: [...declared].filter((tool) => !observed.has(tool)).sort(),
    observedOnly: [...observed].filter((tool) => !declared.has(tool)).sort(),
  };
}

function classifyError(error: unknown): { status: McpVerificationStatus; code: string; message: string } {
  if (UnauthorizedError.isInstance(error)) {
    return { status: "unauthorized", code: "MCP_UNAUTHORIZED", message: "Endpoint requires authentication." };
  }
  if (SdkHttpError.isInstance(error)) {
    const status = error.status;
    if (status === 401 || status === 403) {
      return { status: "unauthorized", code: "MCP_UNAUTHORIZED", message: "Endpoint requires authentication." };
    }
    return {
      status: "http_error",
      code: `MCP_HTTP_${status}`,
      message: `Endpoint returned HTTP ${status}.`,
    };
  }
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (name === "AbortError" || name === "TimeoutError" || message.includes("timeout")) {
    return { status: "timeout", code: "MCP_TIMEOUT", message: "Endpoint request timed out." };
  }
  return {
    status: "protocol_error",
    code: "MCP_PROTOCOL_ERROR",
    message: "Endpoint did not complete a valid MCP discovery flow.",
  };
}

export async function verifyMcpEndpoint(
  endpoint: string,
  declaredTools: string[],
  options: McpVerifierOptions = {},
): Promise<McpEndpointVerification> {
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? performance.now.bind(performance);
  const startedAt = monotonicNow();
  const observedAt = new Date(now()).toISOString();
  const timeoutMs = options.timeoutMs ?? 10_000;
  let safeUrl: URL;

  try {
    safeUrl = await assertSafeMcpEndpoint(endpoint, options.resolveHostname);
  } catch {
    return {
      status: "unsafe_url",
      endpoint,
      protocol: "mcp",
      declaredTools: [...new Set(declaredTools)].sort(),
      observedTools: [],
      comparison: compareTools(declaredTools, []),
      negotiatedProtocolVersion: null,
      serverInfo: null,
      latencyMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
      observedAt,
      provenance: "observed:mcp-tools-list",
      error: { code: "MCP_UNSAFE_URL", message: "Endpoint is not a safe public HTTPS URL." },
    };
  }

  const fetchImpl = options.fetch ?? fetch;
  const controlledFetch: FetchLike = async (input, init) => {
    const requestedUrl = new URL(input instanceof Request ? input.url : input.toString());
    if (requestedUrl.origin !== safeUrl.origin || requestedUrl.protocol !== "https:") {
      throw new Error("MCP request attempted to leave the validated origin");
    }
    const existingSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = existingSignal
      ? AbortSignal.any([existingSignal, timeoutSignal])
      : timeoutSignal;
    return fetchImpl(input, { ...init, redirect: "error", signal });
  };
  const client = new Client(
    { name: "bnb-agent-marketplace-verifier", version: "0.0.0" },
    {
      supportedProtocolVersions: ["2025-06-18"],
      enforceStrictCapabilities: true,
      listMaxPages: 20,
    },
  );
  const transport = new StreamableHTTPClientTransport(safeUrl, { fetch: controlledFetch });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    const observedTools = [...new Set(result.tools.map((tool) => tool.name))].sort();
    const comparison = compareTools(declaredTools, observedTools);
    const server = client.getServerVersion();
    return {
      status: observedTools.length > 0 ? "protocol_valid" : "no_tools",
      endpoint,
      protocol: "mcp",
      declaredTools: [...new Set(declaredTools)].sort(),
      observedTools,
      comparison,
      negotiatedProtocolVersion: client.getNegotiatedProtocolVersion() ?? null,
      serverInfo: server ? { name: server.name, version: server.version } : null,
      latencyMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
      observedAt,
      provenance: "observed:mcp-tools-list",
      error: observedTools.length > 0
        ? null
        : { code: "MCP_NO_TOOLS", message: "MCP discovery succeeded but returned no tools." },
    };
  } catch (error) {
    const classified = classifyError(error);
    return {
      status: classified.status,
      endpoint,
      protocol: "mcp",
      declaredTools: [...new Set(declaredTools)].sort(),
      observedTools: [],
      comparison: compareTools(declaredTools, []),
      negotiatedProtocolVersion: client.getNegotiatedProtocolVersion() ?? null,
      serverInfo: null,
      latencyMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
      observedAt,
      provenance: "observed:mcp-tools-list",
      error: { code: classified.code, message: classified.message },
    };
  } finally {
    if (transport.sessionId) await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}
