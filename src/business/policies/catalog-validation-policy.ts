import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";
import type {
  BrowserValidationProtocol,
  BrowserValidationTarget,
} from "../entities/browser-validation.ts";

const EXTERNAL_HOSTS = [
  "x.com",
  "twitter.com",
  "t.me",
  "telegram.me",
  "github.com",
  "gitlab.com",
] as const;

function protocol(name: string | null): BrowserValidationProtocol | null {
  if (!name) return null;
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "a2a") return "a2a";
  if (normalized === "mcp") return "mcp";
  if (normalized === "erc8183") return "erc8183_http";
  return null;
}

function matchesHost(hostname: string, expected: string): boolean {
  return hostname === expected || hostname.endsWith(`.${expected}`);
}

export function safePublicBrowserUrl(endpoint: string): URL | null {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return null;
    if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return null;
    return url;
  } catch {
    return null;
  }
}

function isExternalResource(url: URL): boolean {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return EXTERNAL_HOSTS.some((host) => matchesHost(hostname, host))
    || hostname.startsWith("docs.")
    || /^\/(?:docs?|documentation)(?:\/|$)/i.test(url.pathname);
}

export function declaredBrowserValidationTargets(
  agent: Pick<MarketplaceAgent, "services" | "endpoints">,
): BrowserValidationTarget[] {
  const declarations = [
    ...agent.services.map(({ name, endpoint }) => ({ name, endpoint })),
    ...agent.endpoints,
  ];
  const unique = new Map<string, BrowserValidationTarget>();
  for (const declaration of declarations) {
    if (!declaration.endpoint?.trim()) continue;
    const targetProtocol = protocol(declaration.name);
    const endpoint = declaration.endpoint.trim();
    const url = safePublicBrowserUrl(endpoint);
    if (!targetProtocol || !url || isExternalResource(url)) continue;
    const target = { protocol: targetProtocol, endpoint };
    unique.set(`${target.protocol}\u0000${target.endpoint}`, target);
  }
  return [...unique.values()];
}
