import { isSyntacticallyPublicHttpsUrl } from "./safe-url";
import type { CatalogEndpointProtocol } from "./types";

export type CatalogResourceRole = "operational" | "external";
export type CatalogValidationProtocol = "a2a" | "mcp" | "erc8183_http";
export type CatalogExternalKind = "website" | "social" | "repository" | "documentation" | "other";
export type CatalogEndpointEligibility = "eligible" | "unsafe" | "invalid_declaration" | "unsupported";

export interface CatalogResourceClassification {
  readonly declaredProtocol: CatalogEndpointProtocol;
  readonly role: CatalogResourceRole;
  readonly validationProtocol: CatalogValidationProtocol | null;
  readonly externalKind: CatalogExternalKind | null;
  readonly eligibility: CatalogEndpointEligibility;
  readonly safety: "safe" | "unsafe";
  readonly safetyReason: "invalid_url" | null;
}

const SOCIAL_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "t.me",
  "telegram.me",
]);

function hostnameMatches(hostname: string, expected: string): boolean {
  return hostname === expected || hostname.endsWith(`.${expected}`);
}

function externalKind(url: URL): CatalogExternalKind | null {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if ([...SOCIAL_HOSTS].some((entry) => hostnameMatches(hostname, entry))) return "social";
  if (hostnameMatches(hostname, "github.com") || hostnameMatches(hostname, "gitlab.com")) return "repository";
  if (hostname.startsWith("docs.") || /^\/(?:docs?|documentation)(?:\/|$)/i.test(url.pathname)) {
    return "documentation";
  }
  return null;
}

function validationProtocol(protocol: CatalogEndpointProtocol): CatalogValidationProtocol | null {
  return protocol === "a2a" || protocol === "mcp" || protocol === "erc8183_http"
    ? protocol
    : null;
}

export function classifyCatalogResource(
  declaredProtocol: CatalogEndpointProtocol,
  endpoint: string,
): CatalogResourceClassification {
  if (!isSyntacticallyPublicHttpsUrl(endpoint)) {
    return {
      declaredProtocol,
      role: validationProtocol(declaredProtocol) ? "operational" : "external",
      validationProtocol: validationProtocol(declaredProtocol),
      externalKind: null,
      eligibility: "unsafe",
      safety: "unsafe",
      safetyReason: "invalid_url",
    };
  }

  const kind = externalKind(new URL(endpoint));
  const transport = validationProtocol(declaredProtocol);
  if (transport) {
    return {
      declaredProtocol,
      role: "operational",
      validationProtocol: transport,
      externalKind: kind,
      eligibility: kind === null ? "eligible" : "invalid_declaration",
      safety: "safe",
      safetyReason: null,
    };
  }

  return {
    declaredProtocol,
    role: "external",
    validationProtocol: null,
    externalKind: kind ?? (declaredProtocol === "web" ? "website" : "other"),
    eligibility: "unsupported",
    safety: "safe",
    safetyReason: null,
  };
}
