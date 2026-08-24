import { AsyncTtlCache } from "../cache/async-ttl-cache.js";
import { Trust8004Provider } from "../../trust8004/provider.js";
import type { AgentListItem, MarketplaceAgent } from "../../trust8004/types.js";
import { createBscIdentityReader, type BscIdentityReader } from "../../verification/onchain.js";
import { DEFAULT_REGISTERED_AGENT_SORT } from "./marketplace-agent-repository.js";
import {
  PUBLIC_VERIFICATION_SNAPSHOT,
  publicVerificationForAgent,
} from "../verification/public-verification-snapshot.js";
import type {
  MarketplaceAgentData,
  MarketplaceAgentDataPage,
  MarketplaceAgentRepository,
  MarketplaceDataSort,
  OnchainIdentityData,
} from "./marketplace-agent-repository.js";

const CATALOG_TTL_MS = 5 * 60 * 1_000;
const ONCHAIN_IDENTITY_TTL_MS = 60 * 1_000;
const sharedTrust8004Provider = new Trust8004Provider();

export interface Trust8004MarketplaceRepositoryOptions {
  provider?: Trust8004Provider;
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
    verification: null,
  };
}

function fromProfile(agent: MarketplaceAgent, now: number): MarketplaceAgentData {
  const verification = publicVerificationForAgent(agent.agentId, now);
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
    verification: verification ? {
      freshness: verification.freshness,
      generatedAt: PUBLIC_VERIFICATION_SNAPSHOT.generatedAt,
      staleAfter: PUBLIC_VERIFICATION_SNAPSHOT.staleAfter,
      blockNumber: PUBLIC_VERIFICATION_SNAPSHOT.blockNumber,
      identity: verification.identity,
      tools: verification.tools,
    } : null,
  };
}

export class Trust8004MarketplaceAgentRepository implements MarketplaceAgentRepository {
  private readonly provider: Trust8004Provider;
  private readonly cache: AsyncTtlCache;
  private readonly ttlMs: number;
  private readonly identityReaderFactory: () => BscIdentityReader;
  private readonly now: () => number;

  constructor(options: Trust8004MarketplaceRepositoryOptions = {}) {
    this.provider = options.provider ?? sharedTrust8004Provider;
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
    const sort = options.sort ?? DEFAULT_REGISTERED_AGENT_SORT;
    const offset = (options.page - 1) * options.limit;
    const key = `registered-agents:${q?.toLowerCase() ?? ""}:${sort}:${options.page}:${options.limit}`;
    return this.cache.get(key, this.ttlMs, async () => {
      const page = await this.provider.listAgents({
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
        const agent = await this.provider.getAgent(agentId);
        return fromProfile(agent, this.now());
      } catch (error) {
        if (error && typeof error === "object" && "status" in error && error.status === 404) return null;
        throw error;
      }
    });
  }

  getOnchainIdentity(agentId: string): Promise<OnchainIdentityData> {
    return this.cache.get(`onchain-identity:${agentId}`, ONCHAIN_IDENTITY_TTL_MS, async () => {
      const observedAt = new Date(this.now()).toISOString();
      let reader: BscIdentityReader | null = null;
      let blockNumber: bigint | null = null;
      try {
        reader = this.identityReaderFactory();
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
        void error;
        return {
          status: "unavailable",
          owner: null,
          agentWallet: null,
          metadataUri: null,
          registryAddress: reader?.registryAddress ?? null,
          blockNumber: blockNumber?.toString() ?? null,
          observedAt,
          error: {
            code: "ONCHAIN_IDENTITY_UNAVAILABLE",
            message: "Direct BSC identity verification is currently unavailable.",
          },
        };
      }
    });
  }
}
