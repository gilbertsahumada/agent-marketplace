import {
  BSC_CHAIN_ID,
  type CatalogAgent,
  type CatalogDeclaredEndpoint,
  type CatalogEndpointProtocol,
  type CatalogIndexEndpoint,
  type CatalogPage,
  type CatalogTransport,
} from "./types.ts";

type JsonRecord = Record<string, unknown>;

const MAX_PAGE_ITEMS = 2_000;
const MAX_STRING_LENGTH = 16_384;

export class CatalogSchemaError extends Error {
  constructor(path: string, expected: string, value: unknown) {
    const received = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    super(`trust8004 catalog schema error at ${path}: expected ${expected}, received ${received}`);
    this.name = "CatalogSchemaError";
  }
}

function record(value: unknown, path: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogSchemaError(path, "object", value);
  }
  return value as JsonRecord;
}

function safeInteger(value: unknown, path: string, positive: boolean): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new CatalogSchemaError(path, positive ? "positive safe integer" : "non-negative safe integer", value);
  }
  return value;
}

function numericAgentId(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^\d+$/.test(value) || value.length > 78) {
    throw new CatalogSchemaError(path, "numeric string", value);
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > MAX_STRING_LENGTH) {
    throw new CatalogSchemaError(path, `string <= ${MAX_STRING_LENGTH} characters or null`, value);
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function metadataArray(value: unknown, path: string): unknown[] {
  if (value === null || value === undefined) return [];
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    if (parsed.length > MAX_STRING_LENGTH) {
      throw new CatalogSchemaError(path, `JSON array string <= ${MAX_STRING_LENGTH} characters`, parsed);
    }
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new CatalogSchemaError(path, "array or JSON array string", parsed);
    }
  }
  if (!Array.isArray(parsed) || parsed.length > 256) {
    throw new CatalogSchemaError(path, "array with at most 256 items", parsed);
  }
  return parsed;
}

function normalizedTransport(value: unknown): CatalogTransport | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "a2a") return "a2a";
  if (normalized === "erc8183") return "erc8183_http";
  return null;
}

function normalizedProtocol(value: unknown): CatalogEndpointProtocol | null {
  const transport = normalizedTransport(value);
  if (transport) return transport;
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "mcp") return "mcp";
  if (normalized === "x402") return "x402";
  if (["http", "https", "web", "website", "homepage", "rest", "api"].includes(normalized)) return "web";
  return normalized.length > 0 ? "unknown" : null;
}

function parseIndexDeclarations(values: unknown[], path: string): CatalogIndexEndpoint[] {
  const declarations: CatalogIndexEndpoint[] = [];
  for (const [index, value] of values.entries()) {
    const item = record(value, `${path}[${index}]`);
    const protocol = normalizedProtocol(item.name ?? item.type ?? item.protocol);
    const endpoint = item.endpoint ?? item.url;
    if (!protocol) continue;
    if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > MAX_STRING_LENGTH) {
      throw new CatalogSchemaError(`${path}[${index}].endpoint`, "non-empty string", endpoint);
    }
    declarations.push({
      protocol,
      endpoint,
      rawProtocol: typeof (item.name ?? item.type ?? item.protocol) === "string"
        ? String(item.name ?? item.type ?? item.protocol)
        : null,
      source: path.endsWith(".services") ? "services" : "endpoints",
      sourceIndex: index,
    });
  }
  return declarations;
}

function normalizedImage(value: unknown): string | null {
  const candidate = nullableString(value, "item.imageUrl");
  if (!candidate) return null;
  if (candidate.startsWith("ipfs://")) {
    const path = candidate.slice("ipfs://".length).replace(/^ipfs\//, "");
    return path ? `https://ipfs.io/ipfs/${path}` : null;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function parseDeclarations(
  values: unknown[],
  source: CatalogDeclaredEndpoint["source"],
  path: string,
): CatalogDeclaredEndpoint[] {
  const declarations: CatalogDeclaredEndpoint[] = [];
  for (const [sourceIndex, value] of values.entries()) {
    const item = record(value, `${path}[${sourceIndex}]`);
    const transport = normalizedTransport(item.name ?? item.type ?? item.protocol);
    if (transport === null) continue;
    const endpoint = item.endpoint ?? item.url;
    if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > MAX_STRING_LENGTH) {
      throw new CatalogSchemaError(`${path}[${sourceIndex}].endpoint`, "non-empty string", endpoint);
    }
    declarations.push({ transport, endpoint, source, sourceIndex });
  }
  return declarations;
}

function metadataAvailable(item: JsonRecord): boolean {
  const value = item.metadataReasonCode ?? item.metadataReason ?? item.metadataStatus;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
  return ["ok", "resolved", "success", "available"].includes(normalized);
}

function registeredAt(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.length <= 64) {
    const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  throw new CatalogSchemaError(path, "non-negative timestamp or ISO timestamp", value);
}

export function parseCatalogAgent(value: unknown, path = "item"): CatalogAgent {
  const item = record(value, path);
  const rawChainId = typeof item.chainId === "string" && /^\d+$/.test(item.chainId)
    ? Number(item.chainId)
    : item.chainId;
  if (rawChainId !== BSC_CHAIN_ID) {
    throw new CatalogSchemaError(`${path}.chainId`, `chainId ${BSC_CHAIN_ID}`, item.chainId);
  }
  let declaredEndpoints: CatalogDeclaredEndpoint[] = [];
  let indexEndpoints: CatalogIndexEndpoint[] = [];
  let metadataParsed = false;
  try {
    const services = metadataArray(item.services, `${path}.services`);
    const endpoints = metadataArray(item.endpoints, `${path}.endpoints`);
    declaredEndpoints = [
      ...parseDeclarations(services, "services", `${path}.services`),
      ...parseDeclarations(endpoints, "endpoints", `${path}.endpoints`),
    ];
    indexEndpoints = [
      ...parseIndexDeclarations(services, `${path}.services`),
      ...parseIndexDeclarations(endpoints, `${path}.endpoints`),
      ...(typeof item.a2aEndpoint === "string" ? [{
        protocol: "a2a" as const, endpoint: item.a2aEndpoint,
        rawProtocol: "a2a", source: "shortcut" as const, sourceIndex: 0,
      }] : []),
      ...(typeof item.mcpEndpoint === "string" ? [{
        protocol: "mcp" as const, endpoint: item.mcpEndpoint,
        rawProtocol: "mcp", source: "shortcut" as const, sourceIndex: 0,
      }] : []),
    ];
    metadataParsed = true;
  } catch (error) {
    if (!(error instanceof CatalogSchemaError)) throw error;
  }
  return {
    chainId: BSC_CHAIN_ID,
    agentId: numericAgentId(item.agentId, `${path}.agentId`),
    name: nullableString(item.name, `${path}.name`),
    description: nullableString(item.description, `${path}.description`)?.slice(0, 2_048) ?? null,
    imageUrl: normalizedImage(item.imageUrl ?? item.image ?? item.avatar ?? item.logo),
    registeredAt: registeredAt(item.registeredAt, `${path}.registeredAt`),
    metadataUpdatedAt: registeredAt(item.metadataUpdatedAt, `${path}.metadataUpdatedAt`),
    metadataAvailable: metadataAvailable(item) && metadataParsed,
    declarations: {
      a2a: declaredEndpoints.some((entry) => entry.transport === "a2a"),
      erc8183: declaredEndpoints.some((entry) => entry.transport === "erc8183_http"),
    },
    declaredEndpoints,
    indexEndpoints,
  };
}

export function parseCatalogPage(value: unknown): CatalogPage {
  const page = record(value, "response");
  if (!Array.isArray(page.items) || page.items.length > MAX_PAGE_ITEMS) {
    throw new CatalogSchemaError("response.items", `array with at most ${MAX_PAGE_ITEMS} items`, page.items);
  }
  const total = safeInteger(page.total, "response.total", false);
  const limit = safeInteger(page.limit, "response.limit", true);
  if (limit > MAX_PAGE_ITEMS) {
    throw new CatalogSchemaError("response.limit", `integer at most ${MAX_PAGE_ITEMS}`, limit);
  }
  const offset = safeInteger(page.offset, "response.offset", false);
  const items: CatalogAgent[] = [];
  const invalidItems: CatalogPage["invalidItems"] = [];
  for (const [index, item] of page.items.entries()) {
    try {
      items.push(parseCatalogAgent(item, `response.items[${index}]`));
    } catch (error) {
      invalidItems.push({ index, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { items, invalidItems, total, limit, offset };
}
