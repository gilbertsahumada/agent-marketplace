import { AsyncTtlCache } from "../cache/async-ttl-cache.js";
import { Trust8004Provider } from "../../trust8004/provider.js";
import type { AgentListItem, MarketplaceAgent } from "../../trust8004/types.js";
import { createBscIdentityReader, type BscIdentityReader } from "../../verification/onchain.js";
import type {
  MarketplaceAgentData,
  MarketplaceAgentDataPage,
  MarketplaceAgentRepository,
  MarketplaceDataSort,
  OnchainIdentityData,
} from "./marketplace-agent-repository.js";

const CATALOG_TTL_MS = 5 * 60 * 1_000;
const ONCHAIN_IDENTITY_TTL_MS = 60 * 1_000;

export interface Trust8004MarketplaceRepositoryOptions {
  providerFactory?: () => Trust8004Provider;
  cache?: AsyncTtlCache;
  ttlMs?: number;
  identityReaderFactory?: () => BscIdentityReader;
  now?: () => number;
}

function providerSort(sort: MarketplaceDataSort | undefined): {
  sortBy: "registered" | "reputation" | "score" | "id";
  sortOrder: "asc" | "desc";
} {
  switch (sort) {
    case "reputation": return { sortBy: "reputation", sortOrder: "desc" };
    case "newest": return { sortBy: "registered", sortOrder: "desc" };
    case "agent_id": return { sortBy: "id", sortOrder: "asc" };
    default: return { sortBy: "score", sortOrder: "desc" };
  }
}

function fromSummary(agent: AgentListItem, fetchedAt: string): MarketplaceAgentData {
  return {
    sourceDetail: "summary",
    chainId: agent.chainId,
    agentId: agent.agentId,
    name: agent.name,
    description: agent.description,
    owner: agent.owner,
    metadataUri: agent.metadataUri,
    services: agent.services,
    endpoints: agent.endpoints,
    tools: agent.tools,
    capabilities: agent.capabilities,
    endpointObservation: agent.endpointObservation,
    reputation: { ...agent.reputation, uniqueReviewers: null },
    trustScore: {
      ...agent.trustScore,
      dimensions: {},
      calculatedAt: null,
      expiresAt: null,
    },
    freshness: {
      fetchedAt,
      metadataUpdatedAt: null,
      indexedUpdatedAt: agent.updatedAt,
    },
  };
}

function fromProfile(agent: MarketplaceAgent): MarketplaceAgentData {
  return {
    sourceDetail: "profile",
    chainId: agent.chainId,
    agentId: agent.agentId,
    name: agent.name,
    description: agent.description,
    owner: agent.owner,
    metadataUri: agent.metadataUri,
    services: agent.services,
    endpoints: agent.endpoints,
    tools: agent.tools,
    capabilities: agent.capabilities,
    endpointObservation: agent.endpointObservation,
    reputation: agent.reputation,
    trustScore: agent.trustScore,
    freshness: agent.freshness,
  };
}

export class Trust8004MarketplaceAgentRepository implements MarketplaceAgentRepository {
  private readonly providerFactory: () => Trust8004Provider;
  private readonly cache: AsyncTtlCache;
  private readonly ttlMs: number;
  private readonly identityReaderFactory: () => BscIdentityReader;
  private readonly now: () => number;

  constructor(options: Trust8004MarketplaceRepositoryOptions = {}) {
    this.providerFactory = options.providerFactory ?? (() => new Trust8004Provider());
    this.cache = options.cache ?? new AsyncTtlCache();
    this.ttlMs = options.ttlMs ?? CATALOG_TTL_MS;
    this.identityReaderFactory = options.identityReaderFactory ?? createBscIdentityReader;
    this.now = options.now ?? Date.now;
  }

  listRegisteredPage(options: {
    page: number;
    limit: number;
    q?: string;
    sort?: MarketplaceDataSort;
  }): Promise<MarketplaceAgentDataPage> {
    const q = options.q?.trim();
    const sort = options.sort ?? "trust_score";
    const offset = (options.page - 1) * options.limit;
    const key = `registered-agents:${q?.toLowerCase() ?? ""}:${sort}:${options.page}:${options.limit}`;
    return this.cache.get(key, this.ttlMs, async () => {
      const provider = this.providerFactory();
      const page = await provider.listAgents({
        view: "all",
        ...(q ? { q } : {}),
        limit: options.limit,
        offset,
        includeReputation: true,
        includeTotal: true,
        ...providerSort(sort),
      });
      return {
        items: page.items.map((agent) => fromSummary(agent, page.fetchedAt)),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        fetchedAt: page.fetchedAt,
        catalogCoverage: page.catalogCoverage,
      };
    });
  }

  getById(agentId: string): Promise<MarketplaceAgentData | null> {
    return this.cache.get(`marketplace-agent:${agentId}`, this.ttlMs, async () => {
      try {
        const agent = await this.providerFactory().getAgent(agentId);
        return fromProfile(agent);
      } catch (error) {
        if (error && typeof error === "object" && "status" in error && error.status === 404) return null;
        throw error;
      }
    });
  }

  getOnchainIdentity(agentId: string): Promise<OnchainIdentityData> {
    return this.cache.get(`onchain-identity:${agentId}`, ONCHAIN_IDENTITY_TTL_MS, async () => {
      const reader = this.identityReaderFactory();
      const observedAt = new Date(this.now()).toISOString();
      let blockNumber: bigint | null = null;
      try {
        await reader.assertChain();
        blockNumber = await reader.getBlockNumber();
        const identity = await reader.readIdentity(agentId, blockNumber);
        return {
          status: "available",
          ...identity,
          registryAddress: reader.registryAddress,
          blockNumber: blockNumber.toString(),
          observedAt,
          error: null,
        };
      } catch (error) {
        const candidate = error && typeof error === "object" && "shortMessage" in error
          ? String((error as { shortMessage: unknown }).shortMessage)
          : error instanceof Error ? error.message : String(error);
        const message = candidate
          .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
          .replace(/(bearer|token|password|secret)=?\s*[^\s]+/gi, "$1=[redacted]")
          .slice(0, 300);
        return {
          status: "unavailable",
          owner: null,
          agentWallet: null,
          metadataUri: null,
          registryAddress: reader.registryAddress,
          blockNumber: blockNumber?.toString() ?? null,
          observedAt,
          error: {
            code: "ONCHAIN_IDENTITY_UNAVAILABLE",
            message: message || "Onchain identity is unavailable.",
          },
        };
      }
    });
  }
}
