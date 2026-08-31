import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { isPublicIpAddress } from "../verification/safe-http.ts";

type JsonRecord = Record<string, unknown>;

export type CatalogTransportProtocol = "a2a" | "mcp" | "web";
export type CatalogEndpointProtocol = CatalogTransportProtocol | "erc8183_http";
export type CatalogCommerceProtocol = "erc8183";
export type CatalogMetadataState = "ok" | "http_unreachable" | "other";
export type CatalogEndpointSafetyReason =
  | "invalid_url"
  | "https_required"
  | "credentials_not_allowed"
  | "query_not_allowed"
  | "fragment_not_allowed"
  | "non_public_host";

export interface CatalogAgentInput {
  chainId: number | string;
  agentId: number | string;
  owner?: unknown;
  ownerAddress?: unknown;
  metadataUri?: unknown;
  agentURI?: unknown;
  ipfsUri?: unknown;
  name?: unknown;
  description?: unknown;
  imageUrl?: unknown;
  image?: unknown;
  avatar?: unknown;
  logo?: unknown;
  registeredAt?: unknown;
  blockNumber?: unknown;
  metadataStatus?: unknown;
  metadataReason?: unknown;
  metadataReasonCode?: unknown;
  services?: unknown;
  endpoints?: unknown;
  a2aEndpoint?: unknown;
  mcpEndpoint?: unknown;
}

export interface CatalogEndpointDeclaration {
  protocol: CatalogEndpointProtocol;
  url: string | null;
  endpointKey: string;
  originKey: string | null;
  safety: "safe" | "unsafe";
  safetyReason: CatalogEndpointSafetyReason | null;
}

export interface CatalogAgentIndexRecord {
  schemaVersion: 2;
  agentKey: string;
  chainId: 56;
  agentId: string;
  owner: string | null;
  metadataUri: string | null;
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  registeredAt: number | null;
  blockNumber: string | null;
  metadataState: CatalogMetadataState;
  candidate: boolean;
  transportProtocols: CatalogTransportProtocol[];
  commerceProtocols: CatalogCommerceProtocol[];
  declarations: CatalogEndpointDeclaration[];
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized.slice(0, maximum);
}

function normalizedImageUrl(value: unknown): string | null {
  const candidate = boundedText(value, 2_048);
  if (!candidate) return null;
  if (candidate.startsWith("ipfs://")) {
    const path = candidate.slice("ipfs://".length).replace(/^ipfs\//, "");
    return path ? `https://ipfs.io/ipfs/${path}` : null;
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numericString(value: unknown, field: string): string {
  const candidate = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof candidate !== "string" || !/^\d+$/.test(candidate)) {
    throw new Error(`CATALOG_SCHEMA:${field}`);
  }
  return BigInt(candidate).toString();
}

function optionalTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function metadataState(input: CatalogAgentInput): CatalogMetadataState {
  const raw = input.metadataReasonCode ?? input.metadataReason ?? input.metadataStatus;
  if (typeof raw !== "string") return "other";
  const normalized = raw.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (["ok", "resolved", "success", "available"].includes(normalized)) return "ok";
  if (normalized === "http_unreachable") return "http_unreachable";
  return "other";
}

function protocol(value: unknown): CatalogEndpointProtocol | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "a2a") return "a2a";
  if (normalized === "mcp") return "mcp";
  if (normalized === "erc8183") return "erc8183_http";
  if (["http", "https", "web", "rest", "api"].includes(normalized)) return "web";
  return null;
}

function unsafeDeclaration(
  endpointProtocol: CatalogEndpointProtocol,
  rawEndpoint: string,
  reason: CatalogEndpointSafetyReason,
): CatalogEndpointDeclaration {
  return {
    protocol: endpointProtocol,
    url: null,
    endpointKey: digest(`${endpointProtocol}\nunsafe\n${digest(rawEndpoint)}`),
    originKey: null,
    safety: "unsafe",
    safetyReason: reason,
  };
}

function declaration(
  endpointProtocol: CatalogEndpointProtocol,
  rawEndpoint: string,
): CatalogEndpointDeclaration {
  let url: URL;
  try {
    url = new URL(rawEndpoint.trim());
  } catch {
    return unsafeDeclaration(endpointProtocol, rawEndpoint, "invalid_url");
  }
  if (url.protocol !== "https:") {
    return unsafeDeclaration(endpointProtocol, rawEndpoint, "https_required");
  }
  if (url.username || url.password) {
    return unsafeDeclaration(endpointProtocol, rawEndpoint, "credentials_not_allowed");
  }
  if (url.search) {
    return unsafeDeclaration(endpointProtocol, rawEndpoint, "query_not_allowed");
  }
  if (url.hash) {
    return unsafeDeclaration(endpointProtocol, rawEndpoint, "fragment_not_allowed");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || (isIP(hostname) !== 0 && !isPublicIpAddress(hostname))) {
    return unsafeDeclaration(endpointProtocol, rawEndpoint, "non_public_host");
  }

  url.hostname = hostname;
  url.hash = "";
  const normalizedUrl = url.toString();
  return {
    protocol: endpointProtocol,
    url: normalizedUrl,
    endpointKey: digest(`${endpointProtocol}\n${normalizedUrl}`),
    originKey: digest(url.origin),
    safety: "safe",
    safetyReason: null,
  };
}

function candidateDeclarations(input: CatalogAgentInput): CatalogEndpointDeclaration[] {
  const declarations: CatalogEndpointDeclaration[] = [];
  const add = (endpointProtocol: CatalogEndpointProtocol, endpoint: unknown) => {
    if (typeof endpoint !== "string" || endpoint.trim().length === 0) return;
    declarations.push(declaration(endpointProtocol, endpoint));
  };

  add("a2a", input.a2aEndpoint);
  add("mcp", input.mcpEndpoint);
  for (const entry of [...jsonArray(input.services), ...jsonArray(input.endpoints)]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as JsonRecord;
    const endpointProtocol = protocol(item.name ?? item.type ?? item.protocol);
    if (!endpointProtocol) continue;
    add(endpointProtocol, item.endpoint ?? item.url);
  }

  const unique = new Map<string, CatalogEndpointDeclaration>();
  for (const item of declarations) unique.set(item.endpointKey, item);
  return [...unique.values()].sort((left, right) => {
    const protocolOrder = left.protocol.localeCompare(right.protocol);
    if (protocolOrder !== 0) return protocolOrder;
    return (left.url ?? left.endpointKey).localeCompare(right.url ?? right.endpointKey);
  });
}

export function normalizeCatalogAgent(input: CatalogAgentInput): CatalogAgentIndexRecord {
  if (Number(input.chainId) !== 56) throw new Error("CATALOG_SCHEMA:chainId");
  const agentId = numericString(input.agentId, "agentId");
  const declarations = candidateDeclarations(input);
  const state = metadataState(input);
  const transportProtocols = [...new Set(
    declarations
      .filter((item) => item.protocol !== "erc8183_http")
      .map((item) => item.protocol as CatalogTransportProtocol),
  )].sort();
  const commerceProtocols: CatalogCommerceProtocol[] = declarations.some(
    (item) => item.protocol === "erc8183_http",
  ) ? ["erc8183"] : [];

  return {
    schemaVersion: 2,
    agentKey: `eip155:56:${agentId}`,
    chainId: 56,
    agentId,
    owner: boundedText(input.ownerAddress ?? input.owner, 128),
    metadataUri: boundedText(input.metadataUri ?? input.agentURI ?? input.ipfsUri, 16_384),
    name: boundedText(input.name, 256),
    description: boundedText(input.description, 2_048),
    imageUrl: normalizedImageUrl(input.imageUrl ?? input.image ?? input.avatar ?? input.logo),
    registeredAt: optionalTimestamp(input.registeredAt),
    blockNumber: input.blockNumber === null || input.blockNumber === undefined
      ? null
      : numericString(input.blockNumber, "blockNumber"),
    metadataState: state,
    candidate: state === "ok" && declarations.some((item) => item.safety === "safe"),
    transportProtocols,
    commerceProtocols,
    declarations,
  };
}
