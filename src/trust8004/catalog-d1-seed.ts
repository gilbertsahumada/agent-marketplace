import type { CatalogAgentIndexRecord } from "./catalog-normalization.ts";
import type { CatalogSnapshotV2 } from "./catalog-snapshot.ts";

const DEFAULT_CHUNK_SIZE = 100;

export interface CatalogD1SeedResult {
  sql: string;
  stats: {
    agents: number;
    endpoints: number;
    declarations: number;
    probeRepresentatives: number;
  };
}

export interface CatalogD1SeedOptions {
  priorityAgentIds?: readonly string[];
  marketplaceAgentIds?: readonly string[];
  categoriesByAgentId?: Readonly<Record<string, readonly string[]>>;
  chunkSize?: number;
}

function quote(value: string | null): string {
  if (value === null) return "NULL";
  const withoutLineEndWhitespace = value.replace(/[\t ]+(?=\r?\n|$)/g, "");
  return `'${withoutLineEndWhitespace.replaceAll("'", "''")}'`;
}

function integer(value: number | null): string {
  return value === null ? "NULL" : String(value);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function catalogAgentPriority(agent: CatalogAgentIndexRecord, priorityAgentIds: ReadonlySet<string>): number {
  if (priorityAgentIds.has(agent.agentId)) return 100;
  if (agent.commerceProtocols.includes("erc8183")) return 80;
  if (agent.transportProtocols.includes("a2a")) return 60;
  if (agent.transportProtocols.includes("mcp")) return 40;
  return 20;
}

function lowerAgentId(left: CatalogAgentIndexRecord, right: CatalogAgentIndexRecord): number {
  const a = BigInt(left.agentId);
  const b = BigInt(right.agentId);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildCatalogD1Seed(
  snapshot: CatalogSnapshotV2,
  options: CatalogD1SeedOptions = {},
): CatalogD1SeedResult {
  if (snapshot.schemaVersion !== 2 || snapshot.chainId !== 56 || !snapshot.scan.complete) {
    throw new Error("CATALOG_SEED_SNAPSHOT_INVALID");
  }
  const measuredAt = Date.parse(snapshot.generatedAt);
  if (!Number.isSafeInteger(measuredAt)) throw new Error("CATALOG_SEED_TIMESTAMP_INVALID");
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 250) {
    throw new Error("CATALOG_SEED_CHUNK_INVALID");
  }
  const priorityIds = new Set(options.priorityAgentIds ?? []);
  const marketplaceIds = new Set(options.marketplaceAgentIds ?? []);
  const priorities = new Map(snapshot.candidates.map((agent) => [
    agent.agentKey,
    catalogAgentPriority(agent, priorityIds),
  ]));

  const endpointByKey = new Map<string, CatalogAgentIndexRecord["declarations"][number]>();
  const declaringAgentsByEndpoint = new Map<string, CatalogAgentIndexRecord[]>();
  for (const agent of snapshot.candidates) {
    for (const declaration of agent.declarations) {
      endpointByKey.set(declaration.endpointKey, declaration);
      const agents = declaringAgentsByEndpoint.get(declaration.endpointKey) ?? [];
      agents.push(agent);
      declaringAgentsByEndpoint.set(declaration.endpointKey, agents);
    }
  }

  const representativeByGroup = new Map<string, CatalogAgentIndexRecord>();
  for (const agent of snapshot.candidates) {
    for (const declaration of agent.declarations) {
      if (declaration.safety !== "safe" || !declaration.originKey) continue;
      const group = `${declaration.originKey}:${declaration.protocol}`;
      const current = representativeByGroup.get(group);
      if (!current
        || priorities.get(agent.agentKey)! > priorities.get(current.agentKey)!
        || (priorities.get(agent.agentKey) === priorities.get(current.agentKey)
          && lowerAgentId(agent, current) < 0)) {
        representativeByGroup.set(group, agent);
      }
    }
  }

  const representativeByEndpoint = new Map<string, string>();
  for (const [endpointKey, declaration] of endpointByKey) {
    if (declaration.safety !== "safe" || !declaration.originKey) continue;
    const representative = representativeByGroup.get(`${declaration.originKey}:${declaration.protocol}`);
    if (!representative) continue;
    const representativeDeclaresEndpoint = declaringAgentsByEndpoint.get(endpointKey)
      ?.some((agent) => agent.agentKey === representative.agentKey);
    if (representativeDeclaresEndpoint) representativeByEndpoint.set(endpointKey, representative.agentKey);
  }

  const statements = [
    "-- Generated catalog v2 D1 reconciliation; endpoint URLs contain only normalized public HTTPS declarations.",
    `-- sourceSha256=${snapshot.sourceSha256} generatedAt=${snapshot.generatedAt}`,
    "UPDATE catalog_agents SET indexState = 'removed';",
    "UPDATE catalog_agent_endpoints SET declarationState = 'removed';",
    "UPDATE catalog_endpoints SET representativeAgentKey = NULL;",
  ];

  for (const group of chunks(snapshot.candidates, chunkSize)) {
    const values = group.map((agent) => `(${[
      quote(agent.agentKey), quote(agent.agentId), "56", quote(agent.name), quote(agent.description),
      quote(agent.imageUrl), quote(JSON.stringify(options.categoriesByAgentId?.[agent.agentId] ?? [])),
      marketplaceIds.has(agent.agentId) ? "1" : "0",
      quote(agent.metadataState), quote("current"), integer(agent.registeredAt),
      quote(agent.blockNumber), String(measuredAt), String(measuredAt), String(priorities.get(agent.agentKey)!),
    ].join(",")})`).join(",\n");
    statements.push(`INSERT INTO catalog_agents (
  agentKey, agentId, chainId, name, description, imageUrl, categoriesJson, marketplaceConfigured,
  metadataState, indexState,
  registeredAt, blockNumber, firstSeenAt, lastSeenAt, priority
) VALUES\n${values}
ON CONFLICT(agentKey) DO UPDATE SET
  name=excluded.name, description=excluded.description, imageUrl=excluded.imageUrl,
  categoriesJson=excluded.categoriesJson, marketplaceConfigured=excluded.marketplaceConfigured,
  metadataState=excluded.metadataState, indexState='current', registeredAt=excluded.registeredAt,
  blockNumber=excluded.blockNumber, lastSeenAt=excluded.lastSeenAt, priority=excluded.priority;`);
  }

  const endpoints = [...endpointByKey.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const group of chunks(endpoints, chunkSize)) {
    const values = group.map(([endpointKey, declaration]) => `(${[
      quote(endpointKey), quote(declaration.protocol), quote(declaration.url), quote(declaration.originKey),
      quote(declaration.safety), quote(declaration.safetyReason),
      quote(representativeByEndpoint.get(endpointKey) ?? null),
    ].join(",")})`).join(",\n");
    statements.push(`INSERT INTO catalog_endpoints (
  endpointKey, protocol, endpoint, originKey, safety, safetyReason, representativeAgentKey
) VALUES\n${values}
ON CONFLICT(endpointKey) DO UPDATE SET
  protocol=excluded.protocol, endpoint=excluded.endpoint, originKey=excluded.originKey,
  safety=excluded.safety, safetyReason=excluded.safetyReason,
  representativeAgentKey=excluded.representativeAgentKey;`);
  }

  const relations = snapshot.candidates.flatMap((agent) => agent.declarations.map((declaration) => ({
    agentKey: agent.agentKey,
    endpointKey: declaration.endpointKey,
    priority: priorities.get(agent.agentKey)!,
  })));
  for (const group of chunks(relations, chunkSize)) {
    const values = group.map((relation) => `(${[
      quote(relation.agentKey), quote(relation.endpointKey), quote("current"),
      String(measuredAt), String(measuredAt), String(relation.priority),
    ].join(",")})`).join(",\n");
    statements.push(`INSERT INTO catalog_agent_endpoints (
  agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority
) VALUES\n${values}
ON CONFLICT(agentKey, endpointKey) DO UPDATE SET
  declarationState='current', lastSeenAt=excluded.lastSeenAt, priority=excluded.priority;`);
  }

  return {
    sql: `${statements.join("\n\n")}\n`,
    stats: {
      agents: snapshot.candidates.length,
      endpoints: endpoints.length,
      declarations: relations.length,
      probeRepresentatives: representativeByEndpoint.size,
    },
  };
}
