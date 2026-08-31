import { desc, inArray, sql } from "drizzle-orm";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import {
  catalogAgentAdmission,
  catalogAgentEndpoints,
  catalogAgents,
  catalogEndpoints,
} from "../db/schema";
import { CURATED_INVENTORY } from "../manifest/curated-inventory";
import { classifyCatalogResource } from "../trust8004/resource-classification";
import {
  catalogMetadataVersion,
  normalizeCatalogResource,
  type NormalizedCatalogResource,
} from "../trust8004/resource-normalization";
import type { CatalogAgent } from "../trust8004/types";

const MAX_CANDIDATES_PER_HEADER = 6;
const MAX_ENDPOINTS_PER_AGENT = 3;
const curatedById = new Map(CURATED_INVENTORY.entries.map((entry) => [entry.agentId, entry]));

type NormalizedEndpoint = NormalizedCatalogResource;

function priority(agent: CatalogAgent): number {
  if (curatedById.has(agent.agentId)) return 100;
  const protocols = new Set((agent.indexEndpoints ?? [])
    .filter(({ protocol, endpoint }) => classifyCatalogResource(protocol, endpoint).eligibility === "eligible")
    .map(({ protocol }) => protocol));
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
    && (agent.indexEndpoints ?? []).length > 0)
    .sort((left, right) => priority(right) - priority(left)
      || (BigInt(left.agentId) < BigInt(right.agentId) ? -1 : 1));
  const selected = candidates.slice(0, MAX_CANDIDATES_PER_HEADER);
  const normalizedByAgent = new Map<string, NormalizedEndpoint[]>();
  let endpointDeclarationsDeferred = 0;
  for (const agent of selected) {
    const unique = new Map<string, NormalizedEndpoint>();
    for (const declaration of agent.indexEndpoints ?? []) {
      const normalized = await normalizeCatalogResource(declaration);
      unique.set(normalized.endpointKey, normalized);
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
  const originKeys = [...new Set([...endpoints.values()]
    .map(({ originKey }) => originKey)
    .filter((value): value is string => value !== null))];
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
      if (endpoint.eligibility !== "eligible" || endpoint.originKey === null || endpoint.validationProtocol === null) continue;
      const key = `${endpoint.originKey}:${endpoint.validationProtocol}`;
      if (!representatives.has(key)) representatives.set(key, agentKey);
    }
  }
  const agentRows = await Promise.all(selected.map(async (agent) => {
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
      metadataVersion: await catalogMetadataVersion(agent),
      metadataObservedAt: agent.metadataUpdatedAt ?? nowMs,
      policyVersion: 2,
    };
  }));
  const endpointRows = [...endpoints.values()].map((endpoint) => ({
    ...endpoint,
    nextProbeAt: endpoint.eligibility === "eligible" ? nowMs : null,
    representativeAgentKey: endpoint.eligibility !== "eligible" || endpoint.originKey === null
      || endpoint.validationProtocol === null
      ? null
      : representatives.get(`${endpoint.originKey}:${endpoint.validationProtocol}`) === undefined
      ? null
      : representatives.get(`${endpoint.originKey}:${endpoint.validationProtocol}`) === [...normalizedByAgent.entries()]
        .find(([, values]) => values.some(({ endpointKey }) => endpointKey === endpoint.endpointKey))?.[0]
        ? representatives.get(`${endpoint.originKey}:${endpoint.validationProtocol}`)!
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
      rawServiceLabel: endpoint.rawServiceLabel,
      rawSource: endpoint.rawSource,
      rawSourceIndex: endpoint.rawSourceIndex,
      metadataVersion: agentRows.find((row) => row.agentKey === agentKey)!.metadataVersion,
    }));
  });
  const admissionRows = selected.flatMap((agent) => {
    const agentKey = `eip155:56:${agent.agentId}`;
    const endpointsForAgent = normalizedByAgent.get(agentKey) ?? [];
    const commerce = endpointsForAgent.find((endpoint) => endpoint.eligibility === "eligible"
      && endpoint.validationProtocol === "erc8183_http")
      ?? (curatedById.get(agent.agentId)?.operator === "marketplace"
        ? endpointsForAgent.find((endpoint) => endpoint.eligibility === "eligible"
          && endpoint.validationProtocol === "a2a")
        : undefined);
    return commerce ? [{
      agentKey,
      state: "candidate",
      commerceTransport: commerce.validationProtocol as "a2a" | "erc8183_http",
      endpointKey: commerce.endpointKey,
      chainId: 56,
      provider: null,
      validatedAt: null,
      configurationVersion: `metadata:${agentRows.find((row) => row.agentKey === agentKey)!.metadataVersion}`,
      reasonCode: "QUOTE_VERIFICATION_REQUIRED",
    }] : [];
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
        metadataVersion: sql.raw("excluded.metadataVersion"),
        metadataObservedAt: sql.raw("excluded.metadataObservedAt"),
        policyVersion: sql.raw("excluded.policyVersion"),
      },
    }),
    db.insert(catalogEndpoints).values(endpointRows).onConflictDoUpdate({
      target: catalogEndpoints.endpointKey,
      set: {
        protocol: sql.raw("excluded.protocol"), endpoint: sql.raw("excluded.endpoint"),
        declaredProtocol: sql.raw("excluded.declaredProtocol"), role: sql.raw("excluded.role"),
        validationProtocol: sql.raw("excluded.validationProtocol"), externalKind: sql.raw("excluded.externalKind"),
        eligibility: sql.raw("excluded.eligibility"), originKey: sql.raw("excluded.originKey"),
        nextProbeAt: sql.raw("excluded.nextProbeAt"),
        safety: sql.raw("excluded.safety"), safetyReason: sql.raw("excluded.safetyReason"),
        representativeAgentKey: sql`COALESCE(${catalogEndpoints.representativeAgentKey}, excluded.representativeAgentKey)`,
      },
    }),
    db.insert(catalogAgentEndpoints).values(relations).onConflictDoUpdate({
      target: [catalogAgentEndpoints.agentKey, catalogAgentEndpoints.endpointKey],
      set: {
        declarationState: "current", lastSeenAt: sql.raw("excluded.lastSeenAt"), priority: sql.raw("excluded.priority"),
        rawServiceLabel: sql.raw("excluded.rawServiceLabel"), rawSource: sql.raw("excluded.rawSource"),
        rawSourceIndex: sql.raw("excluded.rawSourceIndex"), metadataVersion: sql.raw("excluded.metadataVersion"),
      },
    }),
    ...(admissionRows.length === 0 ? [] : [db.insert(catalogAgentAdmission).values(admissionRows)
      .onConflictDoUpdate({
        target: catalogAgentAdmission.agentKey,
        set: {
          state: sql`CASE
            WHEN ${catalogAgentAdmission.state} = 'admitted'
              AND ${catalogAgentAdmission.endpointKey} = excluded.endpointKey
            THEN 'admitted' ELSE 'candidate' END`,
          commerceTransport: sql.raw("excluded.commerceTransport"),
          endpointKey: sql.raw("excluded.endpointKey"),
          provider: sql`CASE
            WHEN ${catalogAgentAdmission.state} = 'admitted'
              AND ${catalogAgentAdmission.endpointKey} = excluded.endpointKey
            THEN ${catalogAgentAdmission.provider} ELSE NULL END`,
          validatedAt: sql`CASE
            WHEN ${catalogAgentAdmission.state} = 'admitted'
              AND ${catalogAgentAdmission.endpointKey} = excluded.endpointKey
            THEN ${catalogAgentAdmission.validatedAt} ELSE NULL END`,
          configurationVersion: sql.raw("excluded.configurationVersion"),
          reasonCode: sql`CASE
            WHEN ${catalogAgentAdmission.state} = 'admitted'
              AND ${catalogAgentAdmission.endpointKey} = excluded.endpointKey
            THEN NULL ELSE 'QUOTE_VERIFICATION_REQUIRED' END`,
        },
      })]),
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
