import { publicCatalogueFacts, publicCatalogueSummary, publicCataloguePolicy } from "./catalog-public-facts";
import { publicProjectionsReady, readPublicAgentMetrics, readPublicEndpointEvidence, readPublicProjectedObservations } from "../catalog/public-projections";
import {publicCurrentProjectionReady} from '../catalog/public-current-backfill';
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import { decodeTableRow, measuredTableRead } from '../db/measured-table-read';
import { deriveCatalogEvidenceState, selectBestCapability, type CapabilityFact, type SellerCapabilityState } from "../catalog/evidence-policy";
import { CATALOG_API_VERSION, publicCatalogObservation } from "../catalog/api-contract";
import {
  catalogAgentEndpoints,
  catalogAgents,
  catalogEndpoints,
  catalogSellerCapabilities,
} from "../db/schema";
import type { D1Database } from "../types";

const STATUSES = [
  "declared", "pending", "a2a", "mcp", "mcp_only", "erc8183", "quote_capable", "hireable", "failed", "requestable", "quote_failed", "completed_jobs",
] as const;
type CatalogStatus = (typeof STATUSES)[number];
const CATEGORIES = ["rebalancing", "grid_trading", "yield_optimisation", "health_factor_monitoring"] as const;
const PROTOCOLS = ["a2a", "mcp", "erc8183_http"] as const;
const REACHABILITY = ["live", "historical", "never", "browser_observed"] as const;
const COMMERCE = ["declared", "candidate", "admitted", "suspended", "none"] as const;
const QUOTE = ["verified", "expired", "missing"] as const;
const OPERATIONAL_STATUSES = new Set<CatalogStatus>([
  "a2a", "mcp", "mcp_only", "erc8183", "quote_capable", "hireable", "failed",
]);

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

function publicResponse(body: unknown): Response {
  return Response.json(body, { headers: {
    "cache-control": "public, max-age=30, stale-while-revalidate=60",
    "x-content-type-options": "nosniff",
  } });
}

function publicFacets(row: Record<string, number>) {
  return {
    protocols: { a2a: Number(row.a2aTransport), mcp: Number(row.mcpTransport), erc8183_http: Number(row.httpTransport) },
    statuses: {
      declared: Number(row.declared), pending: Number(row.pending), a2a: Number(row.a2a), mcp: Number(row.mcp),
      mcp_only: Number(row.mcpOnly), erc8183: Number(row.erc8183), quote_capable: Number(row.quoteCapable),
      hireable: Number(row.quoteCapable), failed: Number(row.failed), requestable: Number(row.requestable),
      quote_failed: Number(row.quoteFailed), completed_jobs: Number(row.completedJobs),
    },
    categories: {
      rebalancing: Number(row.rebalancing), grid_trading: Number(row.gridTrading),
      yield_optimisation: Number(row.yieldOptimisation), health_factor_monitoring: Number(row.healthFactorMonitoring),
    },
    reachability: {
      live: Number(row.live), historical: Number(row.historical), never: Number(row.never), browser_observed: Number(row.browserObserved),
    },
  };
}

export function catalogAgentsResponse(
  request: Request,
  d1: D1Database,
  nowMs: number,
  responseVersion: 1 | 2 = 2,
  testnetEnabled = false,
): Promise<Response> {
  return catalogReadResponse(request, d1, nowMs, responseVersion, testnetEnabled, "list");
}

export function catalogSummaryResponse(request: Request, d1: D1Database, nowMs: number, testnetEnabled = false): Promise<Response> {
  return import('./catalog-combined').then(({catalogCurrentSummaryResponse}) => catalogCurrentSummaryResponse(request,d1,nowMs,testnetEnabled));
}

export function catalogFacetsResponse(request: Request, d1: D1Database, nowMs: number, testnetEnabled = false): Promise<Response> {
  return import('./catalog-combined').then(({catalogCurrentFacetsResponse}) => catalogCurrentFacetsResponse(request,d1,nowMs,testnetEnabled));
}

async function catalogReadResponse(
  request: Request,
  d1: D1Database,
  nowMs: number,
  responseVersion: 1 | 2,
  testnetEnabled: boolean,
  resource: "list" | "summary" | "facets",
): Promise<Response> {
  const url = new URL(request.url);
  const allowedKeys = resource === "summary" ? ["chain"] : [
    "status", "q", "category", "protocol", "reachability",
    "commerce", "quote", "latestFailure", "chain", "inventory", "scope",
    ...(resource === "list" ? ["page", "cursor", "limit", "facets"] : []),
  ];
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.includes(key))) return invalid();
  const scope = url.searchParams.get("scope");
  if (scope !== null && scope !== "hiring" && scope !== "evaluation") return invalid();
  const rawStatuses = url.searchParams.getAll("status");
  if (rawStatuses.length > STATUSES.length) return invalid();
  const statuses = [...new Set(rawStatuses)];
  // Preserve the public discovery API default. The hiring app explicitly
  // requests requestable; indexers and verification clients retain discovery.
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
  if (url.searchParams.getAll("chain").length > 1 || (rawChain !== null && rawChain !== "56" && rawChain !== "97")) return invalid();
  const chainId = rawChain === "97" ? 97 : 56;
  const inventory = url.searchParams.get("inventory") ?? (responseVersion === 2 ? "operational" : "registry");
  if (!(["operational", "registry"] as const).includes(inventory as "operational" | "registry")) return invalid();
  const rawFacets = url.searchParams.get("facets");
  if (rawFacets !== null && rawFacets !== "true") return invalid();
  const includeFacets = resource === "facets" || responseVersion === 2 && rawFacets === "true";

  if (!await publicProjectionsReady(d1)) return Response.json({ error: "catalog_projection_unavailable" }, {
    status: 503, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const facts = publicCatalogueFacts(nowMs, chainId, testnetEnabled, q, scope === "hiring",
    resource === "facets" || inventory === "operational" && !statuses.some(status => OPERATIONAL_STATUSES.has(status as CatalogStatus)));
  const scopeCondition = scope === "hiring" ? sql`requestable=1` : scope === "evaluation" ? sql`requestable=0` : undefined;
  if (resource === "summary") {
    const [counts] = await db.all<{ hiring: number; evaluation: number }>(publicCatalogueSummary(nowMs,chainId,testnetEnabled).inlineParams());
    return publicResponse({ schemaVersion: 2, apiVersion: CATALOG_API_VERSION, chainId, generatedAt: nowMs,
      counts: { hiring: Number(counts?.hiring ?? 0), evaluation: Number(counts?.evaluation ?? 0) } });
  }
  const flags = {
    declared: "declared", mcpOnly: "mcpOnly", erc8183: "erc8183", quoteCapable: "quoteCapable",
    requestable: "requestable", quoteFailed: "quoteFailed", completedJobs: "completedJobs", pending: "pending",
    a2a: "a2a", mcp: "mcp", failed: "failed", rebalancing: "rebalancing", gridTrading: "gridTrading",
    yieldOptimisation: "yieldOptimisation", healthFactorMonitoring: "healthFactorMonitoring",
    live: "live", historical: "historical", never: "never", browserObserved: "browserObserved",
    a2aTransport: "a2aTransport", mcpTransport: "mcpTransport", httpTransport: "httpTransport",
  } as const;
  type FacetKey = keyof typeof flags;
  const statusKeys: Record<CatalogStatus, FacetKey> = {
    declared: "declared", pending: "pending", a2a: "a2a", mcp: "mcp", mcp_only: "mcpOnly",
    erc8183: "erc8183", quote_capable: "quoteCapable", hireable: "quoteCapable", failed: "failed",
    requestable: "requestable", quote_failed: "quoteFailed", completed_jobs: "completedJobs",
  };
  const categoryKeys = { rebalancing: "rebalancing", grid_trading: "gridTrading", yield_optimisation: "yieldOptimisation", health_factor_monitoring: "healthFactorMonitoring" } as const;
  const protocolKeys = { a2a: "a2aTransport", mcp: "mcpTransport", erc8183_http: "httpTransport" } as const;
  const reachabilityKeys = { live: "live", historical: "historical", never: "never", browser_observed: "browserObserved" } as const;
  const matchFlags = (keys: FacetKey[]) => keys.length ? or(...keys.map(key => sql`${sql.identifier(key)}=1`))! : sql`1`;
  const matchesStatus = matchFlags(statuses.filter(status => status !== "declared").map(status => statusKeys[status as CatalogStatus]));
  const matchesCategory = matchFlags(categories.map(category => categoryKeys[category as keyof typeof categoryKeys]));
  const matchesProtocol = matchFlags(protocols.map(protocol => protocolKeys[protocol]));
  const matchesReachability = matchFlags(reachability.map(value => reachabilityKeys[value]));
  const commerceCondition = commerce.length ? or(...commerce.map(value =>
    value === "declared" ? sql`hasSeller=1` : value === "none" ? sql`hasSeller=0`
    : value === "candidate" ? sql`hasSeller=1 AND quoteCapable=0 AND suspended=0`
    : value === "admitted" ? sql`quoteCapable=1` : sql`suspended=1`)) : undefined;
  const quoteCondition = quote.length ? or(...quote.map(value =>
    value === "verified" ? sql`freshQuote=1` : value === "expired" ? sql`anyQuote=1 AND freshQuote=0` : sql`anyQuote=0`)) : undefined;
  const commonWhere = and(scopeCondition, commerceCondition, quoteCondition,
    latestFailure === null ? undefined : latestFailure ? sql`failure=1` : sql`failure=0`);
  const where = and(commonWhere,
    inventory === "operational" && !statuses.some(status => OPERATIONAL_STATUSES.has(status as CatalogStatus)) ? sql`hasOperational=1` : undefined,
    matchesStatus, matchesCategory, matchesProtocol, matchesReachability);
  const aggregate = (keys: FacetKey[], condition: ReturnType<typeof and>) => keys.map(key =>
    sql`COALESCE(SUM(CASE WHEN ${condition} AND ${sql.identifier(key)}=1 THEN 1 ELSE 0 END),0) AS ${sql.identifier(key)}`);
  const facetRowsPromise = includeFacets ? db.all<Record<FacetKey,number>>(sql`
    WITH ${facts}
    SELECT ${sql.join([
      ...aggregate(["declared","mcpOnly","erc8183","quoteCapable","requestable","quoteFailed","completedJobs","pending","a2a","mcp","failed"],and(matchesCategory,matchesProtocol,matchesReachability)),
      ...aggregate(Object.values(categoryKeys),and(matchesStatus,matchesProtocol,matchesReachability)),
      ...aggregate(Object.values(protocolKeys),and(matchesStatus,matchesCategory,matchesReachability)),
      ...aggregate(Object.values(reachabilityKeys),and(matchesStatus,matchesCategory,matchesProtocol)),
    ],sql`, `)} FROM public_flags WHERE ${and(sql`hasOperational=1`,commonWhere)}
  `.inlineParams()) : Promise.resolve([]);
  if (resource === "facets") {
    const [row] = await facetRowsPromise;
    return publicResponse({ schemaVersion: 2, apiVersion: CATALOG_API_VERSION, chainId, generatedAt: nowMs,
      facets: publicFacets(row!) });
  }
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
  // A plain discovery/admission list does not need every category, history or
  // quote flag to identify its keys. Keep the full flag relation for all other
  // combinations; these EXISTS paths use the very same current policy.
  const simpleList = scope === null && !q && !categories.length && !protocols.length
    && !reachability.length && !commerce.length && !quote.length && latestFailure === null
    && statuses.length === 1 && ['declared','hireable','quote_capable'].includes(statuses[0]!);
  const policy = publicCataloguePolicy(nowMs,chainId,testnetEnabled);
  const compactHireable = simpleList && inventory === 'operational' && statuses[0] !== 'declared';
  if(compactHireable && !await publicCurrentProjectionReady(d1)) return Response.json({error:'catalog_projection_unavailable'}, {
    status:503,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'},
  });
  const compactPolicy=publicCataloguePolicy(nowMs,chainId,testnetEnabled,{
    capability:field=>sql.raw(`c.cap_${field}`),evidence:field=>sql.raw(`c.evidence_${field}`),
  });
  // Measured plans otherwise fan out over each validationProtocol in the
  // partial transport index. The schema's existing endpointKey primary index
  // keeps this live-policy lookup point-bounded (no new index or copied flag).
  const simpleEligibility = compactHireable ? sql`EXISTS (
      SELECT 1 FROM catalog_public_current_endpoints c
      CROSS JOIN catalog_endpoints e INDEXED BY sqlite_autoindex_catalog_endpoints_1 ON e.endpointKey=c.endpointKey
      WHERE c.agent_chainId=${chainId} AND c.agent_agentKey=a.agentKey AND c.declarationState='current' AND ${compactPolicy.flags.quoteCapable})`
    : statuses[0] === 'declared'
    ? inventory === 'registry' ? sql`1` : sql`EXISTS (
      SELECT 1 FROM catalog_agent_endpoints d CROSS JOIN catalog_endpoints e ON e.endpointKey=d.endpointKey
      WHERE d.agentKey=a.agentKey AND d.declarationState='current' AND ${policy.operational})`
    : sql`EXISTS (SELECT 1 FROM catalog_agent_endpoints d
      CROSS JOIN catalog_seller_capabilities c ON c.agentKey=d.agentKey AND c.endpointKey=d.endpointKey
      CROSS JOIN catalog_endpoints e ON e.endpointKey=c.endpointKey
      LEFT JOIN catalog_public_endpoint_evidence p ON p.agentKey=c.agentKey AND p.endpointScope=c.endpointKey AND p.projectionVersion=1
      WHERE d.agentKey=a.agentKey AND d.declarationState='current' AND ${policy.flags.quoteCapable})`;
  const selectionFacts = simpleList
    ? sql`filtered AS NOT MATERIALIZED (SELECT a.agentKey,a.agentId,a.priority,a.registeredAt FROM catalog_agents a
        WHERE a.chainId=${chainId} AND a.indexState='current' AND ${simpleEligibility})`
    : sql`${facts}, filtered AS MATERIALIZED (SELECT * FROM public_flags WHERE ${where})`;
  const [selection, facetRows] = await Promise.all([
    db.all<{ total: number; pageKeys: string }>(sql`
      WITH ${selectionFacts}
      SELECT (SELECT COUNT(*) FROM filtered) AS total,
        (SELECT json_group_array(agentKey) FROM (
          SELECT agentKey FROM filtered AS catalog_agents ${cursorCondition ? sql`WHERE ${cursorCondition}` : sql``}
          ORDER BY ${catalogAgents.priority} DESC,${catalogAgents.registeredAt} DESC,${catalogAgents.agentId}
          LIMIT ${limit+1} OFFSET ${cursor === undefined ? offset : 0}
        )) AS pageKeys
    `.inlineParams()),
    facetRowsPromise,
  ]);
  const selectedKeys = JSON.parse(selection[0]?.pageKeys ?? "[]") as string[];
  const totals = [{ count: Number(selection[0]?.total ?? 0) }];
  // Fetch full agent payloads only after filtering, counting and pagination.
  const pageRows = selectedKeys.length ? (await measuredTableRead(db,catalogAgents,db.select().from(catalogAgents)
    .where(inArray(catalogAgents.agentKey,selectedKeys))))
    .sort((a,b) => selectedKeys.indexOf(a.agentKey)-selectedKeys.indexOf(b.agentKey)) : [];
  const hasNextPage = pageRows.length > limit;
  const agents = pageRows.slice(0, limit);
  const agentKeys = agents.map((agent) => agent.agentKey);
  // Explicit aliases prevent a declaration's fields from shadowing endpoint
  // columns while using all() (which exposes D1 metadata) instead of raw().
  const declarationRows = agentKeys.length === 0 ? [] : await db.all<Record<string, unknown>>(sql`
    SELECT ${catalogAgentEndpoints.agentKey} AS declarationAgentKey,
      ${catalogAgentEndpoints.priority} AS declarationPriority, catalog_endpoints.*
    FROM ${catalogAgentEndpoints} INNER JOIN ${catalogEndpoints}
      ON ${catalogEndpoints.endpointKey} = ${catalogAgentEndpoints.endpointKey}
    WHERE ${inArray(catalogAgentEndpoints.agentKey,agentKeys)}
      AND ${catalogAgentEndpoints.declarationState} = 'current'
  `);
  const declarations = declarationRows.map(row => ({
    agentKey: row.declarationAgentKey as string,
    priority: row.declarationPriority as number,
    endpoint: decodeTableRow(catalogEndpoints,row),
  }));
  const endpointKeys = declarations
    .filter(({ endpoint }) => endpoint.role === "operational" && endpoint.eligibility === "eligible")
    .map((entry) => entry.endpoint.endpointKey);
  const [endpointEvidence, capabilities, metrics] = await Promise.all([
    readPublicEndpointEvidence(d1,agentKeys),
    agentKeys.length === 0 ? Promise.resolve([]) : measuredTableRead(db,catalogSellerCapabilities,db.select().from(catalogSellerCapabilities)
      .where(inArray(catalogSellerCapabilities.agentKey,agentKeys)).orderBy(desc(catalogSellerCapabilities.updatedAt))),
    readPublicAgentMetrics(d1,agentKeys),
  ]);
  const [browserObservations, effectiveEndpointObservations, effectiveAgentObservations] = endpointEvidence.length ? await Promise.all([
    readPublicProjectedObservations(d1,agentKeys,"browser"),
    readPublicProjectedObservations(d1,agentKeys,"platform",endpointKeys),
    readPublicProjectedObservations(d1,agentKeys,"agent"),
  ]) : [[],[],[]];
  const platformAttemptCounts = endpointEvidence.map(row => ({
    agentKey: row.agentKey, endpointKey: row.endpointScope || null, total: row.platformAttemptCount,
  }));
  const quoteStats = metrics.map(row => ({ agentKey: row.agentKey, requestCount: row.buyerQuoteRequestCount,
    successCount: row.buyerQuoteSuccessCount, lastAttemptAt: row.buyerQuoteLastAttemptAt }));
  const jobStats = metrics.map(row => ({ agentId: row.agentKey.slice(10), total: row.jobCount,
    completed: row.jobCompleted, funded: row.jobFunded, submitted: row.jobSubmitted }));
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
        agentKey: entry.agentKey,
        endpointKey: entry.endpointKey,
        transport: entry.transport as "a2a" | "mcp" | "erc8183_http",
        state: entry.state as SellerCapabilityState,
        lastSuccessAt: entry.lastSuccessAt ?? null,
        capabilityExpiresAt: entry.capabilityExpiresAt ?? null,
        lastAttemptAt: entry.lastAttemptAt ?? null,
        consecutiveFailures: entry.consecutiveFailures ?? 0,
        lastErrorCode: entry.lastErrorCode ?? null,
        compatibilityState: entry.compatibilityState as "pending" | "compatible" | "unsupported" | "unavailable",
        schemaHash: entry.schemaHash ?? null,
        compatibilityCheckedAt: entry.compatibilityCheckedAt ?? null,
        compatibilityExpiresAt: entry.compatibilityExpiresAt ?? null,
        compatibilityErrorCode: entry.compatibilityErrorCode ?? null,
      }));
    const capability = selectBestCapability(capabilityRows, nowMs, { endpoints: agentDeclarations.map(entry => entry.endpoint), observations: agentObservations });
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
          agentKey: agent.agentKey,
          ...(capability.endpointKey ? { endpointKey: capability.endpointKey } : {}),
          ...(capability.transport ? { transport: capability.transport } : {}),
          state: capability.state as "unsupported" | "discovered" | "ready" | "stale" | "failed" | "suspended",
          lastSuccessAt: capability.lastSuccessAt ?? null,
          capabilityExpiresAt: capability.capabilityExpiresAt ?? null,
          lastAttemptAt: capability.lastAttemptAt ?? null,
          consecutiveFailures: capability.consecutiveFailures ?? 0,
          lastErrorCode: capability.lastErrorCode ?? null,
          compatibilityState: capability.compatibilityState ?? "pending",
          schemaHash: capability.schemaHash ?? null,
          compatibilityCheckedAt: capability.compatibilityCheckedAt ?? null,
          compatibilityExpiresAt: capability.compatibilityExpiresAt ?? null,
          compatibilityErrorCode: capability.compatibilityErrorCode ?? null,
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
  if (chainId === 97 && !testnetEnabled) for (const item of items) {
    item.state.canRequestQuote = false;
    item.state.canPrepareHire = false;
    item.state.canRequestBrowserValidation = false;
    item.state.canRequestInfrastructureValidation = false;
    item.state.buyerAction = "unavailable";
    item.state.blockingReasons = [...item.state.blockingReasons, "NETWORK_QUOTE_NOT_CONFIGURED"];
  }
  const facetRow = facetRows[0];
  const facets = facetRow ? publicFacets(facetRow) : undefined;
  const body = responseVersion === 1 ? {
    schemaVersion: 1,
    chainId,
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
    chainId,
    coverage: { chainId, catalogDiscovery: chainId === 56 || testnetEnabled ? "enabled" : "not_configured", quoteExecution: chainId === 56 || testnetEnabled ? "enabled" : "not_configured" },
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
      chainId,
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
  return publicResponse(body);
}
