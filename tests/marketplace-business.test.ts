import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { CompareMarketplaceAgents } from "../src/business/use-cases/compare-marketplace-agents.js";
import { GetMarketplaceAgent } from "../src/business/use-cases/get-marketplace-agent.js";
import { GetMarketplaceLandingCatalog } from "../src/business/use-cases/get-marketplace-landing-catalog.js";
import { GetPublicVerificationSnapshot } from "../src/business/use-cases/get-public-verification-snapshot.js";
import { ListMarketplaceAgents } from "../src/business/use-cases/list-marketplace-agents.js";
import { AsyncTtlCache } from "../src/data/cache/async-ttl-cache.js";
import { MARKETPLACE_INVENTORY } from "../src/data/inventory/marketplace-inventory.js";
import type {
  MarketplaceAgentData,
  MarketplaceAgentRepository,
} from "../src/data/repositories/marketplace-agent-repository.js";
import { Trust8004MarketplaceAgentRepository } from "../src/data/repositories/trust8004-marketplace-agent-repository.js";
import { StaticPublicVerificationRepository } from "../src/data/repositories/public-verification-repository.js";
import { Trust8004Provider } from "../src/trust8004/provider.js";
import type { BscIdentityReader } from "../src/verification/onchain.js";

const FETCHED_AT = "2026-08-17T00:00:00.000Z";

function data(agentId: string, services = [{
  name: "MCP",
  endpoint: `https://fixture.invalid/${agentId}`,
  version: null,
  tools: ["declaredTool"],
  capabilities: ["tools"],
}]): MarketplaceAgentData {
  return {
    sourceDetail: "summary",
    chainId: 56,
    agentId,
    name: `Agent ${agentId}`,
    description: "Sanitized candidate",
    owner: "0x1111111111111111111111111111111111111111",
    metadataUri: `ipfs://sanitized/${agentId}`,
    services,
    endpoints: services.map((service) => ({ name: service.name, endpoint: service.endpoint })),
    tools: ["declaredTool"],
    capabilities: ["tools"],
    endpointObservation: {
      status: "not_observed",
      protocol: null,
      endpoint: null,
      lastTestedAt: null,
      httpStatus: null,
      capabilitiesCount: 0,
      requiresAuth: null,
      error: null,
    },
    reputation: { totalFeedbacks: 1, averageScore: 85, uniqueReviewers: null },
    trustScore: { total: 70, tier: "Silver", dimensions: {}, calculatedAt: null, expiresAt: null },
    freshness: { fetchedAt: FETCHED_AT, metadataUpdatedAt: null, indexedUpdatedAt: FETCHED_AT },
  };
}

function repository(items: MarketplaceAgentData[]): MarketplaceAgentRepository {
  return {
    listRegisteredPage: vi.fn(async ({ page, limit }) => ({
      items,
      total: 80_058,
      limit,
      offset: (page - 1) * limit,
      fetchedAt: FETCHED_AT,
      catalogCoverage: "partial" as const,
    })),
    getById: vi.fn(async (agentId) => items.find((item) => item.agentId === agentId) ?? null),
    getOnchainIdentity: vi.fn(async (agentId) => ({
      status: "available" as const,
      owner: "0x1111111111111111111111111111111111111111" as Address,
      agentWallet: "0x2222222222222222222222222222222222222222" as Address,
      metadataUri: `ipfs://sanitized/${agentId}`,
      registryAddress: "0x3333333333333333333333333333333333333333" as Address,
      blockNumber: "123",
      observedAt: FETCHED_AT,
      error: null,
    })),
  };
}

describe("marketplace business catalogue", () => {
  it("records category evidence and keeps Grid explicitly empty", () => {
    expect(MARKETPLACE_INVENTORY).toMatchObject({
      chainId: 56,
      provenance: "derived:marketplace-inventory",
      categories: {
        grid_trading: {
          status: "unverified",
          agentIds: [],
          verificationStatus: "candidate_unverified",
        },
      },
    });
  });

  it("keeps all view unclassified, preserves upstream pagination, and performs no profile reads", async () => {
    const source = repository([
      data("45650"),
      data("99999"),
    ]);
    const result = await new ListMarketplaceAgents(source).execute({ view: "all", page: 2, limit: 24 });

    expect(result.view).toBe("all");
    expect(result.pagination).toEqual({ page: 2, pageSize: 24, total: 80_058, totalPages: 3336 });
    expect(result.items.every((agent) => agent.categoryEvaluation === "not_evaluated")).toBe(true);
    expect(result.items.every((agent) => agent.hireability.status === "not_evaluated")).toBe(true);
    expect(source.listRegisteredPage).toHaveBeenCalledTimes(1);
    expect(source.listRegisteredPage).toHaveBeenCalledWith({ page: 2, limit: 24, sort: "newest" });
    expect(source.getById).not.toHaveBeenCalled();
    expect(source.getOnchainIdentity).not.toHaveBeenCalled();
  });

  it("resolves only manifest agents, deduplicates multi-label Venus, and exposes empty Grid", async () => {
    const source = repository([
      data("45650"),
      data("45381"),
      data("45422"),
      data("43129"),
      data("99999"),
    ]);
    const result = await new ListMarketplaceAgents(source).execute({ view: "marketplace", limit: 24 });

    expect(result.items.map((agent) => agent.agentId)).toEqual(["45650", "45381", "45422", "43129"]);
    expect(result.items.find((agent) => agent.agentId === "43129")?.categories.map((entry) => entry.category))
      .toEqual(["yield_optimisation", "health_factor_monitoring"]);
    expect(result.items.flatMap((agent) => agent.categories).every((entry) =>
      entry.evidence.kind === "derived" && entry.evidence.source === "marketplace-inventory"
    )).toBe(true);
    expect(result.categories.find((category) => category.category === "grid_trading"))
      .toEqual({ category: "grid_trading", count: 0, status: "unverified" });
    expect(result.items.every((agent) => agent.hireability.status === "mcp_only")).toBe(true);
    expect(result.items.every((agent) => !agent.hireability.canHire)).toBe(true);
    expect(source.getById).toHaveBeenCalledTimes(4);
    expect(source.getById).not.toHaveBeenCalledWith("99999");
    expect(source.listRegisteredPage).not.toHaveBeenCalled();
    expect(source.getOnchainIdentity).not.toHaveBeenCalled();
  });

  it("builds the landing catalogue from the sanitized release snapshot without live profile reads", () => {
    const result = new GetMarketplaceLandingCatalog(
      new GetPublicVerificationSnapshot(new StaticPublicVerificationRepository()),
    ).execute();

    expect(result.source).toBe("release_snapshot");
    expect(result.snapshot.agents.map(({ agentId }) => agentId)).toEqual(["45650", "45381", "45422", "43129"]);
    expect(result.categories.find(({ category }) => category === "grid_trading"))
      .toEqual({ category: "grid_trading", count: 0, status: "unverified" });
    expect(result.snapshot.agents.find(({ agentId }) => agentId === "43129")?.categories)
      .toEqual(["yield_optimisation", "health_factor_monitoring"]);
  });

  it("filters categories without duplicating a multi-label agent and limits page size to 24", async () => {
    const useCase = new ListMarketplaceAgents(repository([
      data("45650"), data("45381"), data("45422"), data("43129"),
    ]));
    const result = await useCase.execute({ view: "marketplace", category: "yield_optimisation", limit: 24 });
    expect(result.items.map((agent) => agent.agentId)).toEqual(["45422", "43129"]);
    await expect(useCase.execute({ view: "all", limit: 25 })).rejects.toThrow("at most 24");
  });

  it("returns an open registry profile without globally classifying it", async () => {
    const useCase = new GetMarketplaceAgent(repository([data("99999")]));
    await expect(useCase.execute({ agentId: "99999" })).resolves.toMatchObject({
      agentId: "99999",
      categoryEvaluation: "not_evaluated",
      categories: [],
      hireability: { status: "not_evaluated", canHire: false },
      onchainIdentity: { status: "match", agentWallet: "0x2222222222222222222222222222222222222222" },
    });
  });

  it("keeps indexed and direct identity separate for match, mismatch, and unavailable reads", async () => {
    const candidate = data("45650");
    const source = repository([candidate]);
    const getAgent = new GetMarketplaceAgent(source);
    const match = await getAgent.execute({ agentId: "45650" });
    expect(match.indexedIdentity.evidence).toMatchObject({
      source: "trust8004-public-api",
      verifiedDirectly: false,
    });
    expect(match.onchainIdentity).toMatchObject({
      status: "match",
      checks: { ownerMatches: true, metadataUriMatches: true },
      evidence: { source: "bsc-rpc", verifiedDirectly: true },
    });

    vi.mocked(source.getOnchainIdentity).mockResolvedValueOnce({
      status: "available",
      owner: "0x9999999999999999999999999999999999999999",
      agentWallet: "0x2222222222222222222222222222222222222222",
      metadataUri: candidate.metadataUri!,
      registryAddress: "0x3333333333333333333333333333333333333333",
      blockNumber: "124",
      observedAt: FETCHED_AT,
      error: null,
    });
    await expect(getAgent.execute({ agentId: "45650" })).resolves.toMatchObject({
      onchainIdentity: {
        status: "mismatch",
        checks: { ownerMatches: false, metadataUriMatches: true },
      },
    });

    vi.mocked(source.getOnchainIdentity).mockResolvedValueOnce({
      status: "unavailable",
      owner: null,
      agentWallet: null,
      metadataUri: null,
      registryAddress: "0x3333333333333333333333333333333333333333",
      blockNumber: null,
      observedAt: FETCHED_AT,
      error: { code: "ONCHAIN_IDENTITY_UNAVAILABLE", message: "RPC unavailable" },
    });
    const unavailable = await getAgent.execute({ agentId: "45650" });
    expect(unavailable.name).toBe(candidate.name);
    expect(unavailable.onchainIdentity).toMatchObject({
      status: "unavailable",
      error: { code: "ONCHAIN_IDENTITY_UNAVAILABLE" },
    });
  });

  it("compares two or three open IDs through detail reads and no universal winner", async () => {
    const source = repository([data("45650"), data("43129"), data("45381")]);
    const result = await new CompareMarketplaceAgents(source).execute({ agentIds: ["43129", "45650"] });
    expect(result.agents.map((agent) => agent.agentId)).toEqual(["43129", "45650"]);
    expect(result.winner).toBeNull();
    expect(source.getById).toHaveBeenCalledTimes(2);
    expect(source.listRegisteredPage).not.toHaveBeenCalled();
  });
});

describe("Trust8004 marketplace repository", () => {
  it("uses one enriched list request, filters the manifest, and deduplicates concurrent refreshes", async () => {
    let requestCount = 0;
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    let requestedUrl = "";
    const response = {
      items: ["45650", "45381", "45422", "43129", "45564"].map((agentId) => ({
        chainId: 56,
        agentId,
        name: `Agent ${agentId}`,
        description: "Sanitized",
        ownerAddress: "0x1111111111111111111111111111111111111111",
        ipfsUri: `ipfs://sanitized/${agentId}`,
        mcpEndpoint: `https://fixture.invalid/${agentId}`,
        a2aEndpoint: null,
        services: [{ name: "MCP", endpoint: `https://fixture.invalid/${agentId}`, tools: ["declaredTool"] }],
        endpoints: [],
        skills: [],
        capabilities: null,
        endpointHealth: null,
        trustScore: 70,
        trustTier: "Silver",
        active: true,
        updatedAt: 1_776_643_200_000,
      })),
      total: 5,
      limit: 24,
      offset: 0,
      reputations: {},
    };
    const fetchImpl = (async (input: string | URL | Request) => {
      requestCount += 1;
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      requestedUrl = input instanceof Request ? input.url : input.toString();
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeRequests -= 1;
      return Response.json(response);
    }) as typeof fetch;
    const provider = new Trust8004Provider({
      fetch: fetchImpl,
      minimumRequestIntervalMs: 0,
      now: () => 1_776_643_200_000,
    });
    const dataRepository = new Trust8004MarketplaceAgentRepository({
      provider,
      cache: new AsyncTtlCache(() => 1_776_643_200_000),
    });

    const [first, second] = await Promise.all([
      dataRepository.listRegisteredPage({ page: 1, limit: 24, q: "HeyAnon" }),
      dataRepository.listRegisteredPage({ page: 1, limit: 24, q: "HeyAnon" }),
    ]);
    expect(requestCount).toBe(1);
    expect(first.items).toHaveLength(5);
    expect(first.total).toBe(5);
    expect(second).toEqual(first);
    const url = new URL(requestedUrl);
    expect(url.searchParams.get("view")).toBe("all");
    expect(url.searchParams.get("search")).toBe("HeyAnon");
    expect(url.searchParams.get("limit")).toBe("24");
    expect(url.searchParams.get("includeReputation")).toBe("true");
    expect(url.searchParams.get("active")).toBe("true");

    await Promise.all([
      dataRepository.listRegisteredPage({ page: 1, limit: 24, q: "Venus" }),
      dataRepository.listRegisteredPage({ page: 2, limit: 24, q: "Aave" }),
    ]);
    expect(requestCount).toBe(3);
    expect(maximumActiveRequests).toBe(1);
  });

  it("caches direct identity reads and sanitizes an unavailable RPC without failing the profile", async () => {
    let reads = 0;
    const identityReader: BscIdentityReader = {
      registryAddress: "0x3333333333333333333333333333333333333333",
      assertChain: async () => undefined,
      getBlockNumber: async () => 123n,
      readIdentity: async () => {
        reads += 1;
        throw new Error("RPC https://secret.invalid?token=value failed");
      },
    };
    const dataRepository = new Trust8004MarketplaceAgentRepository({
      identityReaderFactory: () => identityReader,
      cache: new AsyncTtlCache(() => 1_776_643_200_000),
      now: () => 1_776_643_200_000,
    });

    const [first, second] = await Promise.all([
      dataRepository.getOnchainIdentity("45650"),
      dataRepository.getOnchainIdentity("45650"),
    ]);
    expect(reads).toBe(1);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "unavailable",
      blockNumber: "123",
      error: { code: "ONCHAIN_IDENTITY_UNAVAILABLE" },
    });
    expect(JSON.stringify(first)).not.toContain("secret.invalid");
    expect(JSON.stringify(first)).not.toContain("token=value");
    expect(first).toMatchObject({
      error: { message: "Direct BSC identity verification is currently unavailable." },
    });
  });

  it("degrades safely when the BSC identity reader cannot be constructed", async () => {
    const dataRepository = new Trust8004MarketplaceAgentRepository({
      identityReaderFactory: () => {
        throw new Error("Authorization: Bearer secret-token https://private.invalid/rpc");
      },
      cache: new AsyncTtlCache(() => 1_776_643_200_000),
      now: () => 1_776_643_200_000,
    });

    await expect(dataRepository.getOnchainIdentity("45650")).resolves.toMatchObject({
      status: "unavailable",
      registryAddress: null,
      blockNumber: null,
      error: {
        code: "ONCHAIN_IDENTITY_UNAVAILABLE",
        message: "Direct BSC identity verification is currently unavailable.",
      },
    });
  });
});

describe("AsyncTtlCache", () => {
  it("expires values and evicts the least recently used entry at its bound", async () => {
    let now = 0;
    const cache = new AsyncTtlCache(() => now, 2);
    const loads = new Map<string, number>();
    const read = (key: string) => cache.get(key, 10, async () => {
      loads.set(key, (loads.get(key) ?? 0) + 1);
      return `${key}:${loads.get(key)}`;
    });

    await read("a");
    await read("b");
    await read("a");
    await read("c");
    await read("b");
    expect(loads.get("a")).toBe(1);
    expect(loads.get("b")).toBe(2);

    now = 11;
    await read("a");
    expect(loads.get("a")).toBe(2);
  });

  it("bounds concurrent unique cache misses", async () => {
    const cache = new AsyncTtlCache(Date.now, 2);
    const never = () => new Promise<string>(() => undefined);
    void cache.get("a", 10, never);
    void cache.get("b", 10, never);
    await expect(cache.get("c", 10, async () => "c")).rejects.toThrow("cache request capacity exceeded");
  });
});
