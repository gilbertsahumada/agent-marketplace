import { desc, inArray, sql } from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import { catalogAgentEndpoints, catalogAgents, catalogEndpoints } from "../db/schema";
import { CURATED_INVENTORY } from "../manifest/curated-inventory";
import { isSyntacticallyPublicHttpsUrl } from "../trust8004/safe-url";
import type { CatalogAgent, CatalogEndpointProtocol } from "../trust8004/types";

const MAX_CANDIDATES_PER_HEADER = 6;
const MAX_ENDPOINTS_PER_AGENT = 3;
const curatedById = new Map(CURATED_INVENTORY.entries.map((entry) => [entry.agentId, entry]));

interface NormalizedEndpoint {
  endpointKey: string;
  protocol: CatalogEndpointProtocol;
  endpoint: string;
  originKey: string;
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function normalizeEndpoint(protocol: CatalogEndpointProtocol, endpoint: string): Promise<NormalizedEndpoint | null> {
  if (endpoint.length > 16_384 || !isSyntacticallyPublicHttpsUrl(endpoint)) return null;
  const url = new URL(endpoint);
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const normalized = url.toString();
  return {
    protocol,
    endpoint: normalized,
    endpointKey: await digest(`${protocol}\n${normalized}`),
    originKey: await digest(url.origin),
  };
}

function priority(agent: CatalogAgent): number {
  if (curatedById.has(agent.agentId)) return 100;
  const protocols = new Set((agent.indexEndpoints ?? []).map(({ protocol }) => protocol));
  if (protocols.has("erc8183_http")) return 80;
  if (protocols.has("a2a")) return 60;
  if (protocols.has("mcp")) return 40;
  return 20;
}

export interface CatalogHeaderIndexSummary {
  candidatesSeen: number;
  candidatesIndexed: number;
  candidatesDeferred: number;
  endpointsIndexed: number;
  endpointDeclarationsIndexed: number;
  endpointDeclarationsDeferred: number;
}

export async function syncCatalogHeaderCandidates(
  dbBinding: D1DatabaseLike,
  agents: readonly CatalogAgent[],
  nowMs: number,
): Promise<CatalogHeaderIndexSummary> {
  const candidates = agents.filter((agent) => agent.metadataAvailable
    && (agent.indexEndpoints ?? []).some(({ endpoint }) => isSyntacticallyPublicHttpsUrl(endpoint)))
    .sort((left, right) => priority(right) - priority(left)
      || (BigInt(left.agentId) < BigInt(right.agentId) ? -1 : 1));
  const selected = candidates.slice(0, MAX_CANDIDATES_PER_HEADER);
  const normalizedByAgent = new Map<string, NormalizedEndpoint[]>();
  let endpointDeclarationsDeferred = 0;
  for (const agent of selected) {
    const unique = new Map<string, NormalizedEndpoint>();
    for (const declaration of agent.indexEndpoints ?? []) {
      const normalized = await normalizeEndpoint(declaration.protocol, declaration.endpoint);
      if (normalized) unique.set(normalized.endpointKey, normalized);
    }
    const values = [...unique.values()];
    endpointDeclarationsDeferred += Math.max(0, values.length - MAX_ENDPOINTS_PER_AGENT);
    normalizedByAgent.set(`eip155:56:${agent.agentId}`, values.slice(0, MAX_ENDPOINTS_PER_AGENT));
  }
  if (selected.length === 0) return {
    candidatesSeen: candidates.length, candidatesIndexed: 0, candidatesDeferred: candidates.length,
    endpointsIndexed: 0, endpointDeclarationsIndexed: 0, endpointDeclarationsDeferred,
  };

  const db = createDatabase(dbBinding);
  const endpoints = new Map<string, NormalizedEndpoint>();
  for (const values of normalizedByAgent.values()) for (const endpoint of values) endpoints.set(endpoint.endpointKey, endpoint);
  const originKeys = [...new Set([...endpoints.values()].map(({ originKey }) => originKey))];
  const existing = originKeys.length === 0 ? [] : await db.select({
    originKey: catalogEndpoints.originKey,
    protocol: catalogEndpoints.protocol,
    representativeAgentKey: catalogEndpoints.representativeAgentKey,
  }).from(catalogEndpoints).where(inArray(catalogEndpoints.originKey, originKeys))
    .orderBy(desc(catalogEndpoints.representativeAgentKey));
  const representatives = new Map(existing
    .filter((entry) => entry.originKey && entry.representativeAgentKey)
    .map((entry) => [`${entry.originKey}:${entry.protocol}`, entry.representativeAgentKey!]));
  for (const agent of selected) {
    const agentKey = `eip155:56:${agent.agentId}`;
    for (const endpoint of normalizedByAgent.get(agentKey) ?? []) {
      const key = `${endpoint.originKey}:${endpoint.protocol}`;
      if (!representatives.has(key)) representatives.set(key, agentKey);
    }
  }
  const agentRows = selected.map((agent) => {
    const curated = curatedById.get(agent.agentId);
    return {
      agentKey: `eip155:56:${agent.agentId}`,
      agentId: agent.agentId,
      chainId: 56 as const,
      name: agent.name,
      description: agent.description ?? null,
      imageUrl: agent.imageUrl ?? null,
      categoriesJson: JSON.stringify(curated?.categories.map(({ category }) => category) ?? []),
      marketplaceConfigured: curated?.operator === "marketplace" ? 1 : 0,
      metadataState: "ok",
      indexState: "current",
      registeredAt: agent.registeredAt,
      blockNumber: null,
      firstSeenAt: nowMs,
      lastSeenAt: nowMs,
      priority: priority(agent),
    };
  });
  const endpointRows = [...endpoints.values()].map((endpoint) => ({
    ...endpoint,
    safety: "safe",
    safetyReason: null,
    representativeAgentKey: representatives.get(`${endpoint.originKey}:${endpoint.protocol}`) === undefined
      ? null
      : representatives.get(`${endpoint.originKey}:${endpoint.protocol}`) === [...normalizedByAgent.entries()]
        .find(([, values]) => values.some(({ endpointKey }) => endpointKey === endpoint.endpointKey))?.[0]
        ? representatives.get(`${endpoint.originKey}:${endpoint.protocol}`)!
        : null,
  }));
  const relations = selected.flatMap((agent) => {
    const agentKey = `eip155:56:${agent.agentId}`;
    return (normalizedByAgent.get(agentKey) ?? []).map((endpoint) => ({
      agentKey,
      endpointKey: endpoint.endpointKey,
      declarationState: "current",
      firstSeenAt: nowMs,
      lastSeenAt: nowMs,
      priority: priority(agent),
    }));
  });
  await db.batch([
    db.insert(catalogAgents).values(agentRows).onConflictDoUpdate({
      target: catalogAgents.agentKey,
      set: {
        name: sql.raw("excluded.name"), description: sql.raw("excluded.description"),
        imageUrl: sql.raw("excluded.imageUrl"), categoriesJson: sql.raw("excluded.categoriesJson"),
        marketplaceConfigured: sql.raw("excluded.marketplaceConfigured"), metadataState: sql.raw("excluded.metadataState"),
        indexState: "current", registeredAt: sql.raw("excluded.registeredAt"),
        lastSeenAt: sql.raw("excluded.lastSeenAt"), priority: sql.raw("excluded.priority"),
      },
    }),
    db.insert(catalogEndpoints).values(endpointRows).onConflictDoUpdate({
      target: catalogEndpoints.endpointKey,
      set: {
        protocol: sql.raw("excluded.protocol"), endpoint: sql.raw("excluded.endpoint"),
        originKey: sql.raw("excluded.originKey"), safety: "safe", safetyReason: null,
        representativeAgentKey: sql`COALESCE(${catalogEndpoints.representativeAgentKey}, excluded.representativeAgentKey)`,
      },
    }),
    db.insert(catalogAgentEndpoints).values(relations).onConflictDoUpdate({
      target: [catalogAgentEndpoints.agentKey, catalogAgentEndpoints.endpointKey],
      set: { declarationState: "current", lastSeenAt: sql.raw("excluded.lastSeenAt"), priority: sql.raw("excluded.priority") },
    }),
  ] as unknown as Parameters<typeof db.batch>[0]);
  return {
    candidatesSeen: candidates.length,
    candidatesIndexed: selected.length,
    candidatesDeferred: candidates.length - selected.length,
    endpointsIndexed: endpointRows.length,
    endpointDeclarationsIndexed: relations.length,
    endpointDeclarationsDeferred,
  };
}
