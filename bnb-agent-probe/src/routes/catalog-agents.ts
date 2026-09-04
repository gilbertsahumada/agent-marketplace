import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  not,
  or,
  sql,
  aliasedTable,
} from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import {
  createDatabase,
  readCatalogReachabilityFacets,
  readEffectiveAgentObservations,
  readEffectiveCatalogObservationsForAgents,
  readLatestBrowserObservationsForAgents,
} from "../db/orm";
import { deriveCatalogEvidenceState, selectBestCapability, type CapabilityFact, type SellerCapabilityState } from "../catalog/evidence-policy";
import { CATALOG_API_VERSION, publicCatalogObservation } from "../catalog/api-contract";
import {
  catalogAgentEndpoints,
  catalogAgents,
  catalogEndpoints,
  catalogObservations,
  catalogSellerCapabilities,
  catalogQuoteRequests,
  catalogQuoteAttempts,
  commerceJobs,
  hireEvents,
} from "../db/schema";
import type { D1Database } from "../types";

const STATUSES = [
  "declared", "pending", "a2a", "mcp", "mcp_only", "erc8183", "quote_capable", "hireable", "failed",
] as const;
type CatalogStatus = (typeof STATUSES)[number];
const PLATFORM_SOURCES = ["worker_probe", "buyer_refresh", "migration"] as const;
const PLATFORM_VALIDATION_KINDS = ["reachability", "protocol"] as const;
const FAILURE_OUTCOMES = [
  "http_error", "timeout", "network_error", "invalid_response", "unsafe_url", "quote_rejected", "unreachable", "error",
] as const;
const CATEGORIES = ["rebalancing", "grid_trading", "yield_optimisation", "health_factor_monitoring"] as const;
const PROTOCOLS = ["a2a", "mcp", "erc8183_http"] as const;
const REACHABILITY = ["live", "historical", "never", "browser_observed"] as const;
const COMMERCE = ["declared", "candidate", "admitted", "suspended", "none"] as const;
const QUOTE = ["verified", "expired", "missing"] as const;
const OPERATIONAL_STATUSES = new Set<CatalogStatus>([
  "a2a", "mcp", "mcp_only", "erc8183", "quote_capable", "hireable", "failed",
]);

const newerObservation = aliasedTable(catalogObservations, "newer_catalog_observation");
const newerQuoteObservation = aliasedTable(catalogObservations, "newer_catalog_quote_observation");

function invalid(): Response {
  return Response.json({ error: "invalid_request" }, {
    status: 400,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function parsePositive(value: string | null, fallback: number, maximum: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

function values<const T extends readonly string[]>(url: URL, key: string, allowed: T): Array<T[number]> | null {
  const entries = [...new Set(url.searchParams.getAll(key).map((value) => value.trim()).filter(Boolean))];
  return entries.length <= allowed.length && entries.every((entry) => allowed.includes(entry as T[number]))
    ? entries as Array<T[number]>
    : null;
}

type CatalogCursor = {
  priority: number;
  registeredAt: number | null;
  agentId: string;
};

function decodeCursor(value: string | null): CatalogCursor | null | undefined {
  if (value === null) return undefined;
  try {
    const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = JSON.parse(decoded) as Partial<CatalogCursor>;
    return Number.isSafeInteger(parsed.priority)
      && (parsed.registeredAt === null || Number.isSafeInteger(parsed.registeredAt))
      && typeof parsed.agentId === "string"
      && parsed.agentId.length >= 1
      && parsed.agentId.length <= 120
      ? parsed as CatalogCursor
      : null;
  } catch {
    return null;
  }
}

function encodeCursor(cursor: CatalogCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function catalogAgentsResponse(
  request: Request,
  d1: D1Database,
  nowMs: number,
  responseVersion: 1 | 2 = 2,
): Promise<Response> {
  const url = new URL(request.url);
  const allowedKeys = [
    "status", "page", "cursor", "limit", "q", "category", "protocol", "reachability",
    "commerce", "quote", "latestFailure", "chain", "inventory", "facets",
  ];
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.includes(key))) return invalid();
  const rawStatuses = url.searchParams.getAll("status");
  if (rawStatuses.length > STATUSES.length) return invalid();
  const statuses = [...new Set(rawStatuses)];
  if (statuses.length === 0) statuses.push("declared");
  if (statuses.some((status) => !STATUSES.includes(status as CatalogStatus))) return invalid();
  const page = parsePositive(url.searchParams.get("page"), 1, 100_000);
  const limit = parsePositive(url.searchParams.get("limit"), 24, 48);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (page === null || limit === null || cursor === null || (url.searchParams.has("cursor") && url.searchParams.has("page"))) return invalid();
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length > 120) return invalid();
  const rawCategories = url.searchParams.getAll("category").map((category) => category.trim()).filter(Boolean);
  if (rawCategories.length > CATEGORIES.length) return invalid();
  const categories = [...new Set(rawCategories)];
  if (categories.some((category) => !CATEGORIES.includes(category as (typeof CATEGORIES)[number]))) return invalid();
  const protocols = values(url, "protocol", PROTOCOLS);
  const reachability = values(url, "reachability", REACHABILITY);
  const commerce = values(url, "commerce", COMMERCE);
  const quote = values(url, "quote", QUOTE);
  if (protocols === null || reachability === null || commerce === null || quote === null) return invalid();
  const rawFailure = url.searchParams.get("latestFailure");
  const latestFailure = rawFailure === null ? null : rawFailure === "true" ? true : rawFailure === "false" ? false : null;
  if (rawFailure !== null && latestFailure === null) return invalid();
  const rawChain = url.searchParams.get("chain");
  if (rawChain !== null && rawChain !== "56") return invalid();
  const inventory = url.searchParams.get("inventory") ?? (responseVersion === 2 ? "operational" : "registry");
  if (!(["operational", "registry"] as const).includes(inventory as "operational" | "registry")) return invalid();
  const rawFacets = url.searchParams.get("facets");
  if (rawFacets !== null && rawFacets !== "true") return invalid();
  const includeFacets = responseVersion === 2 && rawFacets === "true";

  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  // Ready-to-quote is a capability projection, not an active buyer quote. A
  // correlated EXISTS keeps this filter/facet bounded by the agent index and
  // avoids materialising a potentially 20k-item key set in the Worker.
  const quoteCapableCondition = exists(db.select({ value: sql`1` })
    .from(catalogSellerCapabilities)
    .innerJoin(catalogAgentEndpoints, and(
      eq(catalogAgentEndpoints.agentKey, catalogSellerCapabilities.agentKey),
      eq(catalogAgentEndpoints.endpointKey, catalogSellerCapabilities.endpointKey),
    ))
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogSellerCapabilities.endpointKey))
    .where(and(
      eq(catalogSellerCapabilities.agentKey, catalogAgents.agentKey),
      eq(catalogSellerCapabilities.state, "ready"),
      gt(catalogSellerCapabilities.capabilityExpiresAt, nowMs),
      eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
      inArray(catalogEndpoints.validationProtocol, ["a2a", "mcp", "erc8183_http"]),
    )));
  const operationalDeclarationExists = exists(db.select({ value: sql`1` })
    .from(catalogAgentEndpoints)
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
    )));
  const observationBelongsToAgent = and(
    exists(db.select({ value: sql`1` })
      .from(catalogAgentEndpoints)
      .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
      .where(and(
        eq(catalogAgentEndpoints.agentKey, catalogObservations.agentKey),
        eq(catalogAgentEndpoints.endpointKey, catalogObservations.endpointKey),
        eq(catalogAgentEndpoints.declarationState, "current"),
        eq(catalogEndpoints.role, "operational"),
        eq(catalogEndpoints.eligibility, "eligible"),
      ))),
  );
  const platformObservationExists = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      eq(catalogObservations.agentKey, catalogAgents.agentKey),
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      inArray(catalogObservations.validationKind, [...PLATFORM_VALIDATION_KINDS]),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      observationBelongsToAgent,
    )));
  const freshProtocol = (protocol: "a2a" | "mcp" | "erc8183_http") => exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      eq(catalogObservations.agentKey, catalogAgents.agentKey),
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      inArray(catalogObservations.validationKind, [...PLATFORM_VALIDATION_KINDS]),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      eq(catalogObservations.protocol, protocol),
      eq(catalogObservations.outcome, "protocol_valid"),
      gt(catalogObservations.expiresAt, nowMs),
      observationBelongsToAgent,
      not(exists(db.select({ value: sql`1` }).from(newerObservation).where(and(
        eq(newerObservation.agentKey, catalogObservations.agentKey),
        eq(newerObservation.endpointKey, catalogObservations.endpointKey),
        inArray(newerObservation.source, [...PLATFORM_SOURCES]),
        inArray(newerObservation.validationKind, [...PLATFORM_VALIDATION_KINDS]),
        eq(newerObservation.verificationLevel, "platform_observed"),
        or(
          gt(newerObservation.observedAt, catalogObservations.observedAt),
          and(
            eq(newerObservation.observedAt, catalogObservations.observedAt),
            gt(newerObservation.id, catalogObservations.id),
          ),
        ),
      )))),
    )));
  const anyFreshProtocol = or(
    freshProtocol("a2a"),
    freshProtocol("mcp"),
    freshProtocol("erc8183_http"),
  );
  const anyPlatformSuccess = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      eq(catalogObservations.agentKey, catalogAgents.agentKey),
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      inArray(catalogObservations.validationKind, [...PLATFORM_VALIDATION_KINDS]),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      eq(catalogObservations.outcome, "protocol_valid"),
      observationBelongsToAgent,
    )));
  const browserSuccess = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      eq(catalogObservations.agentKey, catalogAgents.agentKey),
      eq(catalogObservations.source, "browser_reported"),
      eq(catalogObservations.outcome, "protocol_valid"),
      observationBelongsToAgent,
    )));
  const erc8183Declaration = exists(db.select({ value: sql`1` })
    .from(catalogAgentEndpoints)
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.declaredProtocol, "erc8183_http"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
      eq(catalogEndpoints.validationProtocol, "erc8183_http"),
    )));
  const mcpDeclarationExists = exists(db.select({ value: sql`1` })
    .from(catalogAgentEndpoints)
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
      eq(catalogEndpoints.validationProtocol, "mcp"),
    )));
  const sellerDeclarationExists = exists(db.select({ value: sql`1` })
    .from(catalogAgentEndpoints)
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
      inArray(catalogEndpoints.validationProtocol, ["a2a", "erc8183_http"]),
    )));
  // A capability probe may carry a valid signed receipt, but it is not a
  // buyer quote for a brief and must never satisfy the quote filters.
  const buyerQuoteObservation = sql`COALESCE(json_extract(${catalogObservations.detailsJson}, '$.quoteKind'), '') <> 'capability_probe'`;
  // A quote is only public evidence for the endpoint that is currently
  // ready-to-quote. This prevents an old/superseded declaration from making
  // the seller appear quote-ready after its active endpoint changed.
  const quoteOnReadyCapability = exists(db.select({ value: sql`1` })
    .from(catalogSellerCapabilities)
    .where(and(
      eq(catalogSellerCapabilities.agentKey, catalogObservations.agentKey),
      eq(catalogSellerCapabilities.endpointKey, catalogObservations.endpointKey),
      eq(catalogSellerCapabilities.state, "ready"),
      gt(catalogSellerCapabilities.capabilityExpiresAt, nowMs),
    )));
  const quoteOnKnownCapability = exists(db.select({ value: sql`1` })
    .from(catalogSellerCapabilities)
    .where(and(
      eq(catalogSellerCapabilities.agentKey, catalogObservations.agentKey),
      eq(catalogSellerCapabilities.endpointKey, catalogObservations.endpointKey),
    )));
  const freshQuote = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      eq(catalogObservations.agentKey, catalogAgents.agentKey),
      observationBelongsToAgent,
      eq(catalogObservations.validationKind, "quote"),
      eq(catalogObservations.verificationLevel, "cryptographic"),
      eq(catalogObservations.outcome, "quote_verified"),
      buyerQuoteObservation,
      quoteOnReadyCapability,
      gt(catalogObservations.expiresAt, nowMs),
      not(exists(db.select({ value: sql`1` }).from(newerQuoteObservation).where(and(
        eq(newerQuoteObservation.agentKey, catalogObservations.agentKey),
        eq(newerQuoteObservation.endpointKey, catalogObservations.endpointKey),
        eq(newerQuoteObservation.validationKind, "quote"),
        eq(newerQuoteObservation.verificationLevel, "cryptographic"),
        or(
          gt(newerQuoteObservation.observedAt, catalogObservations.observedAt),
          and(
            eq(newerQuoteObservation.observedAt, catalogObservations.observedAt),
            gt(newerQuoteObservation.id, catalogObservations.id),
          ),
        ),
      )))),
    )));
  const anyQuote = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      eq(catalogObservations.agentKey, catalogAgents.agentKey),
      observationBelongsToAgent,
      eq(catalogObservations.validationKind, "quote"),
      eq(catalogObservations.verificationLevel, "cryptographic"),
      eq(catalogObservations.outcome, "quote_verified"),
      buyerQuoteObservation,
      quoteOnKnownCapability,
    )));
  const freshValid = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      eq(catalogObservations.agentKey, catalogAgents.agentKey),
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      inArray(catalogObservations.validationKind, [...PLATFORM_VALIDATION_KINDS]),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      inArray(catalogObservations.outcome, ["protocol_valid", "quote_verified"]),
      gt(catalogObservations.expiresAt, nowMs),
      observationBelongsToAgent,
      not(exists(db.select({ value: sql`1` }).from(newerObservation).where(and(
        eq(newerObservation.agentKey, catalogObservations.agentKey),
        eq(newerObservation.endpointKey, catalogObservations.endpointKey),
        inArray(newerObservation.source, [...PLATFORM_SOURCES]),
        inArray(newerObservation.validationKind, [...PLATFORM_VALIDATION_KINDS]),
        eq(newerObservation.verificationLevel, "platform_observed"),
        or(
          gt(newerObservation.observedAt, catalogObservations.observedAt),
          and(
            eq(newerObservation.observedAt, catalogObservations.observedAt),
            gt(newerObservation.id, catalogObservations.id),
          ),
        ),
      )))),
    )));
  const failureExists = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      eq(catalogObservations.agentKey, catalogAgents.agentKey),
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      inArray(catalogObservations.validationKind, [...PLATFORM_VALIDATION_KINDS]),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      inArray(catalogObservations.outcome, [...FAILURE_OUTCOMES]),
      observationBelongsToAgent,
      not(exists(db.select({ value: sql`1` }).from(newerObservation).where(and(
        eq(newerObservation.agentKey, catalogObservations.agentKey),
        eq(newerObservation.endpointKey, catalogObservations.endpointKey),
        inArray(newerObservation.source, [...PLATFORM_SOURCES]),
        inArray(newerObservation.validationKind, [...PLATFORM_VALIDATION_KINDS]),
        eq(newerObservation.verificationLevel, "platform_observed"),
        or(
          gt(newerObservation.observedAt, catalogObservations.observedAt),
          and(
            eq(newerObservation.observedAt, catalogObservations.observedAt),
            gt(newerObservation.id, catalogObservations.id),
          ),
        ),
      )))),
    )));
  const latestReachableExists = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      eq(catalogObservations.agentKey, catalogAgents.agentKey),
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      inArray(catalogObservations.validationKind, [...PLATFORM_VALIDATION_KINDS]),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      eq(catalogObservations.outcome, "protocol_valid"),
      observationBelongsToAgent,
      not(exists(db.select({ value: sql`1` }).from(newerObservation).where(and(
        eq(newerObservation.agentKey, catalogObservations.agentKey),
        eq(newerObservation.endpointKey, catalogObservations.endpointKey),
        inArray(newerObservation.source, [...PLATFORM_SOURCES]),
        inArray(newerObservation.validationKind, [...PLATFORM_VALIDATION_KINDS]),
        eq(newerObservation.verificationLevel, "platform_observed"),
        or(
          gt(newerObservation.observedAt, catalogObservations.observedAt),
          and(
            eq(newerObservation.observedAt, catalogObservations.observedAt),
            gt(newerObservation.id, catalogObservations.id),
          ),
        ),
      )))),
    )));
  const capabilityState = (state: "discovered" | "stale" | "failed" | "suspended") => exists(db.select({ value: sql`1` })
    .from(catalogSellerCapabilities)
    .where(and(
      eq(catalogSellerCapabilities.agentKey, catalogAgents.agentKey),
      eq(catalogSellerCapabilities.state, state),
    )));
  // Every current catalog row is an ERC-8004 identity declaration. Endpoint
  // declarations are optional, so registry inventory must retain identities
  // whose metadata has not yielded an operational resource yet.
  const statusCondition = (status: string) => status === "declared" ? sql`1 = 1`
    : status === "pending" ? not(platformObservationExists)
      : status === "a2a" ? freshProtocol("a2a")
        : status === "mcp" ? freshProtocol("mcp")
          : status === "mcp_only" ? and(mcpDeclarationExists, not(sellerDeclarationExists), not(quoteCapableCondition))!
          : status === "erc8183" ? erc8183Declaration
              : status === "quote_capable" ? quoteCapableCondition
              // Keep the legacy query alias, but make it mean the same thing
              // as Ready to quote. Manual admission is no longer a hiring
              // prerequisite and must not hide compatible sellers.
              : status === "hireable" ? quoteCapableCondition
                : and(failureExists, not(latestReachableExists), not(freshValid))!;
  const escapedQuery = q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const searchCondition = q.length === 0 ? undefined : or(
    eq(catalogAgents.agentId, q),
    sql`${catalogAgents.name} LIKE ${`%${escapedQuery}%`} ESCAPE '\\'`,
  );
  const categoryCondition = categories.length === 0 ? undefined : or(...categories.map((category) => sql`EXISTS (
    SELECT 1 FROM json_each(${catalogAgents.categoriesJson}) WHERE value = ${category}
  )`));
  const protocolCondition = protocols.length === 0 ? undefined : exists(db.select({ value: sql`1` })
    .from(catalogAgentEndpoints)
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
      inArray(catalogEndpoints.validationProtocol, protocols),
      eq(catalogEndpoints.eligibility, "eligible"),
    )));
  const reachabilityCondition = reachability.length === 0 ? undefined : or(...reachability.map((value) => value === "live"
    ? anyFreshProtocol!
    : value === "historical" ? and(anyPlatformSuccess, not(anyFreshProtocol!))!
      : value === "never" ? not(anyPlatformSuccess)
        : and(browserSuccess, not(anyPlatformSuccess))!));
  const commerceCondition = commerce.length === 0 ? undefined : or(...commerce.map((value) => value === "declared"
    ? sellerDeclarationExists
    : value === "none" ? not(sellerDeclarationExists)
      : value === "candidate" ? and(sellerDeclarationExists, not(quoteCapableCondition), not(capabilityState("suspended")))!
        : value === "admitted" ? quoteCapableCondition
          : capabilityState(value)));
  const quoteCondition = quote.length === 0 ? undefined : or(...quote.map((value) => value === "verified"
    ? freshQuote
    : value === "expired" ? and(anyQuote, not(freshQuote))!
      : not(anyQuote)));
  // Statuses are one facet: selecting several evidence states means “match
  // any of these states”, while the default declared value is only the
  // identity-scope sentinel and must not turn the OR into a tautology.
  const selectedStatusConditions = statuses
    .filter((status) => status !== "declared")
    .map(statusCondition);
  const statusConditionCombined = selectedStatusConditions.length > 0
    ? or(...selectedStatusConditions)
    : statusCondition("declared");
  const where = and(
    eq(catalogAgents.indexState, "current"),
    inventory === "operational" && !statuses.some((status) => OPERATIONAL_STATUSES.has(status as CatalogStatus))
      ? operationalDeclarationExists
      : undefined,
    statusConditionCombined,
    searchCondition,
    categoryCondition,
    protocolCondition,
    reachabilityCondition,
    commerceCondition,
    quoteCondition,
    latestFailure === null ? undefined : latestFailure ? failureExists : not(failureExists),
    rawChain === null ? undefined : eq(catalogAgents.chainId, 56),
  );
  const facetCount = (condition: ReturnType<typeof statusCondition>) =>
    sql<number>`COALESCE(SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END), 0)`;
  const categoryFacetCount = (category: (typeof CATEGORIES)[number]) =>
    sql<number>`COALESCE(SUM(CASE WHEN EXISTS (
      SELECT 1 FROM json_each(${catalogAgents.categoriesJson}) WHERE value = ${category}
    ) THEN 1 ELSE 0 END), 0)`;
  const operationalBase = and(
    eq(catalogAgents.indexState, "current"),
    operationalDeclarationExists,
  );
  const countFacet = (status: CatalogStatus) => db.select({ count: count() })
    .from(catalogAgents).where(and(operationalBase, statusCondition(status)));
  const facetRowsPromise = includeFacets
    ? Promise.all([
      db.select({
        declared: count(),
        mcpOnly: facetCount(statusCondition("mcp_only")),
        erc8183: facetCount(statusCondition("erc8183")),
        hireable: facetCount(statusCondition("hireable")),
        rebalancing: categoryFacetCount("rebalancing"),
        gridTrading: categoryFacetCount("grid_trading"),
        yieldOptimisation: categoryFacetCount("yield_optimisation"),
        healthFactorMonitoring: categoryFacetCount("health_factor_monitoring"),
      }).from(catalogAgents).where(operationalBase),
      countFacet("pending"),
      countFacet("a2a"),
      countFacet("mcp"),
      countFacet("quote_capable"),
      countFacet("failed"),
      readCatalogReachabilityFacets(db, nowMs),
    ]).then(([simple, pending, a2a, mcp, quoteCapable, failed, reachabilityFacets]) => [{
      ...simple[0]!,
      pending: pending[0]?.count ?? 0,
      a2a: a2a[0]?.count ?? 0,
      mcp: mcp[0]?.count ?? 0,
      quoteCapable: quoteCapable[0]?.count ?? 0,
      failed: failed[0]?.count ?? 0,
      live: reachabilityFacets.live,
      historical: reachabilityFacets.historical,
      never: reachabilityFacets.never,
      browserObserved: reachabilityFacets.browserObserved,
    }])
    : Promise.resolve([]);
  const cursorCondition = cursor === undefined ? undefined : or(
    lt(catalogAgents.priority, cursor.priority),
    and(
      eq(catalogAgents.priority, cursor.priority),
      cursor.registeredAt === null
        ? and(isNull(catalogAgents.registeredAt), gt(catalogAgents.agentId, cursor.agentId))
        : or(
          lt(catalogAgents.registeredAt, cursor.registeredAt),
          isNull(catalogAgents.registeredAt),
          and(
            eq(catalogAgents.registeredAt, cursor.registeredAt),
            gt(catalogAgents.agentId, cursor.agentId),
          ),
        ),
    ),
  );
  const offset = (page - 1) * limit;
  const [totals, pageRows, facetRows] = await Promise.all([
    db.select({ count: count() }).from(catalogAgents).where(where),
    db.select().from(catalogAgents).where(and(where, cursorCondition))
      .orderBy(desc(catalogAgents.priority), desc(catalogAgents.registeredAt), catalogAgents.agentId)
      .limit(limit + 1).offset(cursor === undefined ? offset : 0),
    facetRowsPromise,
  ]);
  const hasNextPage = pageRows.length > limit;
  const agents = pageRows.slice(0, limit);
  const agentKeys = agents.map((agent) => agent.agentKey);
  const declarations = agentKeys.length === 0 ? [] : await db.select({
    agentKey: catalogAgentEndpoints.agentKey,
    priority: catalogAgentEndpoints.priority,
    endpoint: catalogEndpoints,
  }).from(catalogAgentEndpoints)
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      inArray(catalogAgentEndpoints.agentKey, agentKeys),
      eq(catalogAgentEndpoints.declarationState, "current"),
    ));
  const endpointKeys = declarations
    .filter(({ endpoint }) => endpoint.role === "operational" && endpoint.eligibility === "eligible")
    .map((entry) => entry.endpoint.endpointKey);
  const [browserObservations, effectiveEndpointObservations, effectiveAgentObservations, platformAttemptCounts, capabilities, quoteStats, jobStats] = await Promise.all([
    readLatestBrowserObservationsForAgents(db, agentKeys),
    readEffectiveCatalogObservationsForAgents(db, agentKeys, endpointKeys),
    readEffectiveAgentObservations(db, agentKeys),
    // Counted per (agent, endpoint) straight off the agent index and joined to
    // the page's current operational declarations in memory: joining the
    // endpoint tables in SQL made the planner drive from catalog_endpoints and
    // read every eligible endpoint's observations for each page.
    agentKeys.length === 0 ? Promise.resolve([]) : db.select({
      agentKey: catalogObservations.agentKey,
      endpointKey: catalogObservations.endpointKey,
      total: count(),
    }).from(catalogObservations)
      .where(and(
        inArray(catalogObservations.agentKey, agentKeys),
        inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
        inArray(catalogObservations.validationKind, [...PLATFORM_VALIDATION_KINDS]),
        eq(catalogObservations.verificationLevel, "platform_observed"),
      )).groupBy(catalogObservations.agentKey, catalogObservations.endpointKey),
    agentKeys.length === 0 ? Promise.resolve([]) : db.select().from(catalogSellerCapabilities)
      .where(inArray(catalogSellerCapabilities.agentKey, agentKeys))
      .orderBy(desc(catalogSellerCapabilities.updatedAt)),
    agentKeys.length === 0 ? Promise.resolve([]) : db.select({
      agentKey: catalogQuoteRequests.agentKey,
      // Count logical buyer requests once even when browser-first execution
      // also records a Worker fallback attempt.
      requestCount: countDistinct(catalogQuoteRequests.id),
      successCount: sql<number>`COUNT(DISTINCT CASE WHEN ${catalogQuoteRequests.status} = 'succeeded' THEN ${catalogQuoteRequests.id} END)`,
      lastAttemptAt: sql<number | null>`MAX(${catalogQuoteAttempts.startedAt})`,
    }).from(catalogQuoteRequests)
      .leftJoin(catalogQuoteAttempts, eq(catalogQuoteAttempts.requestId, catalogQuoteRequests.id))
      .where(and(inArray(catalogQuoteRequests.agentKey, agentKeys), eq(catalogQuoteRequests.kind, "buyer_quote")))
      .groupBy(catalogQuoteRequests.agentKey),
    agentKeys.length === 0 ? Promise.resolve([]) : db.select({
      agentId: hireEvents.agentId,
      total: countDistinct(sql`CAST(${commerceJobs.jobId} AS TEXT)`),
      completed: sql<number>`COUNT(DISTINCT CASE WHEN ${commerceJobs.status} = 3 THEN CAST(${commerceJobs.jobId} AS TEXT) END)`,
      funded: sql<number>`COUNT(DISTINCT CASE WHEN ${commerceJobs.status} = 1 THEN CAST(${commerceJobs.jobId} AS TEXT) END)`,
      submitted: sql<number>`COUNT(DISTINCT CASE WHEN ${commerceJobs.status} = 2 THEN CAST(${commerceJobs.jobId} AS TEXT) END)`,
    }).from(hireEvents)
      .innerJoin(commerceJobs, and(
        eq(hireEvents.chainId, commerceJobs.chainId),
        eq(hireEvents.jobId, sql`CAST(${commerceJobs.jobId} AS TEXT)`),
      ))
      .where(and(
        eq(hireEvents.chainId, 56),
        inArray(hireEvents.agentId, agents.map((agent) => agent.agentId)),
        eq(hireEvents.provenance, "chain_verified"),
      ))
      .groupBy(hireEvents.agentId),
  ]);
  const operationalDeclarationKeys = new Set(declarations
    .filter((entry) => entry.endpoint.role === "operational" && entry.endpoint.eligibility === "eligible")
    .map((entry) => `${entry.agentKey}\n${entry.endpoint.endpointKey}`));
  const platformAttemptCountByAgent = new Map<string, number>();
  for (const row of platformAttemptCounts) {
    if (row.endpointKey === null || !operationalDeclarationKeys.has(`${row.agentKey}\n${row.endpointKey}`)) continue;
    platformAttemptCountByAgent.set(row.agentKey, (platformAttemptCountByAgent.get(row.agentKey) ?? 0) + row.total);
  }
  const observations = [...new Map([
    ...browserObservations,
    ...effectiveEndpointObservations,
    ...effectiveAgentObservations,
  ].map((observation) => [observation.id, observation])).values()]
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);

  const items = agents.map((agent) => {
    const agentDeclarations = declarations.filter((entry) => entry.agentKey === agent.agentKey);
    const agentObservations = observations.filter((observation) => observation.agentKey === agent.agentKey);
    // The capability ledger is the runtime authority. The former admission
    // table remains only for migration/backfill and is intentionally not read
    // while serving catalogue pages.
    const admission = null;
    const capabilityRows: Array<CapabilityFact & { endpointKey: string; transport: "a2a" | "mcp" | "erc8183_http" }> = capabilities
      .filter((entry) => entry.agentKey === agent.agentKey)
      .map((entry) => ({
        endpointKey: entry.endpointKey,
        transport: entry.transport as "a2a" | "mcp" | "erc8183_http",
        state: entry.state as SellerCapabilityState,
        lastSuccessAt: entry.lastSuccessAt ?? null,
        capabilityExpiresAt: entry.capabilityExpiresAt ?? null,
        lastAttemptAt: entry.lastAttemptAt ?? null,
        consecutiveFailures: entry.consecutiveFailures ?? 0,
        lastErrorCode: entry.lastErrorCode ?? null,
      }));
    const capability = selectBestCapability(capabilityRows, nowMs);
    const quoteStat = quoteStats.find((entry) => entry.agentKey === agent.agentKey);
    const jobStat = jobStats.find((entry) => entry.agentId === agent.agentId);
    return {
      ...agent,
      admission,
      platformAttemptCount: platformAttemptCountByAgent.get(agent.agentKey) ?? 0,
      state: deriveCatalogEvidenceState({
        endpoints: agentDeclarations.map(({ endpoint }) => endpoint),
        observations: agentObservations,
        admission,
        capability: capability ? {
          ...(capability.endpointKey ? { endpointKey: capability.endpointKey } : {}),
          ...(capability.transport ? { transport: capability.transport } : {}),
          state: capability.state as "unsupported" | "discovered" | "ready" | "stale" | "failed" | "suspended",
          lastSuccessAt: capability.lastSuccessAt ?? null,
          capabilityExpiresAt: capability.capabilityExpiresAt ?? null,
          lastAttemptAt: capability.lastAttemptAt ?? null,
          consecutiveFailures: capability.consecutiveFailures ?? 0,
          lastErrorCode: capability.lastErrorCode ?? null,
        } : null,
        ...(quoteStat ? { quoteStats: {
          requestCount: Number(quoteStat.requestCount),
          successCount: Number(quoteStat.successCount),
          lastAttemptAt: quoteStat.lastAttemptAt ?? null,
        } } : {}),
        ...(jobStat ? { jobStats: {
          total: Number(jobStat.total),
          completed: Number(jobStat.completed),
          funded: Number(jobStat.funded),
          submitted: Number(jobStat.submitted),
        } } : {}),
        nowMs,
      }),
      declarations: agentDeclarations.map((entry) => ({
        ...entry.endpoint,
        priority: entry.priority,
      })),
      observations: agentObservations.map(publicCatalogObservation),
    };
  });
  const compatibilityItems = items.map(({ admission: _admission, state: _state, ...item }) => item);
  const facetRow = facetRows[0];
  const facets = facetRow ? {
    statuses: {
      declared: Number(facetRow.declared),
      pending: Number(facetRow.pending),
      a2a: Number(facetRow.a2a),
      mcp: Number(facetRow.mcp),
      mcp_only: Number(facetRow.mcpOnly),
      erc8183: Number(facetRow.erc8183),
      quote_capable: Number(facetRow.quoteCapable),
      hireable: Number(facetRow.hireable),
      failed: Number(facetRow.failed),
    },
    categories: {
      rebalancing: Number(facetRow.rebalancing),
      grid_trading: Number(facetRow.gridTrading),
      yield_optimisation: Number(facetRow.yieldOptimisation),
      health_factor_monitoring: Number(facetRow.healthFactorMonitoring),
    },
    reachability: {
      live: Number(facetRow.live),
      historical: Number(facetRow.historical),
      never: Number(facetRow.never),
      browser_observed: Number(facetRow.browserObserved),
    },
  } : undefined;
  const body = responseVersion === 1 ? {
    schemaVersion: 1,
    chainId: 56,
    status: statuses[0],
    page,
    limit,
    query: q,
    category: categories[0] ?? null,
    generatedAt: nowMs,
    total: totals[0]?.count ?? 0,
    items: compatibilityItems,
  } : {
    schemaVersion: 2,
    apiVersion: CATALOG_API_VERSION,
    chainId: 56,
    status: statuses[0],
    statuses,
    page,
    limit,
    query: q,
    category: categories[0] ?? null,
    categories,
    filters: {
      protocols,
      reachability,
      commerce,
      quote,
      latestFailure,
      chainId: rawChain === null ? null : 56,
      inventory,
    },
    generatedAt: nowMs,
    total: totals[0]?.count ?? 0,
    ...(facets ? { facets } : {}),
    nextCursor: hasNextPage && agents.length > 0 ? encodeCursor({
      priority: agents.at(-1)!.priority,
      registeredAt: agents.at(-1)!.registeredAt,
      agentId: agents.at(-1)!.agentId,
    }) : null,
    items,
  };
  return Response.json(body, {
    headers: {
      "cache-control": "public, max-age=30, stale-while-revalidate=60",
      "x-content-type-options": "nosniff",
    },
  });
}
