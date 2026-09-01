import {
  and,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  not,
  or,
  sql,
  aliasedTable,
} from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import {
  createDatabase,
  readEffectiveAgentObservations,
  readEffectiveCatalogObservationsForAgents,
} from "../db/orm";
import { deriveCatalogEvidenceState } from "../catalog/evidence-policy";
import { CATALOG_API_VERSION, publicCatalogObservation } from "../catalog/api-contract";
import {
  catalogAgentAdmission,
  catalogAgentEndpoints,
  catalogAgents,
  catalogEndpoints,
  catalogObservations,
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

function decodeCursor(value: string | null): number | null {
  if (value === null) return 0;
  try {
    const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return /^\d+$/.test(decoded) && Number.isSafeInteger(Number(decoded)) ? Number(decoded) : null;
  } catch {
    return null;
  }
}

function encodeCursor(offset: number): string {
  return btoa(String(offset)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
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
    "commerce", "quote", "latestFailure", "chain", "inventory",
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

  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const declarationExists = exists(db.select({ value: sql`1` })
    .from(catalogAgentEndpoints)
    .where(and(
      eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
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
    eq(catalogObservations.agentKey, catalogAgents.agentKey),
    exists(db.select({ value: sql`1` })
      .from(catalogAgentEndpoints)
      .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
      .where(and(
        eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey),
        eq(catalogAgentEndpoints.endpointKey, catalogObservations.endpointKey),
        eq(catalogAgentEndpoints.declarationState, "current"),
        eq(catalogEndpoints.role, "operational"),
        eq(catalogEndpoints.eligibility, "eligible"),
      ))),
  );
  const platformObservationExists = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      inArray(catalogObservations.validationKind, [...PLATFORM_VALIDATION_KINDS]),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      observationBelongsToAgent,
    )));
  const freshProtocol = (protocol: "a2a" | "mcp" | "erc8183_http") => exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
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
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      inArray(catalogObservations.validationKind, [...PLATFORM_VALIDATION_KINDS]),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      eq(catalogObservations.outcome, "protocol_valid"),
      observationBelongsToAgent,
    )));
  const browserSuccess = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
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
  const admittedCommerce = exists(db.select({ value: sql`1` })
    .from(catalogAgentAdmission)
    .innerJoin(catalogAgentEndpoints, and(
      eq(catalogAgentEndpoints.agentKey, catalogAgentAdmission.agentKey),
      eq(catalogAgentEndpoints.endpointKey, catalogAgentAdmission.endpointKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
    ))
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgentAdmission.agentKey, catalogAgents.agentKey),
      eq(catalogAgentAdmission.state, "admitted"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
      inArray(catalogEndpoints.validationProtocol, ["a2a", "erc8183_http"]),
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
  const admittedCommerceObservation = exists(db.select({ value: sql`1` })
    .from(catalogAgentAdmission)
    .innerJoin(catalogAgentEndpoints, and(
      eq(catalogAgentEndpoints.agentKey, catalogObservations.agentKey),
      eq(catalogAgentEndpoints.endpointKey, catalogObservations.endpointKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
    ))
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgentAdmission.agentKey, catalogObservations.agentKey),
      eq(catalogAgentAdmission.endpointKey, catalogObservations.endpointKey),
      eq(catalogAgentAdmission.state, "admitted"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
      inArray(catalogEndpoints.validationProtocol, ["a2a", "erc8183_http"]),
    )));
  const freshQuote = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      observationBelongsToAgent,
      admittedCommerceObservation,
      eq(catalogObservations.validationKind, "quote"),
      eq(catalogObservations.verificationLevel, "cryptographic"),
      eq(catalogObservations.outcome, "quote_verified"),
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
      observationBelongsToAgent,
      admittedCommerceObservation,
      eq(catalogObservations.validationKind, "quote"),
      eq(catalogObservations.verificationLevel, "cryptographic"),
      eq(catalogObservations.outcome, "quote_verified"),
    )));
  const freshValid = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
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
  const admissionState = (state: "candidate" | "admitted" | "suspended") => exists(db.select({ value: sql`1` })
    .from(catalogAgentAdmission)
    .where(and(eq(catalogAgentAdmission.agentKey, catalogAgents.agentKey), eq(catalogAgentAdmission.state, state))));
  const anyAdmission = exists(db.select({ value: sql`1` }).from(catalogAgentAdmission)
    .where(eq(catalogAgentAdmission.agentKey, catalogAgents.agentKey)));
  const statusCondition = (status: string) => status === "declared" ? declarationExists
    : status === "pending" ? not(platformObservationExists)
      : status === "a2a" ? freshProtocol("a2a")
        : status === "mcp" ? freshProtocol("mcp")
          : status === "mcp_only" ? and(mcpDeclarationExists, not(sellerDeclarationExists))!
          : status === "erc8183" ? erc8183Declaration
            : status === "quote_capable" ? freshQuote
              : status === "hireable" ? admittedCommerce
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
    ? erc8183Declaration
    : value === "none" ? not(anyAdmission)
      : admissionState(value)));
  const quoteCondition = quote.length === 0 ? undefined : or(...quote.map((value) => value === "verified"
    ? freshQuote
    : value === "expired" ? and(anyQuote, not(freshQuote))!
      : not(anyQuote)));
  const where = and(
    eq(catalogAgents.indexState, "current"),
    inventory === "operational" ? operationalDeclarationExists : undefined,
    ...statuses.map(statusCondition),
    searchCondition,
    categoryCondition,
    protocolCondition,
    reachabilityCondition,
    commerceCondition,
    quoteCondition,
    latestFailure === null ? undefined : latestFailure ? failureExists : not(failureExists),
    rawChain === null ? undefined : eq(catalogAgents.chainId, 56),
  );
  const offset = url.searchParams.has("cursor") ? cursor : (page - 1) * limit;
  const [totals, agents] = await Promise.all([
    db.select({ count: count() }).from(catalogAgents).where(where),
    db.select().from(catalogAgents).where(where)
      .orderBy(desc(catalogAgents.priority), desc(catalogAgents.registeredAt), catalogAgents.agentId)
      .limit(limit).offset(offset),
  ]);
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
  const endpointKeys = declarations.map((entry) => entry.endpoint.endpointKey);
  const [recentObservations, effectiveEndpointObservations, effectiveAgentObservations, admissions, platformAttemptCounts] = await Promise.all([
    agentKeys.length === 0 ? Promise.resolve([]) : db.select().from(catalogObservations)
      .where(inArray(catalogObservations.agentKey, agentKeys))
      .orderBy(desc(catalogObservations.observedAt), desc(catalogObservations.id))
      .limit(Math.min(1_000, limit * 20)),
    readEffectiveCatalogObservationsForAgents(db, agentKeys, endpointKeys),
    readEffectiveAgentObservations(db, agentKeys),
    agentKeys.length === 0 ? Promise.resolve([]) : db.select().from(catalogAgentAdmission)
      .where(inArray(catalogAgentAdmission.agentKey, agentKeys)),
    agentKeys.length === 0 ? Promise.resolve([]) : db.select({
      agentKey: catalogObservations.agentKey,
      total: count(),
    }).from(catalogObservations)
      .innerJoin(catalogAgentEndpoints, and(
        eq(catalogAgentEndpoints.agentKey, catalogObservations.agentKey),
        eq(catalogAgentEndpoints.endpointKey, catalogObservations.endpointKey),
        eq(catalogAgentEndpoints.declarationState, "current"),
      ))
      .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogObservations.endpointKey))
      .where(and(
      inArray(catalogObservations.agentKey, agentKeys),
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      inArray(catalogObservations.validationKind, [...PLATFORM_VALIDATION_KINDS]),
      eq(catalogObservations.verificationLevel, "platform_observed"),
      eq(catalogEndpoints.role, "operational"),
      eq(catalogEndpoints.eligibility, "eligible"),
    )).groupBy(catalogObservations.agentKey),
  ]);
  const platformAttemptCountByAgent = new Map(platformAttemptCounts.map((row) => [row.agentKey, row.total]));
  const observations = [...new Map([
    ...recentObservations,
    ...effectiveEndpointObservations,
    ...effectiveAgentObservations,
  ].map((observation) => [observation.id, observation])).values()]
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);

  const items = agents.map((agent) => {
    const agentDeclarations = declarations.filter((entry) => entry.agentKey === agent.agentKey);
    const agentObservations = observations.filter((observation) => observation.agentKey === agent.agentKey);
    const admission = admissions.find((entry) => entry.agentKey === agent.agentKey) ?? null;
    return {
      ...agent,
      admission,
      platformAttemptCount: platformAttemptCountByAgent.get(agent.agentKey) ?? 0,
      state: deriveCatalogEvidenceState({
        endpoints: agentDeclarations.map(({ endpoint }) => endpoint),
        observations: agentObservations,
        admission,
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
    nextCursor: offset + agents.length < (totals[0]?.count ?? 0) ? encodeCursor(offset + agents.length) : null,
    items,
  };
  return Response.json(body, {
    headers: {
      "cache-control": "public, max-age=30, stale-while-revalidate=60",
      "x-content-type-options": "nosniff",
    },
  });
}
