import { AsyncTtlCache } from "../cache/async-ttl-cache.ts";
import {
  CATALOG_STATUSES,
  type CatalogCandidate,
  type CatalogCandidateDeclaration,
  type CatalogCandidateObservation,
  type CatalogCandidatePage,
  type CatalogFacetCounts,
  type CatalogStatus,
} from "../../business/entities/catalog-candidate.ts";
import { MARKETPLACE_CATEGORIES, type MarketplaceCategory } from "../../business/entities/marketplace-agent.ts";
import { isSafeImageUrl } from "../../trust8004/safe-url.ts";

const cache = new AsyncTtlCache();
const CACHE_TTL_MS = 30_000;
const OPERATIONAL_STATUSES = ["pending", "browser_observed", "platform_reachable", "platform_failed", "invalid_declaration", "unsafe", "unsupported"] as const;
const FRESHNESS = ["never", "live", "historical", "stale"] as const;
const COMMERCE_STATUSES = ["none", "declared", "admission_pending", "admitted", "suspended"] as const;
const QUOTE_STATUSES = ["not_supported", "not_requested", "verified_fresh", "verified_historical", "rejected"] as const;
const CAPABILITY_STATES = ["unsupported", "discovered", "ready", "stale", "failed", "suspended"] as const;
const BUYER_ACTIONS = ["unavailable", "check_availability", "request_quote", "prepare_hire"] as const;
const VALIDATION_KINDS = ["reachability", "protocol", "quote", "chain"] as const;
const VERIFICATION_LEVELS = ["user_observed", "platform_observed", "cryptographic", "onchain"] as const;

/**
 * The catalogue is cached briefly to protect the public feed. Validation and
 * quote actions write a new observation out of band, so those write routes
 * call this hook before asking the browser to refresh its server-rendered
 * card. Without it, a successful check could remain invisible for the cache
 * TTL (or until a hard reload).
 */
export function invalidateCatalogCandidateCache(): void {
  cache.clear();
}

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

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("CATALOG_FEED_INVALID");
  return value;
}

function declaration(value: unknown): CatalogCandidateDeclaration {
  const item = record(value);
  if (!/^[a-f0-9]{64}$/.test(String(item.endpointKey))
    || !["a2a", "mcp", "web", "erc8183_http"].includes(String(item.protocol))
    || !["safe", "unsafe"].includes(String(item.safety))) throw new Error("CATALOG_FEED_INVALID");
  const declaredProtocol = item.declaredProtocol;
  const role = item.role;
  const validationProtocol = item.validationProtocol;
  const externalKind = item.externalKind;
  const eligibility = item.eligibility;
  if ((declaredProtocol !== undefined
      && !["a2a", "mcp", "web", "erc8183_http", "x402", "unknown"].includes(String(declaredProtocol)))
    || (role !== undefined && !["operational", "external"].includes(String(role)))
    || (validationProtocol !== undefined && validationProtocol !== null
      && !["a2a", "mcp", "erc8183_http"].includes(String(validationProtocol)))
    || (externalKind !== undefined && externalKind !== null
      && !["website", "social", "repository", "documentation", "other"].includes(String(externalKind)))
    || (eligibility !== undefined
      && !["eligible", "unsafe", "invalid_declaration", "unsupported"].includes(String(eligibility)))) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  const result: CatalogCandidateDeclaration = {
    endpointKey: item.endpointKey as string,
    protocol: item.protocol as CatalogCandidateDeclaration["protocol"],
    endpoint: string(item.endpoint, true),
    originKey: string(item.originKey, true),
    safety: item.safety as CatalogCandidateDeclaration["safety"],
    safetyReason: string(item.safetyReason, true),
    representativeAgentKey: string(item.representativeAgentKey, true),
    lastProbedAt: integer(item.lastProbedAt, true),
    nextProbeAt: integer(item.nextProbeAt, true),
    consecutiveFailures: integer(item.consecutiveFailures)!,
    priority: integer(item.priority)!,
  };
  if (declaredProtocol !== undefined) {
    result.declaredProtocol = declaredProtocol as NonNullable<CatalogCandidateDeclaration["declaredProtocol"]>;
  }
  if (role !== undefined) result.role = role as NonNullable<CatalogCandidateDeclaration["role"]>;
  if (validationProtocol !== undefined) {
    result.validationProtocol = validationProtocol as Exclude<CatalogCandidateDeclaration["validationProtocol"], undefined>;
  }
  if (externalKind !== undefined) {
    result.externalKind = externalKind as Exclude<CatalogCandidateDeclaration["externalKind"], undefined>;
  }
  if (eligibility !== undefined) {
    result.eligibility = eligibility as NonNullable<CatalogCandidateDeclaration["eligibility"]>;
  }
  return result;
}

function observation(value: unknown, schemaVersion: 1 | 2): CatalogCandidateObservation {
  const item = record(value);
  const sources = schemaVersion === 2
    ? ["browser_reported", "worker_probe", "buyer_refresh", "chain_read", "migration"]
    : ["browser_reported", "worker_probe", "buyer_refresh", "chain_read", "migration", "marketplace_probe", "chain_index"];
  if (!/^[a-f0-9]{64}$/.test(String(item.endpointKey ?? "")) && item.endpointKey !== null) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  if (!["a2a", "mcp", "web", "erc8183_http", "erc8183"].includes(String(item.protocol))
    || !sources.includes(String(item.source))
    || !["protocol_valid", "cors_blocked", "http_error", "timeout", "network_error", "invalid_response",
      "unsafe_url", "erc8183_detected", "quote_verified", "quote_rejected", "unreachable", "error"].includes(String(item.outcome))) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  const validationKind = item.validationKind === undefined ? undefined : string(item.validationKind);
  const verificationLevel = item.verificationLevel === undefined ? undefined : string(item.verificationLevel);
  if ((validationKind !== undefined && !VALIDATION_KINDS.includes(validationKind as typeof VALIDATION_KINDS[number]))
    || (verificationLevel !== undefined
      && !VERIFICATION_LEVELS.includes(verificationLevel as typeof VERIFICATION_LEVELS[number]))) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  const artifactHash = item.artifactHash === undefined ? undefined : string(item.artifactHash, true);
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
    ...(validationKind === undefined ? {} : {
      validationKind: validationKind as NonNullable<CatalogCandidateObservation["validationKind"]>,
    }),
    ...(verificationLevel === undefined ? {} : {
      verificationLevel: verificationLevel as NonNullable<CatalogCandidateObservation["verificationLevel"]>,
    }),
    ...(artifactHash === undefined ? {} : { artifactHash }),
  };
}

function candidate(value: unknown, schemaVersion: 1 | 2): CatalogCandidate {
  const item = record(value);
  if (item.chainId !== 56 || !/^\d+$/.test(String(item.agentId))
    || !Array.isArray(item.declarations) || !Array.isArray(item.observations)) throw new Error("CATALOG_FEED_INVALID");
  let categories: unknown;
  try { categories = JSON.parse(String(item.categoriesJson)); } catch { throw new Error("CATALOG_FEED_INVALID"); }
  if (!Array.isArray(categories) || categories.some((entry) => !MARKETPLACE_CATEGORIES.includes(entry as MarketplaceCategory))) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  if (!["ok", "http_unreachable", "other"].includes(String(item.metadataState))) throw new Error("CATALOG_FEED_INVALID");
  const metadataVersion = item.metadataVersion === undefined
    ? undefined : string(item.metadataVersion, true);
  const metadataObservedAt = item.metadataObservedAt === undefined
    ? undefined : integer(item.metadataObservedAt, true);
  const admissionValue = item.admission === undefined || item.admission === null ? null : record(item.admission);
  if (admissionValue && !["candidate", "admitted", "suspended"].includes(String(admissionValue.state))) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  const stateValue = item.state === undefined ? null : record(item.state);
  if (schemaVersion === 2 && stateValue === null) throw new Error("CATALOG_FEED_INVALID");
  if (stateValue !== null && (!OPERATIONAL_STATUSES.includes(stateValue.operationalStatus as typeof OPERATIONAL_STATUSES[number])
    || !FRESHNESS.includes(stateValue.freshness as typeof FRESHNESS[number])
    || !COMMERCE_STATUSES.includes(stateValue.commerceStatus as typeof COMMERCE_STATUSES[number])
    || !QUOTE_STATUSES.includes(stateValue.quoteStatus as typeof QUOTE_STATUSES[number])
    || !BUYER_ACTIONS.includes(stateValue.buyerAction as typeof BUYER_ACTIONS[number])
    || (stateValue.capabilityState !== undefined
      && !CAPABILITY_STATES.includes(stateValue.capabilityState as typeof CAPABILITY_STATES[number]))
    || (stateValue.capabilityEndpointKey !== undefined && stateValue.capabilityEndpointKey !== null
      && !/^[a-f0-9]{64}$/.test(String(stateValue.capabilityEndpointKey)))
    || (stateValue.capabilityTransport !== undefined && stateValue.capabilityTransport !== null
      && !["a2a", "mcp", "erc8183_http"].includes(String(stateValue.capabilityTransport)))
    || (stateValue.capabilityLastAttemptAt !== undefined && stateValue.capabilityLastAttemptAt !== null
      && !Number.isSafeInteger(stateValue.capabilityLastAttemptAt))
    || (stateValue.capabilityLastErrorCode !== undefined && stateValue.capabilityLastErrorCode !== null
      && (typeof stateValue.capabilityLastErrorCode !== "string"
        || !/^[A-Z][A-Z0-9_]{2,63}$/.test(stateValue.capabilityLastErrorCode)))
    || (stateValue.capabilityExpiresAt !== undefined && stateValue.capabilityExpiresAt !== null
      && !Number.isSafeInteger(stateValue.capabilityExpiresAt))
    || (stateValue.quoteRequestCount !== undefined
      && (!Number.isSafeInteger(stateValue.quoteRequestCount) || Number(stateValue.quoteRequestCount) < 0))
    || (stateValue.quoteSuccessCount !== undefined
      && (!Number.isSafeInteger(stateValue.quoteSuccessCount) || Number(stateValue.quoteSuccessCount) < 0))
    || (stateValue.lastQuoteAttemptAt !== undefined && stateValue.lastQuoteAttemptAt !== null
      && !Number.isSafeInteger(stateValue.lastQuoteAttemptAt))
    || (stateValue.jobCount !== undefined
      && (!Number.isSafeInteger(stateValue.jobCount) || Number(stateValue.jobCount) < 0))
    || (stateValue.completedJobCount !== undefined
      && (!Number.isSafeInteger(stateValue.completedJobCount) || Number(stateValue.completedJobCount) < 0))
    || (stateValue.fundedJobCount !== undefined
      && (!Number.isSafeInteger(stateValue.fundedJobCount) || Number(stateValue.fundedJobCount) < 0))
    || (stateValue.submittedJobCount !== undefined
      && (!Number.isSafeInteger(stateValue.submittedJobCount) || Number(stateValue.submittedJobCount) < 0)))) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  const state = stateValue === null ? undefined : {
    operationalStatus: string(stateValue.operationalStatus)! as NonNullable<CatalogCandidate["state"]>["operationalStatus"],
    freshness: string(stateValue.freshness)! as NonNullable<CatalogCandidate["state"]>["freshness"],
    commerceStatus: string(stateValue.commerceStatus)! as NonNullable<CatalogCandidate["state"]>["commerceStatus"],
    quoteStatus: string(stateValue.quoteStatus)! as NonNullable<CatalogCandidate["state"]>["quoteStatus"],
    buyerAction: string(stateValue.buyerAction)! as NonNullable<CatalogCandidate["state"]>["buyerAction"],
    canRequestBrowserValidation: boolean(stateValue.canRequestBrowserValidation),
    canRequestInfrastructureValidation: boolean(stateValue.canRequestInfrastructureValidation),
    canRequestQuote: boolean(stateValue.canRequestQuote),
    canPrepareHire: boolean(stateValue.canPrepareHire),
    ...(stateValue.capabilityState === undefined ? {} : { capabilityState: stateValue.capabilityState as Exclude<NonNullable<CatalogCandidate["state"]>["capabilityState"], undefined> }),
    ...(stateValue.capabilityEndpointKey === undefined ? {} : { capabilityEndpointKey: string(stateValue.capabilityEndpointKey, true) }),
    ...(stateValue.capabilityTransport === undefined ? {} : { capabilityTransport: stateValue.capabilityTransport as "a2a" | "mcp" | "erc8183_http" | null }),
    ...(stateValue.capabilityLastAttemptAt === undefined ? {} : { capabilityLastAttemptAt: stateValue.capabilityLastAttemptAt as number | null }),
    ...(stateValue.capabilityLastErrorCode === undefined ? {} : { capabilityLastErrorCode: string(stateValue.capabilityLastErrorCode, true) }),
    ...(stateValue.capabilityExpiresAt === undefined ? {} : { capabilityExpiresAt: stateValue.capabilityExpiresAt as number | null }),
    ...(stateValue.quoteRequestCount === undefined ? {} : { quoteRequestCount: Number(stateValue.quoteRequestCount) }),
    ...(stateValue.quoteSuccessCount === undefined ? {} : { quoteSuccessCount: Number(stateValue.quoteSuccessCount) }),
    ...(stateValue.lastQuoteAttemptAt === undefined ? {} : { lastQuoteAttemptAt: stateValue.lastQuoteAttemptAt as number | null }),
    ...(stateValue.jobCount === undefined ? {} : { jobCount: Number(stateValue.jobCount) }),
    ...(stateValue.completedJobCount === undefined ? {} : { completedJobCount: Number(stateValue.completedJobCount) }),
    ...(stateValue.fundedJobCount === undefined ? {} : { fundedJobCount: Number(stateValue.fundedJobCount) }),
    ...(stateValue.submittedJobCount === undefined ? {} : { submittedJobCount: Number(stateValue.submittedJobCount) }),
    blockingReasons: Array.isArray(stateValue.blockingReasons)
      ? stateValue.blockingReasons.map((reason) => string(reason)!)
      : (() => { throw new Error("CATALOG_FEED_INVALID"); })(),
  };
  const parsedImageUrl = string(item.imageUrl, true);
  return {
    agentKey: string(item.agentKey)!,
    agentId: item.agentId as string,
    chainId: 56,
    owner: item.owner === undefined ? null : string(item.owner, true),
    metadataUri: item.metadataUri === undefined ? null : string(item.metadataUri, true),
    name: string(item.name, true),
    description: string(item.description, true),
    imageUrl: parsedImageUrl && isSafeImageUrl(parsedImageUrl) ? parsedImageUrl : null,
    categories: categories as MarketplaceCategory[],
    marketplaceConfigured: item.marketplaceConfigured === 1,
    metadataState: item.metadataState as CatalogCandidate["metadataState"],
    ...(metadataVersion === undefined ? {} : { metadataVersion }),
    ...(metadataObservedAt === undefined ? {} : { metadataObservedAt }),
    registeredAt: integer(item.registeredAt, true),
    blockNumber: string(item.blockNumber, true),
    priority: integer(item.priority)!,
    ...(item.platformAttemptCount === undefined
      ? {}
      : { platformAttemptCount: integer(item.platformAttemptCount)! }),
    admission: admissionValue ? {
      state: admissionValue.state as NonNullable<CatalogCandidate["admission"]>["state"],
      endpointKey: string(admissionValue.endpointKey, true),
    } : null,
    ...(state === undefined ? {} : { state }),
    declarations: item.declarations.map(declaration),
    observations: item.observations.map((entry) => observation(entry, schemaVersion)),
  };
}

function facets(value: unknown): CatalogFacetCounts {
  const item = record(value);
  const statuses = record(item.statuses);
  const categories = record(item.categories);
  const reachabilityValue = item.reachability;
  const reachability = reachabilityValue === undefined ? undefined : record(reachabilityValue);
  if (CATALOG_STATUSES.some((status) => !Number.isSafeInteger(statuses[status]) || Number(statuses[status]) < 0)
    || MARKETPLACE_CATEGORIES.some((category) => !Number.isSafeInteger(categories[category]) || Number(categories[category]) < 0)
    || (reachability !== undefined && ["live", "historical", "never", "browser_observed"].some((key) => (
      !Number.isSafeInteger(reachability[key]) || Number(reachability[key]) < 0
    )))) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  return {
    statuses: Object.fromEntries(CATALOG_STATUSES.map((status) => [status, Number(statuses[status])])) as CatalogFacetCounts["statuses"],
    categories: Object.fromEntries(MARKETPLACE_CATEGORIES.map((category) => [category, Number(categories[category])])) as CatalogFacetCounts["categories"],
    ...(reachability ? {
      reachability: {
        live: Number(reachability.live),
        historical: Number(reachability.historical),
        never: Number(reachability.never),
        browser_observed: Number(reachability.browser_observed),
      },
    } : {}),
  };
}

export function parseCatalogCandidatePage(value: unknown): CatalogCandidatePage {
  const data = record(value);
  if (![1, 2].includes(Number(data.schemaVersion)) || data.chainId !== 56 || !CATALOG_STATUSES.includes(data.status as CatalogStatus)
    || !Array.isArray(data.items)) throw new Error("CATALOG_FEED_INVALID");
  const category = data.category;
  if (category !== null && !MARKETPLACE_CATEGORIES.includes(category as MarketplaceCategory)) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  const statuses = data.statuses === undefined ? [data.status] : data.statuses;
  const categories = data.categories === undefined ? (category === null ? [] : [category]) : data.categories;
  if (!Array.isArray(statuses) || statuses.length === 0
    || statuses.some((status) => !CATALOG_STATUSES.includes(status as CatalogStatus))
    || !Array.isArray(categories)
    || categories.some((entry) => !MARKETPLACE_CATEGORIES.includes(entry as MarketplaceCategory))) {
    throw new Error("CATALOG_FEED_INVALID");
  }
  const schemaVersion = Number(data.schemaVersion) as 1 | 2;
  return {
    status: data.status as CatalogStatus,
    statuses: statuses as CatalogStatus[],
    query: string(data.query)!,
    category: category as MarketplaceCategory | null,
    categories: categories as MarketplaceCategory[],
    generatedAt: integer(data.generatedAt)!,
    page: integer(data.page)!,
    limit: integer(data.limit)!,
    total: integer(data.total)!,
    ...(data.facets === undefined ? {} : { facets: facets(data.facets) }),
    ...(data.nextCursor === undefined ? {} : { nextCursor: string(data.nextCursor, true) }),
    items: data.items.map((entry) => candidate(entry, schemaVersion)),
  };
}

export function catalogUrl(
  pathname: "/catalog-agents" | "/catalog-agent" | "/hire-events" | "/commerce-jobs" | "/commerce-summary" | `/commerce-jobs/${56 | 97}/${string}`,
  env: Readonly<Record<string, string | undefined>>,
): URL | null {
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
  status?: CatalogStatus;
  statuses?: CatalogStatus[];
  page: number;
  limit: number;
  q?: string;
  category?: MarketplaceCategory;
  categories?: MarketplaceCategory[];
  protocols?: Array<"a2a" | "mcp" | "erc8183_http">;
  reachability?: Array<"live" | "historical" | "never" | "browser_observed">;
  commerce?: Array<"declared" | "candidate" | "admitted" | "suspended" | "none">;
  quote?: Array<"verified" | "expired" | "missing">;
  latestFailure?: boolean;
  inventory?: "operational" | "registry";
  cursor?: string;
  includeFacets?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<CatalogCandidatePage | null> {
  const base = catalogUrl("/catalog-agents", input.env ?? process.env);
  if (!base) return null;
  const statuses = input.statuses?.length ? input.statuses : [input.status ?? "declared"];
  for (const status of statuses) base.searchParams.append("status", status);
  if (input.cursor) base.searchParams.set("cursor", input.cursor);
  else base.searchParams.set("page", String(input.page));
  base.searchParams.set("limit", String(input.limit));
  if (input.q) base.searchParams.set("q", input.q);
  const categories = input.categories?.length ? input.categories : input.category ? [input.category] : [];
  for (const category of categories) base.searchParams.append("category", category);
  for (const protocol of input.protocols ?? []) base.searchParams.append("protocol", protocol);
  for (const reachability of input.reachability ?? []) base.searchParams.append("reachability", reachability);
  for (const commerce of input.commerce ?? []) base.searchParams.append("commerce", commerce);
  for (const quote of input.quote ?? []) base.searchParams.append("quote", quote);
  if (input.latestFailure !== undefined) base.searchParams.set("latestFailure", String(input.latestFailure));
  if (input.inventory) base.searchParams.set("inventory", input.inventory);
  if (input.includeFacets) base.searchParams.set("facets", "true");
  try {
    return await cache.get(`catalog:${base}`, CACHE_TTL_MS, async () => {
      const response = await fetch(base, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("CATALOG_FEED_UNAVAILABLE");
      return parseCatalogCandidatePage(await response.json());
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
      return parseCatalogCandidateDetail(await response.json(), input.agentId);
    });
  } catch {
    return null;
  }
}

export function parseCatalogCandidateDetail(value: unknown, agentId: string): CatalogCandidate {
  const data = record(value);
  if (![1, 2].includes(Number(data.schemaVersion)) || data.chainId !== 56 || data.agentId !== agentId
    || !Array.isArray(data.declarations) || !Array.isArray(data.observations)
    || data.agent === null) throw new Error("CATALOG_FEED_INVALID");
  return candidate({
    ...record(data.agent),
    platformAttemptCount: data.platformAttemptCount,
    admission: data.admission,
    state: data.state,
    declarations: data.declarations,
    observations: data.observations,
  }, Number(data.schemaVersion) as 1 | 2);
}
