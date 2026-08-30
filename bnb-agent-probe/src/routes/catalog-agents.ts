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
} from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import {
  catalogAgentEndpoints,
  catalogAgents,
  catalogEndpoints,
  catalogObservations,
} from "../db/schema";
import type { D1Database } from "../types";

const STATUSES = [
  "declared", "pending", "a2a", "mcp", "erc8183", "quote_capable", "hireable", "failed",
] as const;
type CatalogStatus = (typeof STATUSES)[number];
const PLATFORM_SOURCES = ["marketplace_probe", "worker_probe", "chain_index"] as const;
const FAILURE_OUTCOMES = [
  "http_error", "timeout", "network_error", "invalid_response", "unsafe_url", "quote_rejected", "unreachable", "error",
] as const;
const CATEGORIES = ["rebalancing", "grid_trading", "yield_optimisation", "health_factor_monitoring"] as const;

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

export async function catalogAgentsResponse(
  request: Request,
  d1: D1Database,
  nowMs: number,
): Promise<Response> {
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => !["status", "page", "limit", "q", "category"].includes(key))) return invalid();
  const status = url.searchParams.get("status") ?? "declared";
  if (!STATUSES.includes(status as CatalogStatus)) return invalid();
  const page = parsePositive(url.searchParams.get("page"), 1, 100_000);
  const limit = parsePositive(url.searchParams.get("limit"), 24, 48);
  if (page === null || limit === null) return invalid();
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length > 120) return invalid();
  const category = url.searchParams.get("category")?.trim() ?? "";
  if (category && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) return invalid();

  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const declarationExists = exists(db.select({ value: sql`1` })
    .from(catalogAgentEndpoints)
    .where(and(
      eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
    )));
  const observationBelongsToAgent = or(
    eq(catalogObservations.agentKey, catalogAgents.agentKey),
    exists(db.select({ value: sql`1` }).from(catalogAgentEndpoints).where(and(
      eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey),
      eq(catalogAgentEndpoints.endpointKey, catalogObservations.endpointKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
    ))),
  );
  const platformObservationExists = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      observationBelongsToAgent,
    )));
  const freshProtocol = (protocol: "a2a" | "mcp") => exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      eq(catalogObservations.protocol, protocol),
      eq(catalogObservations.outcome, "protocol_valid"),
      gt(catalogObservations.expiresAt, nowMs),
      observationBelongsToAgent,
    )));
  const erc8183Declaration = exists(db.select({ value: sql`1` })
    .from(catalogAgentEndpoints)
    .innerJoin(catalogEndpoints, eq(catalogEndpoints.endpointKey, catalogAgentEndpoints.endpointKey))
    .where(and(
      eq(catalogAgentEndpoints.agentKey, catalogAgents.agentKey),
      eq(catalogAgentEndpoints.declarationState, "current"),
      eq(catalogEndpoints.protocol, "erc8183_http"),
    )));
  const freshQuote = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      eq(catalogObservations.agentKey, catalogAgents.agentKey),
      eq(catalogObservations.source, "marketplace_probe"),
      eq(catalogObservations.outcome, "quote_verified"),
      gt(catalogObservations.expiresAt, nowMs),
    )));
  const freshValid = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      inArray(catalogObservations.outcome, ["protocol_valid", "quote_verified"]),
      gt(catalogObservations.expiresAt, nowMs),
      observationBelongsToAgent,
    )));
  const failureExists = exists(db.select({ value: sql`1` })
    .from(catalogObservations)
    .where(and(
      inArray(catalogObservations.source, [...PLATFORM_SOURCES]),
      inArray(catalogObservations.outcome, [...FAILURE_OUTCOMES]),
      observationBelongsToAgent,
    )));
  const statusCondition = status === "declared" ? declarationExists
    : status === "pending" ? not(platformObservationExists)
      : status === "a2a" ? freshProtocol("a2a")
        : status === "mcp" ? freshProtocol("mcp")
          : status === "erc8183" ? erc8183Declaration
            : status === "quote_capable" ? freshQuote
              : status === "hireable" ? and(freshQuote, eq(catalogAgents.marketplaceConfigured, 1))!
              : and(failureExists, not(freshValid))!;
  const escapedQuery = q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const searchCondition = q.length === 0 ? undefined : or(
    eq(catalogAgents.agentId, q),
    sql`${catalogAgents.name} LIKE ${`%${escapedQuery}%`} ESCAPE '\\'`,
  );
  const categoryCondition = category.length === 0 ? undefined : sql`EXISTS (
    SELECT 1 FROM json_each(${catalogAgents.categoriesJson}) WHERE value = ${category}
  )`;
  const where = and(
    eq(catalogAgents.indexState, "current"),
    statusCondition,
    searchCondition,
    categoryCondition,
  );
  const [totals, agents] = await Promise.all([
    db.select({ count: count() }).from(catalogAgents).where(where),
    db.select().from(catalogAgents).where(where)
      .orderBy(desc(catalogAgents.priority), desc(catalogAgents.registeredAt), catalogAgents.agentId)
      .limit(limit).offset((page - 1) * limit),
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
  const observations = agentKeys.length === 0 ? [] : await db.select().from(catalogObservations)
    .where(or(
      inArray(catalogObservations.agentKey, agentKeys),
      ...(endpointKeys.length > 0 ? [inArray(catalogObservations.endpointKey, endpointKeys)] : []),
    ))
    .orderBy(desc(catalogObservations.observedAt), desc(catalogObservations.id))
    .limit(Math.min(1_000, limit * 20));

  return Response.json({
    schemaVersion: 1,
    chainId: 56,
    status,
    page,
    limit,
    query: q,
    category: category || null,
    generatedAt: nowMs,
    total: totals[0]?.count ?? 0,
    items: agents.map((agent) => ({
      ...agent,
      declarations: declarations.filter((entry) => entry.agentKey === agent.agentKey).map((entry) => ({
        ...entry.endpoint,
        priority: entry.priority,
      })),
      observations: observations.filter((observation) => observation.agentKey === agent.agentKey
        || declarations.some((entry) => entry.agentKey === agent.agentKey
          && entry.endpoint.endpointKey === observation.endpointKey)).map((observation) => ({
        ...observation,
        details: JSON.parse(observation.detailsJson) as unknown,
        detailsJson: undefined,
      })),
    })),
  }, {
    headers: {
      "cache-control": "public, max-age=30, stale-while-revalidate=60",
      "x-content-type-options": "nosniff",
    },
  });
}
