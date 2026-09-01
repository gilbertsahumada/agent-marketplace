import { describe, expect, it, vi } from "vitest";
import type { CatalogCandidate } from "../src/business/entities/catalog-candidate.ts";
import type {
  MarketplaceAgentData,
  MarketplaceAgentRepository,
} from "../src/data/repositories/marketplace-agent-repository.ts";
import type { Address } from "viem";
import { ListMarketplaceAgents } from "../src/business/use-cases/list-marketplace-agents.ts";
import { GetMarketplaceAgent } from "../src/business/use-cases/get-marketplace-agent.ts";
import {
  catalogCandidateToMarketplaceAgentData,
  type CatalogCandidatePageReader,
  type CatalogCandidateReader,
} from "../src/data/observation/catalog-marketplace-adapter.ts";

const GENERATED_AT = 1_788_000_000_000;

function data(agentId: string): MarketplaceAgentData {
  return {
    sourceDetail: "summary", chainId: 56, agentId, name: `Agent ${agentId}`, description: null,
    owner: "0x1111111111111111111111111111111111111111", metadataUri: `ipfs://${agentId}`,
    services: [], endpoints: [], tools: [], capabilities: [],
    endpointObservation: {
      status: "observed_ok", protocol: "a2a", endpoint: "https://legacy.invalid/a2a",
      lastTestedAt: new Date(GENERATED_AT - 10_000).toISOString(), httpStatus: 200,
      capabilitiesCount: 0, requiresAuth: null, error: null,
    },
    reputation: { totalFeedbacks: 2, averageScore: 90, uniqueReviewers: null },
    trustScore: { total: 80, tier: "Gold", dimensions: {}, calculatedAt: null, expiresAt: null },
    freshness: {
      fetchedAt: new Date(GENERATED_AT).toISOString(), metadataUpdatedAt: null,
      indexedUpdatedAt: new Date(GENERATED_AT).toISOString(),
    },
  };
}

function candidate(agentId: string, canPrepareHire = true): CatalogCandidate {
  const agentKey = `eip155:56:${agentId}`;
  const endpointKey = "a".repeat(64);
  return {
    agentKey, agentId, chainId: 56, owner: "0x1111111111111111111111111111111111111111",
    metadataUri: `ipfs://normalized/${agentId}`, name: `Normalized ${agentId}`, description: "normalized",
    imageUrl: null, categories: ["grid_trading"], marketplaceConfigured: false,
    metadataState: "ok", registeredAt: GENERATED_AT, blockNumber: "123", priority: 100,
    admission: { state: canPrepareHire ? "admitted" : "candidate", endpointKey },
    state: {
      operationalStatus: "platform_reachable", freshness: "live",
      commerceStatus: canPrepareHire ? "admitted" : "admission_pending",
      quoteStatus: canPrepareHire ? "verified_fresh" : "not_requested",
      buyerAction: canPrepareHire ? "prepare_hire" : "request_quote",
      canRequestBrowserValidation: true, canRequestInfrastructureValidation: true,
      canRequestQuote: true, canPrepareHire, blockingReasons: canPrepareHire ? [] : ["COMMERCE_NOT_ADMITTED"],
    },
    declarations: [{
      endpointKey, protocol: "a2a", endpoint: "https://normalized.invalid/a2a",
      originKey: "b".repeat(64), safety: "safe", safetyReason: null,
      representativeAgentKey: agentKey, lastProbedAt: GENERATED_AT,
      nextProbeAt: GENERATED_AT + 900_000, consecutiveFailures: 0, priority: 100,
    }],
    observations: [{
      id: Number(agentId), agentKey, endpointKey, protocol: "a2a", source: "worker_probe",
      outcome: "protocol_valid", observedAt: GENERATED_AT, expiresAt: GENERATED_AT + 900_000,
      httpStatus: 200, errorCode: null, durationMs: 12, details: {},
      validationKind: "protocol", verificationLevel: "platform_observed",
    }],
  };
}

function repository(records: MarketplaceAgentData[]): MarketplaceAgentRepository {
  return {
    listRegisteredPage: vi.fn(async ({ page, limit }) => ({
      items: records, total: records.length, limit, offset: (page - 1) * limit,
      fetchedAt: new Date(GENERATED_AT).toISOString(), catalogCoverage: "partial" as const,
    })),
    getById: vi.fn(async (agentId) => records.find((record) => record.agentId === agentId) ?? null),
    getOnchainIdentity: vi.fn(async (agentId) => ({
      status: "available" as const,
      owner: "0x1111111111111111111111111111111111111111" as Address,
      agentWallet: "0x2222222222222222222222222222222222222222" as Address,
      metadataUri: `ipfs://${agentId}`,
      registryAddress: "0x3333333333333333333333333333333333333333" as Address,
      blockNumber: "123", observedAt: new Date(GENERATED_AT).toISOString(), error: null,
    })),
  };
}

describe("public catalog application adapter", () => {
  it("uses the admitted endpoint before a newer observation on another declaration", () => {
    const normalized = candidate("42");
    const admittedEndpoint = normalized.declarations[0]!;
    const otherEndpointKey = "c".repeat(64);
    normalized.declarations.push({ ...admittedEndpoint, endpointKey: otherEndpointKey, endpoint: "https://other.invalid/a2a" });
    normalized.observations.push({
      ...normalized.observations[0]!, id: 99, endpointKey: otherEndpointKey,
      observedAt: GENERATED_AT + 10_000, expiresAt: GENERATED_AT + 910_000,
    });

    expect(catalogCandidateToMarketplaceAgentData(normalized).endpointObservation).toMatchObject({
      endpoint: admittedEndpoint.endpoint,
      lastTestedAt: new Date(GENERATED_AT).toISOString(),
    });
  });

  it("does not expose external declarations as machine services", () => {
    const normalized = candidate("42");
    normalized.declarations.push({
      ...normalized.declarations[0]!,
      endpointKey: "c".repeat(64),
      endpoint: "https://social.example/profile",
      protocol: "web",
      declaredProtocol: "mcp",
      role: "external",
      validationProtocol: null,
      externalKind: "social",
      eligibility: "unsupported",
      representativeAgentKey: null,
    });
    normalized.declarations.push({
      ...normalized.declarations[0]!,
      endpointKey: "d".repeat(64),
      endpoint: "https://unsafe.example/a2a",
      safety: "unsafe",
      role: "operational",
      validationProtocol: "a2a",
      eligibility: "eligible",
      representativeAgentKey: null,
    });

    const result = catalogCandidateToMarketplaceAgentData(normalized);

    expect(result.services).toHaveLength(1);
    expect(result.services[0]).toMatchObject({ name: "A2A", endpoint: "https://normalized.invalid/a2a" });
  });

  it("maps Worker v2 candidates into the public marketplace response", async () => {
    const pageReader: CatalogCandidatePageReader = {
      execute: vi.fn(async () => ({
        schemaVersion: 2, status: "declared" as const, statuses: ["declared" as const], query: "",
        category: null, categories: [], generatedAt: GENERATED_AT, page: 1, limit: 24, total: 1,
        items: [candidate("42")],
      })),
    };
    const result = await new ListMarketplaceAgents(repository([data("42")]), pageReader).execute({
      view: "marketplace", page: 1, limit: 24,
    });

    expect(result).toMatchObject({
      view: "marketplace", pagination: { total: 1 },
      items: [{ agentId: "42", hireability: { status: "quote_verified", canHire: true }, operator: "marketplace" }],
    });
    expect(pageReader.execute).toHaveBeenCalledWith({ page: 1, limit: 24, inventory: "operational" });
  });

  it("uses server-side protocol and commerce filters for the MCP-only view", async () => {
    const normalized = candidate("42", false);
    normalized.admission = null;
    normalized.state = {
      ...normalized.state!,
      commerceStatus: "none",
      buyerAction: "check_availability",
      canRequestQuote: false,
    };
    normalized.declarations = [{
      ...normalized.declarations[0]!, protocol: "mcp", endpoint: "https://normalized.invalid/mcp",
    }];
    normalized.observations = [{
      ...normalized.observations[0]!, protocol: "mcp",
    }];
    const pageReader: CatalogCandidatePageReader = {
      execute: vi.fn(async () => ({
        schemaVersion: 2, status: "declared" as const, statuses: ["declared" as const], query: "",
        category: null, categories: [], generatedAt: GENERATED_AT, page: 1, limit: 24, total: 1,
        items: [normalized],
      })),
    };

    const result = await new ListMarketplaceAgents(repository([data("42")]), pageReader).execute({
      view: "marketplace", availability: "mcp_only", page: 1, limit: 24,
    });

    expect(result.items).toMatchObject([{ agentId: "42", hireability: { status: "mcp_only", canHire: false } }]);
    expect(pageReader.execute).toHaveBeenCalledWith({
      page: 1, limit: 24, statuses: ["mcp_only"], inventory: "operational",
    });
  });

  it("uses a catalog identity when trust8004 enrichment is temporarily unavailable", async () => {
    const reader: CatalogCandidateReader = { execute: vi.fn(async () => candidate("42", false)) };
    const source = repository([]);
    const agent = await new GetMarketplaceAgent(source, reader).execute({ agentId: "42" });

    expect(agent).toMatchObject({
      agentId: "42", name: "Normalized 42", categoryEvaluation: "evaluated",
      hireability: { status: "protocol_discovered", canHire: false },
    });
    expect(source.getById).toHaveBeenCalledWith("42");
  });
});
