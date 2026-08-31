import { AsyncTtlCache } from "../cache/async-ttl-cache.ts";
import {
  CATALOG_STATUSES,
  type CatalogCandidate,
  type CatalogCandidateDeclaration,
  type CatalogCandidateObservation,
  type CatalogCandidatePage,
  type CatalogStatus,
} from "../../business/entities/catalog-candidate.ts";
import { MARKETPLACE_CATEGORIES, type MarketplaceCategory } from "../../business/entities/marketplace-agent.ts";

const cache = new AsyncTtlCache();
const CACHE_TTL_MS = 30_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CATALOG_FEED_INVALID");
  return value as Record<string, unknown>;
}

function integer(value: unknown, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("CATALOG_FEED_INVALID");
  return Number(value);
}

function string(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > 16_384) throw new Error("CATALOG_FEED_INVALID");
  return value;
}

function declaration(value: unknown): CatalogCandidateDeclaration {
  const item = record(value);
  if (!/^[a-f0-9]{64}$/.test(String(item.endpointKey))
    || !["a2a", "mcp", "web", "erc8183_http"].includes(String(item.protocol))
    || !["safe", "unsafe"].includes(String(item.safety))) throw new Error("CATALOG_FEED_INVALID");
  return {
    endpointKey: item.endpointKey as string,
    protocol: item.protocol as CatalogCandidateDeclaration["protocol"],
    endpoint: string(item.endpoint, true),
    originKey: string(item.originKey, true),
    safety: item.safety as CatalogCandidateDeclaration["safety"],
    safetyReason: string(item.safetyReason, true),
    representativeAgentKey: string(item.representativeAgentKey, true),
    lastProbedAt: integer(item.lastProbedAt, true),
    nextProbeAt: integer(item.nextProbeAt)!,
    consecutiveFailures: integer(item.consecutiveFailures)!,
    priority: integer(item.priority)!,
  };
}

function observation(value: unknown): CatalogCandidateObservation {
  const item = record(value);
  if (!/^[a-f0-9]{64}$/.test(String(item.endpointKey ?? "")) && item.endpointKey !== null) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  if (!["a2a", "mcp", "web", "erc8183_http", "erc8183"].includes(String(item.protocol))
    || !["browser_reported", "marketplace_probe", "worker_probe", "chain_index"].includes(String(item.source))
    || !["protocol_valid", "cors_blocked", "http_error", "timeout", "network_error", "invalid_response",
      "unsafe_url", "erc8183_detected", "quote_verified", "quote_rejected", "unreachable", "error"].includes(String(item.outcome))) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  return {
    id: integer(item.id)!,
    agentKey: string(item.agentKey)!,
    endpointKey: string(item.endpointKey, true),
    protocol: item.protocol as CatalogCandidateObservation["protocol"],
    source: item.source as CatalogCandidateObservation["source"],
    outcome: item.outcome as CatalogCandidateObservation["outcome"],
    observedAt: integer(item.observedAt)!,
    expiresAt: integer(item.expiresAt, true),
    httpStatus: integer(item.httpStatus, true),
    errorCode: string(item.errorCode, true),
    durationMs: integer(item.durationMs)!,
    details: item.details,
  };
}

function candidate(value: unknown): CatalogCandidate {
  const item = record(value);
  if (item.chainId !== 56 || !/^\d+$/.test(String(item.agentId))
    || !Array.isArray(item.declarations) || !Array.isArray(item.observations)) throw new Error("CATALOG_FEED_INVALID");
  let categories: unknown;
  try { categories = JSON.parse(String(item.categoriesJson)); } catch { throw new Error("CATALOG_FEED_INVALID"); }
  if (!Array.isArray(categories) || categories.some((entry) => !MARKETPLACE_CATEGORIES.includes(entry as MarketplaceCategory))) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  if (!["ok", "http_unreachable", "other"].includes(String(item.metadataState))) throw new Error("CATALOG_FEED_INVALID");
  return {
    agentKey: string(item.agentKey)!,
    agentId: item.agentId as string,
    chainId: 56,
    name: string(item.name, true),
    description: string(item.description, true),
    imageUrl: string(item.imageUrl, true),
    categories: categories as MarketplaceCategory[],
    marketplaceConfigured: item.marketplaceConfigured === 1,
    metadataState: item.metadataState as CatalogCandidate["metadataState"],
    registeredAt: integer(item.registeredAt, true),
    blockNumber: string(item.blockNumber, true),
    priority: integer(item.priority)!,
    ...(item.platformAttemptCount === undefined
      ? {}
      : { platformAttemptCount: integer(item.platformAttemptCount)! }),
    declarations: item.declarations.map(declaration),
    observations: item.observations.map(observation),
  };
}

function parsePage(value: unknown): CatalogCandidatePage {
  const data = record(value);
  if (data.schemaVersion !== 1 || data.chainId !== 56 || !CATALOG_STATUSES.includes(data.status as CatalogStatus)
    || !Array.isArray(data.items)) throw new Error("CATALOG_FEED_INVALID");
  const category = data.category;
  if (category !== null && !MARKETPLACE_CATEGORIES.includes(category as MarketplaceCategory)) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  return {
    status: data.status as CatalogStatus,
    query: string(data.query)!,
    category: category as MarketplaceCategory | null,
    generatedAt: integer(data.generatedAt)!,
    page: integer(data.page)!,
    limit: integer(data.limit)!,
    total: integer(data.total)!,
    items: data.items.map(candidate),
  };
}

function catalogUrl(pathname: "/catalog-agents" | "/catalog-agent", env: Readonly<Record<string, string | undefined>>): URL | null {
  const observations = env.OBSERVATIONS_URL?.trim();
  if (!observations) return null;
  try {
    const url = new URL(observations);
    const localDevelopment = env.NODE_ENV === "development"
      && url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if ((!localDevelopment && url.protocol !== "https:")
      || url.username || url.password || url.pathname !== "/observations") return null;
    return new URL(pathname, url.origin);
  } catch {
    return null;
  }
}

export async function getCatalogCandidatePage(input: {
  status: CatalogStatus;
  page: number;
  limit: number;
  q?: string;
  category?: MarketplaceCategory;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<CatalogCandidatePage | null> {
  const base = catalogUrl("/catalog-agents", input.env ?? process.env);
  if (!base) return null;
  base.searchParams.set("status", input.status);
  base.searchParams.set("page", String(input.page));
  base.searchParams.set("limit", String(input.limit));
  if (input.q) base.searchParams.set("q", input.q);
  if (input.category) base.searchParams.set("category", input.category);
  try {
    return await cache.get(`catalog:${base}`, CACHE_TTL_MS, async () => {
      const response = await fetch(base, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("CATALOG_FEED_UNAVAILABLE");
      return parsePage(await response.json());
    });
  } catch {
    return null;
  }
}

export async function getCatalogCandidate(input: {
  agentId: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<CatalogCandidate | null> {
  if (!/^[1-9]\d*$/.test(input.agentId)) return null;
  const url = catalogUrl("/catalog-agent", input.env ?? process.env);
  if (!url) return null;
  url.searchParams.set("agentId", input.agentId);
  try {
    return await cache.get(`catalog:${url}`, CACHE_TTL_MS, async () => {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("CATALOG_FEED_UNAVAILABLE");
      const data = record(await response.json());
      if (data.schemaVersion !== 1 || data.chainId !== 56 || data.agentId !== input.agentId
        || !Array.isArray(data.declarations) || !Array.isArray(data.observations)
        || data.agent === null) throw new Error("CATALOG_FEED_INVALID");
      return candidate({
        ...record(data.agent),
        platformAttemptCount: data.platformAttemptCount,
        declarations: data.declarations,
        observations: data.observations,
      });
    });
  } catch {
    return null;
  }
}
