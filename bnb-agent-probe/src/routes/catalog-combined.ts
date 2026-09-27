// Combined marketplace resource. Policy is evaluated once; only the selected page is enriched.
import { classifyPublicCurrent, has } from "../catalog/public-current-classification";
import { publicCurrentProjectionReady } from "../catalog/public-current-backfill";
import { publicProjectionsReady, readPublicAgentMetrics, readPublicEndpointEvidence, readPublicProjectedObservations } from "../catalog/public-projections";
import {
  and,
  desc,
  eq,
  inArray,
} from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
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

export async function catalogCombinedResponse(
  request: Request, d1: D1Database, nowMs: number, testnetEnabled = false,
): Promise<Response> {
  return currentCatalogResponse(request,d1,nowMs,testnetEnabled,'list');
}

export function catalogCurrentFacetsResponse(request: Request,d1: D1Database,nowMs: number,testnetEnabled=false): Promise<Response> {
  return currentCatalogResponse(request,d1,nowMs,testnetEnabled,'facets');
}

export function catalogCurrentSummaryResponse(request: Request,d1: D1Database,nowMs: number,testnetEnabled=false): Promise<Response> {
  return currentCatalogResponse(request,d1,nowMs,testnetEnabled,'summary');
}

async function currentCatalogResponse(
  request: Request, d1: D1Database, nowMs: number, testnetEnabled: boolean,
  resource: 'list' | 'facets' | 'summary',
): Promise<Response> {
  const url = new URL(request.url);
  const allowedKeys = resource === 'summary' ? ['chain'] : [
    "status", "q", "category", "protocol", "reachability",
    "commerce", "quote", "latestFailure", "chain", "inventory", "scope",
    ...(resource === 'list' ? ["page", "cursor", "limit", "facets"] : []),
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
  const inventory = url.searchParams.get("inventory") ?? "operational";
  // The directory keeps its existing paginated SQL route; never materialize it here.
  if (!['operational','registry'].includes(inventory) || resource === 'list' && inventory !== 'operational') return invalid();
  const rawFacets = url.searchParams.get("facets");
  if (rawFacets !== null && rawFacets !== "true") return invalid();
  const includeFacets = rawFacets === "true";

  if (!await publicProjectionsReady(d1) || !await publicCurrentProjectionReady(d1)) return Response.json({ error: "catalog_projection_unavailable" }, {
    status: 503, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
  const db = createDatabase(d1 as unknown as D1DatabaseLike);

  const classified = await classifyPublicCurrent(d1,nowMs,chainId,testnetEnabled,q);
  const statusFlags: Record<string, Parameters<typeof has>[1]> = {
    pending:"pending",a2a:"a2a",mcp:"mcp",mcp_only:"mcpOnly",erc8183:"erc8183",quote_capable:"quoteCapable",
    hireable:"quoteCapable",failed:"failed",requestable:"requestable",quote_failed:"quoteFailed",completed_jobs:"completedJobs",
  };
  const categoryKeys = { rebalancing:"rebalancing",grid_trading:"gridTrading",yield_optimisation:"yieldOptimisation",health_factor_monitoring:"healthFactorMonitoring" } as const;
  const protocolFlags = { a2a:"a2aTransport",mcp:"mcpTransport",erc8183_http:"httpTransport" } as const;
  const reachFlags = { live:"live",historical:"historical",never:"never",browser_observed:"browserObserved" } as const;
  const facetFlags = ["declared","mcpOnly","erc8183","quoteCapable","requestable","quoteFailed","completedJobs","pending","a2a","mcp","failed",
    ...Object.values(categoryKeys),...Object.values(protocolFlags),...Object.values(reachFlags)];
  const combinedFacets: Record<string,number> = Object.fromEntries(facetFlags.map(key=>[key,0]));
  const counts = { hiring:0,evaluation:0 };
  const matching: typeof classified = [];
  for (const row of classified) {
    const operational = has(row,"hasOperational");
    const requestable = has(row,"requestable");
    if (operational) counts[requestable ? "hiring" : "evaluation"]++;
    if (!row.searchMatch) continue;
    const parsed: unknown = JSON.parse(row.categoriesJson);
    const rowCategories = Array.isArray(parsed) ? parsed : parsed !== null && typeof parsed === "object" ? Object.values(parsed) : [parsed];
    const selectedStatuses = statuses.filter(status=>status!=="declared");
    const statusMatch = !selectedStatuses.length || selectedStatuses.some(status=>has(row,statusFlags[status]!));
    const categoryMatch = !categories.length || categories.some(category=>rowCategories.includes(category));
    const protocolMatch = !protocols.length || protocols.some(protocol=>has(row,protocolFlags[protocol]));
    const reachMatch = !reachability.length || reachability.some(reach=>has(row,reachFlags[reach]));
    const scopeMatch = scope === null || (scope === "hiring" ? requestable : !requestable);
    const commerceMatch = !commerce.length || commerce.some(value=>value === "declared" ? has(row,"hasSeller")
      :value === "none" ? !has(row,"hasSeller") :value === "candidate" ? has(row,"hasSeller")&&!has(row,"quoteCapable")&&!has(row,"suspended")
      :value === "admitted" ? has(row,"quoteCapable") :has(row,"suspended"));
    const quoteMatch = !quote.length || quote.some(value=>value === "verified" ? has(row,"freshQuote")
      :value === "expired" ? has(row,"anyQuote")&&!has(row,"freshQuote") :!has(row,"anyQuote"));
    const failureMatch = latestFailure === null || has(row,"failure")===latestFailure;
    const common = scopeMatch&&commerceMatch&&quoteMatch&&failureMatch;
    if (common && statusMatch && categoryMatch && protocolMatch && reachMatch
      && (inventory!=="operational" || statuses.some(status=>OPERATIONAL_STATUSES.has(status as CatalogStatus)) || operational)) matching.push(row);
    if (!common || !operational) continue;
    if (categoryMatch&&protocolMatch&&reachMatch) for (const flag of ["declared","mcpOnly","erc8183","quoteCapable","requestable","quoteFailed","completedJobs","pending","a2a","mcp","failed"] as const) {
      if (has(row,flag)) combinedFacets[flag]!++;
    }
    if (statusMatch&&protocolMatch&&reachMatch) for (const [category,key] of Object.entries(categoryKeys)) {
      if (rowCategories.includes(category)) combinedFacets[key]!++;
    }
    if (statusMatch&&categoryMatch&&reachMatch) for (const key of Object.values(protocolFlags)) if (has(row,key)) combinedFacets[key]!++;
    if (statusMatch&&categoryMatch&&protocolMatch) for (const key of Object.values(reachFlags)) if (has(row,key)) combinedFacets[key]!++;
  }
  if (resource === 'summary') return publicResponse({schemaVersion:2,apiVersion:CATALOG_API_VERSION,chainId,generatedAt:nowMs,counts});
  if (resource === 'facets') return publicResponse({schemaVersion:2,apiVersion:CATALOG_API_VERSION,chainId,generatedAt:nowMs,facets:publicFacets(combinedFacets)});
  const totals = [{ count:matching.length }];
  matching.sort((a,b)=>b.priority-a.priority || (b.registeredAt??-Infinity)-(a.registeredAt??-Infinity) || (a.agentId<b.agentId ? -1 : a.agentId>b.agentId ? 1 :0));
  const afterCursor = cursor === undefined ? matching : matching.filter(row=>row.priority<cursor.priority || row.priority===cursor.priority
    && (cursor.registeredAt === null ? row.registeredAt===null&&row.agentId>cursor.agentId
      :row.registeredAt===null||row.registeredAt<cursor.registeredAt||row.registeredAt===cursor.registeredAt&&row.agentId>cursor.agentId));
  const offset = cursor === undefined ? (page-1)*limit : 0;
  const selectedKeys = afterCursor.slice(offset,offset+limit+1).map(row=>row.agentKey);
  const facetRows = includeFacets ? [combinedFacets] : [];


  // Fetch full agent payloads only after filtering, counting and pagination.
  const pageRows = selectedKeys.length ? (await db.select().from(catalogAgents)
    .where(inArray(catalogAgents.agentKey,selectedKeys)))
    .sort((a,b) => selectedKeys.indexOf(a.agentKey)-selectedKeys.indexOf(b.agentKey)) : [];
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
  const [browserObservations, effectiveEndpointObservations, effectiveAgentObservations, endpointEvidence, capabilities, metrics] = await Promise.all([
    readPublicProjectedObservations(d1,agentKeys,"browser"),
    readPublicProjectedObservations(d1,agentKeys,"platform",endpointKeys),
    readPublicProjectedObservations(d1,agentKeys,"agent"),
    readPublicEndpointEvidence(d1,agentKeys),
    agentKeys.length === 0 ? Promise.resolve([]) : db.select().from(catalogSellerCapabilities)
      .where(inArray(catalogSellerCapabilities.agentKey,agentKeys)).orderBy(desc(catalogSellerCapabilities.updatedAt)),
    readPublicAgentMetrics(d1,agentKeys),
  ]);
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
  const body = {
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
  return publicResponse({ list:body,
    facets:{ schemaVersion:2,apiVersion:CATALOG_API_VERSION,chainId,generatedAt:nowMs,facets:publicFacets(combinedFacets) },
    summary:{ schemaVersion:2,apiVersion:CATALOG_API_VERSION,chainId,generatedAt:nowMs,counts }
  });
}
