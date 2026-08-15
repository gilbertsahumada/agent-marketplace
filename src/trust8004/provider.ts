import {
  parseAgentListResponse,
  parseProfileResponse,
  parseTrustScoreResponse,
} from "./schemas.js";
import { classifyProfile } from "./classify.js";
import {
  BSC_MAINNET_CHAIN_ID,
  CATALOG_COVERAGE,
  TRUST8004_BASE_URL,
  type AgentListPage,
  type MarketplaceAgent,
  type NormalizedEndpoint,
  type ProvenanceRecord,
  type Trust8004Profile,
  type TrustScore,
} from "./types.js";

export interface Trust8004ProviderOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  minimumRequestIntervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export interface ListAgentsOptions {
  limit?: number;
  offset?: number;
  search?: string;
  active?: boolean;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function isoTimestamp(value: number, path: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp at ${path}: ${value}`);
  return date.toISOString();
}

function unique<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function provenance(
  kind: ProvenanceRecord["kind"],
  sourcePath: string,
  fetchedAt: string,
  verifiedDirectly: boolean,
  note?: string,
  source: ProvenanceRecord["source"] = kind === "derived" ? "marketplace" : "trust8004-public-api",
): ProvenanceRecord {
  return {
    kind,
    source,
    sourcePath,
    fetchedAt,
    verifiedDirectly,
    ...(note ? { note } : {}),
  };
}

export class Trust8004HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    detail: string,
  ) {
    super(`trust8004 request failed (${status}) for ${url}: ${detail}`);
    this.name = "Trust8004HttpError";
  }
}

export class Trust8004Provider {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly minimumRequestIntervalMs: number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly cache = new Map<string, Promise<unknown>>();
  private queue: Promise<void> = Promise.resolve();
  private lastRequestStartedAt = Number.NEGATIVE_INFINITY;

  constructor(options: Trust8004ProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? TRUST8004_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.minimumRequestIntervalMs = options.minimumRequestIntervalMs ?? 1_100;
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
  }

  async listAgents(options: ListAgentsOptions = {}): Promise<AgentListPage> {
    const limit = positiveInteger(options.limit ?? 50, "limit");
    if (limit > 100) throw new Error("limit must be at most 100");
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");

    const params = new URLSearchParams({
      chainId: String(BSC_MAINNET_CHAIN_ID),
      limit: String(limit),
      offset: String(offset),
      includeReputation: "false",
      includeCategoryCounts: "false",
      includeMetadataReasonCounts: "false",
    });
    if (options.search?.trim()) params.set("search", options.search.trim());
    if (options.active !== undefined) params.set("active", String(options.active));
    const fetchedAt = isoTimestamp(this.now(), "provider.now");
    const response = await this.request(`/api/v2/agents?${params.toString()}`, parseAgentListResponse);
    return { ...response, catalogCoverage: CATALOG_COVERAGE, fetchedAt };
  }

  async getProfile(agentId: string): Promise<Trust8004Profile> {
    this.assertAgentId(agentId);
    return this.request(
      `/api/v2/agents/profile?chainId=${BSC_MAINNET_CHAIN_ID}&agentId=${encodeURIComponent(agentId)}`,
      parseProfileResponse,
    );
  }

  async getTrustScore(agentId: string): Promise<TrustScore> {
    this.assertAgentId(agentId);
    return this.request(
      `/api/v2/agents/${encodeURIComponent(agentId)}/score?chainId=${BSC_MAINNET_CHAIN_ID}`,
      parseTrustScoreResponse,
    );
  }

  async getAgent(agentId: string): Promise<MarketplaceAgent> {
    const profile = await this.getProfile(agentId);
    const trustScore = await this.getTrustScore(agentId);
    const fetchedAt = isoTimestamp(profile.responseTimestamp, "profile.timestamp");
    const serviceEndpoints: NormalizedEndpoint[] = profile.services.flatMap((service) =>
      service.endpoint ? [{ name: service.name, endpoint: service.endpoint }] : [],
    );
    const services = profile.services;
    const tools = [...new Set(services.flatMap((service) => service.tools))].sort();
    const capabilities = [...new Set([
      ...profile.declaredCapabilities,
      ...services.flatMap((service) => service.capabilities),
    ])].sort();
    const categories = classifyProfile(profile);
    const hasObservation = profile.endpointObservation.status !== "not_observed";

    return {
      chainId: BSC_MAINNET_CHAIN_ID,
      agentId: profile.agentId,
      name: profile.name,
      description: profile.description,
      owner: profile.owner,
      metadataUri: profile.metadataUri,
      services,
      endpoints: unique([...profile.endpoints, ...serviceEndpoints], (endpoint) => endpoint.endpoint),
      tools,
      capabilities,
      reputation: profile.feedbackSummary,
      trustScore,
      categories,
      endpointObservation: profile.endpointObservation,
      freshness: {
        fetchedAt,
        metadataUpdatedAt: profile.metadataUpdatedAt === null
          ? null
          : isoTimestamp(profile.metadataUpdatedAt, "profile.agent.metadataUpdatedAt"),
        indexedUpdatedAt: profile.updatedAt === null
          ? null
          : isoTimestamp(profile.updatedAt, "profile.agent.updatedAt"),
      },
      catalogCoverage: CATALOG_COVERAGE,
      provenance: {
        identity: provenance(
          "onchain",
          "profile.agent.{chainId,agentId,owner,agentURI}",
          fetchedAt,
          false,
          "Indexed by trust8004; critical identity must be verified directly on BSC.",
        ),
        metadata: provenance("declared", "profile.agent", fetchedAt, false),
        services: provenance(
          "declared",
          "profile.agent.{services,endpoints,skills,capabilities}",
          fetchedAt,
          false,
          "Declared tools are not treated as verified capabilities.",
        ),
        endpointObservation: provenance(
          "observed",
          "profile.agent.endpointHealth",
          fetchedAt,
          hasObservation,
          hasObservation ? undefined : "No persisted endpoint observation is available.",
        ),
        reputation: provenance(
          "onchain",
          "profile.feedbackSummary",
          fetchedAt,
          false,
          "Aggregated by trust8004 from indexed ERC-8004 feedback.",
        ),
        trustScore: provenance(
          "derived",
          "score.trustScore",
          fetchedAt,
          false,
          "Calculated by trust8004; not independently recalculated by the marketplace.",
          "trust8004-public-api",
        ),
        categories: provenance(
          "derived",
          "marketplace.category-classifier",
          fetchedAt,
          false,
          "Candidate classification only; not proof of operation or hireability.",
        ),
      },
    };
  }

  private assertAgentId(agentId: string): void {
    if (!/^\d+$/.test(agentId)) throw new Error(`agentId must be numeric: ${agentId}`);
  }

  private request<T>(path: string, parse: (value: unknown) => T): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const cached = this.cache.get(url);
    if (cached) return cached as Promise<T>;

    const promise = this.schedule(async () => {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Trust8004HttpError(response.status, url, text.slice(0, 500));
      }
      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch (error) {
        throw new Error(
          `trust8004 returned invalid JSON for ${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return parse(value);
    });
    this.cache.set(url, promise);
    void promise.catch(() => this.cache.delete(url));
    return promise;
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const remaining = this.minimumRequestIntervalMs - (this.now() - this.lastRequestStartedAt);
      if (remaining > 0) await this.wait(remaining);
      this.lastRequestStartedAt = this.now();
      return operation();
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
