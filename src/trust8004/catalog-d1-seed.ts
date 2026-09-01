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

type SeedDeclaration = CatalogAgentIndexRecord["declarations"][number];
type SeedValidationProtocol = "a2a" | "mcp" | "erc8183_http";
type SeedEndpointProjection = {
  declaredProtocol: SeedDeclaration["protocol"];
  role: "operational" | "external";
  validationProtocol: SeedValidationProtocol | null;
  externalKind: "website" | "social" | "repository" | "documentation" | "other" | null;
  eligibility: "eligible" | "unsafe" | "invalid_declaration" | "unsupported";
};

function isOperationalProtocol(protocol: SeedDeclaration["protocol"]): protocol is SeedValidationProtocol {
  return protocol === "a2a" || protocol === "mcp" || protocol === "erc8183_http";
}

function projectDeclaration(declaration: SeedDeclaration): SeedEndpointProjection {
  // Unsafe declarations intentionally retain their declared transport while
  // remaining ineligible. The snapshot stores no raw unsafe URL, so classify
  // the known protocol without attempting to reconstruct one.
  if (declaration.safety === "unsafe" || declaration.url === null) {
    const validationProtocol = isOperationalProtocol(declaration.protocol) ? declaration.protocol : null;
    return {
      declaredProtocol: declaration.protocol,
      role: validationProtocol === null ? "external" : "operational",
      validationProtocol,
      externalKind: declaration.protocol === "web" ? "website" : null,
      eligibility: "unsafe",
    };
  }

  const hostname = new URL(declaration.url).hostname.toLowerCase().replace(/\.$/, "");
  const matches = (expected: string) => hostname === expected || hostname.endsWith(`.${expected}`);
  const externalKind = ["x.com", "twitter.com", "t.me", "telegram.me"].some((host) => matches(host))
    ? "social"
    : matches("github.com") || matches("gitlab.com")
      ? "repository"
      : hostname.startsWith("docs.") || /^\/(?:docs?|documentation)(?:\/|$)/i.test(new URL(declaration.url).pathname)
        ? "documentation"
        : null;
  const validationProtocol = isOperationalProtocol(declaration.protocol) ? declaration.protocol : null;
  return {
    declaredProtocol: declaration.protocol,
    role: validationProtocol === null ? "external" : "operational",
    validationProtocol,
    externalKind: validationProtocol !== null && externalKind !== null
      ? externalKind : (validationProtocol !== null ? null : externalKind ?? "website"),
    eligibility: validationProtocol !== null && externalKind === null
      ? "eligible" : validationProtocol !== null ? "invalid_declaration" : "unsupported",
  };
}

function quote(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
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
  const projectionByEndpoint = new Map<string, SeedEndpointProjection>();
  const declaringAgentsByEndpoint = new Map<string, CatalogAgentIndexRecord[]>();
  for (const agent of snapshot.candidates) {
    for (const declaration of agent.declarations) {
      endpointByKey.set(declaration.endpointKey, declaration);
      projectionByEndpoint.set(declaration.endpointKey, projectDeclaration(declaration));
      const agents = declaringAgentsByEndpoint.get(declaration.endpointKey) ?? [];
      agents.push(agent);
      declaringAgentsByEndpoint.set(declaration.endpointKey, agents);
    }
  }

  const representativeByGroup = new Map<string, CatalogAgentIndexRecord>();
  for (const agent of snapshot.candidates) {
    for (const declaration of agent.declarations) {
      if (projectionByEndpoint.get(declaration.endpointKey)?.eligibility !== "eligible"
        || !declaration.originKey) continue;
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
      quote(agent.agentKey), quote(agent.agentId), "56", quote(agent.owner), quote(agent.metadataUri),
      quote(agent.name), quote(agent.description), quote(agent.imageUrl),
      quote(JSON.stringify(options.categoriesByAgentId?.[agent.agentId] ?? [])),
      marketplaceIds.has(agent.agentId) ? "1" : "0",
      quote(agent.metadataState), quote("current"), integer(agent.registeredAt),
      quote(agent.blockNumber), String(measuredAt), String(measuredAt), String(priorities.get(agent.agentKey)!),
      String(measuredAt), "2",
    ].join(",")})`).join(",\n");
    statements.push(`INSERT INTO catalog_agents (
  agentKey, agentId, chainId, owner, metadataUri, name, description, imageUrl, categoriesJson, marketplaceConfigured,
  metadataState, indexState,
  registeredAt, blockNumber, firstSeenAt, lastSeenAt, priority, metadataObservedAt, policyVersion
) VALUES\n${values}
ON CONFLICT(agentKey) DO UPDATE SET
  owner=excluded.owner, metadataUri=excluded.metadataUri, name=excluded.name, description=excluded.description, imageUrl=excluded.imageUrl,
  categoriesJson=excluded.categoriesJson, marketplaceConfigured=excluded.marketplaceConfigured,
  metadataState=excluded.metadataState, indexState='current', registeredAt=excluded.registeredAt,
  blockNumber=excluded.blockNumber, lastSeenAt=excluded.lastSeenAt, priority=excluded.priority,
  metadataObservedAt=excluded.metadataObservedAt, policyVersion=excluded.policyVersion;`);
  }

  const endpoints = [...endpointByKey.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const group of chunks(endpoints, chunkSize)) {
    const values = group.map(([endpointKey, declaration]) => {
      const projection = projectionByEndpoint.get(endpointKey)!;
      return `(${[
      quote(endpointKey), quote(declaration.protocol), quote(declaration.url), quote(declaration.originKey),
      quote(declaration.safety), quote(declaration.safetyReason),
      quote(projection.declaredProtocol), quote(projection.role), quote(projection.validationProtocol),
      quote(projection.externalKind), quote(projection.eligibility),
      quote(representativeByEndpoint.get(endpointKey) ?? null),
      integer(projection.eligibility === "eligible" ? measuredAt : null),
      ].join(",")})`;
    }).join(",\n");
    statements.push(`INSERT INTO catalog_endpoints (
  endpointKey, protocol, endpoint, originKey, safety, safetyReason,
  declaredProtocol, role, validationProtocol, externalKind, eligibility, representativeAgentKey, nextProbeAt
) VALUES\n${values}
ON CONFLICT(endpointKey) DO UPDATE SET
  protocol=excluded.protocol, endpoint=excluded.endpoint, originKey=excluded.originKey,
  safety=excluded.safety, safetyReason=excluded.safetyReason,
  declaredProtocol=excluded.declaredProtocol, role=excluded.role,
  validationProtocol=excluded.validationProtocol, externalKind=excluded.externalKind,
  eligibility=excluded.eligibility, representativeAgentKey=excluded.representativeAgentKey,
  nextProbeAt=excluded.nextProbeAt;`);
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

  const admissions = snapshot.candidates.flatMap((agent) => {
    const declarations = agent.declarations;
    const commerce = declarations.find((declaration) => (
      declaration.protocol === "erc8183_http"
      && projectionByEndpoint.get(declaration.endpointKey)?.eligibility === "eligible"
    )) ?? (marketplaceIds.has(agent.agentId)
      ? declarations.find((declaration) => (
        declaration.protocol === "a2a"
        && projectionByEndpoint.get(declaration.endpointKey)?.eligibility === "eligible"
      ))
      : undefined);
    if (!commerce) return [];
    return [{
      agentKey: agent.agentKey,
      commerceTransport: commerce.protocol as "a2a" | "erc8183_http",
      endpointKey: commerce.endpointKey,
    }];
  });
  for (const group of chunks(admissions, chunkSize)) {
    const values = group.map((admission) => `(${[
      quote(admission.agentKey), quote("candidate"), quote(admission.commerceTransport),
      quote(admission.endpointKey), "56", "NULL", "NULL",
      quote(`seed:${snapshot.sourceSha256}`), quote("QUOTE_VERIFICATION_REQUIRED"),
    ].join(",")})`).join(",\n");
    statements.push(`INSERT INTO catalog_agent_admission (
  agentKey, state, commerceTransport, endpointKey, chainId, provider, validatedAt,
  configurationVersion, reasonCode
) VALUES\n${values}
ON CONFLICT(agentKey) DO UPDATE SET
  state=CASE WHEN catalog_agent_admission.state = 'admitted'
    AND catalog_agent_admission.endpointKey = excluded.endpointKey THEN 'admitted' ELSE 'candidate' END,
  commerceTransport=excluded.commerceTransport, endpointKey=excluded.endpointKey,
  chainId=excluded.chainId,
  provider=CASE WHEN catalog_agent_admission.state = 'admitted'
    AND catalog_agent_admission.endpointKey = excluded.endpointKey
    THEN catalog_agent_admission.provider ELSE NULL END,
  validatedAt=CASE WHEN catalog_agent_admission.state = 'admitted'
    AND catalog_agent_admission.endpointKey = excluded.endpointKey
    THEN catalog_agent_admission.validatedAt ELSE NULL END,
  configurationVersion=excluded.configurationVersion,
  reasonCode=CASE WHEN catalog_agent_admission.state = 'admitted'
    AND catalog_agent_admission.endpointKey = excluded.endpointKey
    THEN NULL ELSE 'QUOTE_VERIFICATION_REQUIRED' END;`);
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
