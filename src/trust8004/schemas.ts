import {
  BSC_MAINNET_CHAIN_ID,
  type AgentListItem,
  type EndpointObservation,
  type FeedbackSummary,
  type NormalizedEndpoint,
  type NormalizedService,
  type Trust8004Profile,
  type TrustScore,
  type TrustScoreDimension,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

export class Trust8004SchemaError extends Error {
  constructor(path: string, expected: string, value: unknown) {
    const received = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    super(`trust8004 schema error at ${path}: expected ${expected}, received ${received}`);
    this.name = "Trust8004SchemaError";
  }
}

function record(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Trust8004SchemaError(path, "object", value);
  }
  return value as JsonRecord;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Trust8004SchemaError(path, "string", value);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return string(value, path);
}

function nullableNonEmptyString(value: unknown, path: string): string | null {
  const candidate = nullableString(value, path)?.trim();
  return candidate ? candidate : null;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Trust8004SchemaError(path, "finite number", value);
  }
  return value;
}

function nullableNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  return finiteNumber(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Trust8004SchemaError(path, "boolean", value);
  return value;
}

function nullableBoolean(value: unknown, path: string): boolean | null {
  if (value === null || value === undefined) return null;
  return boolean(value, path);
}

function chainId(value: unknown, path: string): typeof BSC_MAINNET_CHAIN_ID {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (parsed !== BSC_MAINNET_CHAIN_ID) {
    throw new Trust8004SchemaError(path, `chainId ${BSC_MAINNET_CHAIN_ID}`, value);
  }
  return BSC_MAINNET_CHAIN_ID;
}

function jsonValue(value: unknown, path: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(
      `trust8004 schema error at ${path}: invalid JSON string (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

function array(value: unknown, path: string): unknown[] {
  const parsed = jsonValue(value, path);
  if (parsed === null || parsed === undefined) return [];
  if (!Array.isArray(parsed)) throw new Trust8004SchemaError(path, "array or JSON array string", parsed);
  return parsed;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((entry, index) => string(entry, `${path}[${index}]`));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function parseServices(value: unknown, path = "agent.services"): NormalizedService[] {
  return array(value, path).map((entry, index) => {
    const item = record(entry, `${path}[${index}]`);
    return {
      name: string(item.name, `${path}[${index}].name`),
      endpoint: nullableString(item.endpoint, `${path}[${index}].endpoint`),
      version: nullableString(item.version, `${path}[${index}].version`),
      tools: unique(stringArray(item.tools, `${path}[${index}].tools`)),
      capabilities: unique(stringArray(item.capabilities, `${path}[${index}].capabilities`)),
    };
  });
}

export function parseEndpoints(value: unknown, path = "agent.endpoints"): NormalizedEndpoint[] {
  return array(value, path).map((entry, index) => {
    if (typeof entry === "string") return { name: null, endpoint: entry };
    const item = record(entry, `${path}[${index}]`);
    return {
      name: nullableString(item.name ?? item.type, `${path}[${index}].name`),
      endpoint: string(item.endpoint ?? item.url, `${path}[${index}].endpoint`),
    };
  });
}

function flattenDeclaredCapabilities(value: unknown, path: string): string[] {
  const parsed = jsonValue(value, path);
  if (parsed === null || parsed === undefined) return [];
  const data = record(parsed, path);
  const values: string[] = [];
  for (const [key, entry] of Object.entries(data)) {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        if (typeof item === "string") values.push(item);
        else if (item && typeof item === "object" && !Array.isArray(item)) {
          const candidate = (item as JsonRecord).name ?? (item as JsonRecord).id ?? (item as JsonRecord).uri;
          if (typeof candidate === "string") values.push(candidate);
        }
      }
    } else if (entry === true) {
      values.push(key);
    }
  }
  return unique(values);
}

function parseEndpointObservation(value: unknown, path: string): EndpointObservation {
  const parsed = jsonValue(value, path);
  if (parsed === null || parsed === undefined) {
    return {
      status: "not_observed",
      protocol: null,
      endpoint: null,
      lastTestedAt: null,
      httpStatus: null,
      capabilitiesCount: 0,
      requiresAuth: null,
      error: null,
    };
  }

  const health = record(parsed, path);
  const entries = (["a2a", "mcp", "web"] as const)
    .filter((protocol) => health[protocol] !== undefined)
    .map((protocol) => ({ protocol, data: record(health[protocol], `${path}.${protocol}`) }));
  if (entries.length === 0) {
    throw new Trust8004SchemaError(path, "endpoint health object with mcp, a2a, or web", parsed);
  }
  const latest = entries.sort(
    (left, right) => finiteNumber(right.data.lastTestedAt, `${path}.${right.protocol}.lastTestedAt`)
      - finiteNumber(left.data.lastTestedAt, `${path}.${left.protocol}.lastTestedAt`),
  )[0]!;
  const testedAt = finiteNumber(latest.data.lastTestedAt, `${path}.${latest.protocol}.lastTestedAt`);
  const success = boolean(latest.data.success, `${path}.${latest.protocol}.success`);
  return {
    status: success ? "observed_ok" : "observed_failed",
    protocol: latest.protocol,
    endpoint: nullableString(latest.data.endpoint, `${path}.${latest.protocol}.endpoint`),
    lastTestedAt: new Date(testedAt).toISOString(),
    httpStatus: finiteNumber(latest.data.httpStatus, `${path}.${latest.protocol}.httpStatus`),
    capabilitiesCount: finiteNumber(
      latest.data.capabilitiesCount ?? 0,
      `${path}.${latest.protocol}.capabilitiesCount`,
    ),
    requiresAuth: latest.data.requiresAuth === undefined
      ? null
      : boolean(latest.data.requiresAuth, `${path}.${latest.protocol}.requiresAuth`),
    error: nullableString(latest.data.error, `${path}.${latest.protocol}.error`),
  };
}

function feedbackSummary(value: unknown, path: string): FeedbackSummary {
  const data = record(value, path);
  return {
    totalFeedbacks: finiteNumber(data.totalFeedbacks, `${path}.totalFeedbacks`),
    averageScore: nullableNumber(data.averageScore, `${path}.averageScore`),
    uniqueReviewers: finiteNumber(data.uniqueReviewers, `${path}.uniqueReviewers`),
  };
}

export function parseAgentListResponse(value: unknown): {
  items: AgentListItem[];
  total: number;
  limit: number;
  offset: number;
} {
  const data = record(value, "response");
  const reputationData = data.reputations === undefined
    ? {}
    : record(data.reputations, "response.reputations");
  const items = array(data.items, "response.items").map((entry, index) => {
    const item = record(entry, `response.items[${index}]`);
    const parsedChainId = chainId(item.chainId, `response.items[${index}].chainId`);
    const agentId = string(item.agentId, `response.items[${index}].agentId`);
    const services = parseServices(item.services, `response.items[${index}].services`);
    const endpoints = parseEndpoints(item.endpoints, `response.items[${index}].endpoints`);
    const capabilities = unique([
      ...stringArray(item.skills, `response.items[${index}].skills`),
      ...flattenDeclaredCapabilities(item.capabilities, `response.items[${index}].capabilities`),
      ...services.flatMap((service) => service.capabilities),
    ]);
    const reputationValue = reputationData[`${parsedChainId}:${agentId}`];
    const reputation = reputationValue === undefined
      ? null
      : record(reputationValue, `response.reputations.${parsedChainId}:${agentId}`);
    const updatedAt = nullableNumber(item.updatedAt, `response.items[${index}].updatedAt`);
    return {
      chainId: parsedChainId,
      agentId,
      name: string(item.name, `response.items[${index}].name`),
      description: nullableString(item.description, `response.items[${index}].description`),
      owner: nullableNonEmptyString(item.ownerAddress ?? item.owner, `response.items[${index}].ownerAddress`),
      metadataUri: nullableNonEmptyString(item.ipfsUri ?? item.agentURI, `response.items[${index}].ipfsUri`),
      mcpEndpoint: nullableString(item.mcpEndpoint, `response.items[${index}].mcpEndpoint`),
      a2aEndpoint: nullableString(item.a2aEndpoint, `response.items[${index}].a2aEndpoint`),
      services,
      endpoints,
      tools: unique(services.flatMap((service) => service.tools)),
      capabilities,
      endpointObservation: parseEndpointObservation(
        item.endpointHealth,
        `response.items[${index}].endpointHealth`,
      ),
      reputation: {
        totalFeedbacks: reputation
          ? finiteNumber(reputation.count, `response.reputations.${parsedChainId}:${agentId}.count`)
          : 0,
        averageScore: reputation
          ? nullableNumber(
            reputation.averageScore,
            `response.reputations.${parsedChainId}:${agentId}.averageScore`,
          )
          : null,
      },
      trustScore: {
        total: nullableNumber(item.trustScore, `response.items[${index}].trustScore`),
        tier: nullableString(item.trustTier, `response.items[${index}].trustTier`),
      },
      active: nullableBoolean(item.active, `response.items[${index}].active`),
      updatedAt: updatedAt === null ? null : new Date(updatedAt).toISOString(),
    };
  });
  return {
    items,
    total: finiteNumber(data.total, "response.total"),
    limit: finiteNumber(data.limit, "response.limit"),
    offset: finiteNumber(data.offset, "response.offset"),
  };
}

export function parseProfileResponse(value: unknown): Trust8004Profile {
  const data = record(value, "response");
  const agent = record(data.agent, "response.agent");
  return {
    chainId: chainId(agent.chainId, "response.agent.chainId"),
    agentId: string(agent.agentId, "response.agent.agentId"),
    name: string(agent.name, "response.agent.name"),
    description: nullableString(agent.description, "response.agent.description"),
    owner: string(agent.owner ?? agent.ownerAddress, "response.agent.owner"),
    metadataUri: nullableString(agent.agentURI ?? agent.ipfsUri, "response.agent.agentURI"),
    services: parseServices(agent.services, "response.agent.services"),
    endpoints: parseEndpoints(agent.endpoints, "response.agent.endpoints"),
    declaredCapabilities: unique([
      ...stringArray(agent.skills, "response.agent.skills"),
      ...flattenDeclaredCapabilities(agent.capabilities, "response.agent.capabilities"),
    ]),
    endpointObservation: parseEndpointObservation(
      agent.endpointHealth,
      "response.agent.endpointHealth",
    ),
    feedbackSummary: feedbackSummary(data.feedbackSummary, "response.feedbackSummary"),
    metadataUpdatedAt: nullableNumber(
      agent.metadataUpdatedAt,
      "response.agent.metadataUpdatedAt",
    ),
    updatedAt: nullableNumber(agent.updatedAt, "response.agent.updatedAt"),
    responseTimestamp: finiteNumber(data.timestamp, "response.timestamp"),
  };
}

function scoreDimension(value: unknown, path: string): TrustScoreDimension {
  const data = record(value, path);
  return {
    score: finiteNumber(data.score, `${path}.score`),
    weight: finiteNumber(data.weight, `${path}.weight`),
    weighted: finiteNumber(data.weighted, `${path}.weighted`),
    confidence: finiteNumber(data.confidence, `${path}.confidence`),
  };
}

export function parseTrustScoreResponse(value: unknown): TrustScore {
  const response = record(value, "response");
  chainId(response.chainId, "response.chainId");
  string(response.agentId, "response.agentId");
  const score = record(response.trustScore, "response.trustScore");
  const dimensions = record(score.dimensions, "response.trustScore.dimensions");
  return {
    total: finiteNumber(score.total, "response.trustScore.total"),
    tier: string(score.tier, "response.trustScore.tier"),
    dimensions: Object.fromEntries(
      Object.entries(dimensions).map(([name, dimension]) => [
        name,
        scoreDimension(dimension, `response.trustScore.dimensions.${name}`),
      ]),
    ),
    calculatedAt: string(score.calculatedAt, "response.trustScore.calculatedAt"),
    expiresAt: string(score.expiresAt, "response.trustScore.expiresAt"),
  };
}
