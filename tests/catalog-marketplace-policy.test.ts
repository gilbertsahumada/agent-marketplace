import { describe, expect, it } from "vitest";
import type { CatalogCandidate } from "../src/business/entities/catalog-candidate.ts";
import type { MarketplaceAgentData } from "../src/data/repositories/marketplace-agent-repository.ts";
import { toMarketplaceAgent } from "../src/business/policies/marketplace-agent-policy.ts";

const OBSERVED_AT = 1_788_000_000_000;

function baseData(): MarketplaceAgentData {
  return {
    sourceDetail: "profile",
    chainId: 56,
    agentId: "42",
    name: "Legacy name",
    description: "Legacy description",
    owner: "0x1111111111111111111111111111111111111111",
    metadataUri: "ipfs://legacy",
    services: [{ name: "A2A", endpoint: "https://legacy.example/a2a", version: null, tools: [], capabilities: [] }],
    endpoints: [{ name: "A2A", endpoint: "https://legacy.example/a2a" }],
    tools: [],
    capabilities: [],
    endpointObservation: {
      status: "observed_ok", protocol: "a2a", endpoint: "https://legacy.example/a2a",
      lastTestedAt: new Date(OBSERVED_AT - 10_000).toISOString(), httpStatus: 200,
      capabilitiesCount: 1, requiresAuth: false, error: null,
    },
    reputation: { totalFeedbacks: 0, averageScore: null, uniqueReviewers: null },
    trustScore: { total: null, tier: null, dimensions: {}, calculatedAt: null, expiresAt: null },
    freshness: {
      fetchedAt: new Date(OBSERVED_AT).toISOString(), metadataUpdatedAt: null,
      indexedUpdatedAt: new Date(OBSERVED_AT).toISOString(),
    },
  };
}

function candidate(state: NonNullable<CatalogCandidate["state"]>): CatalogCandidate {
  return {
    agentKey: "eip155:56:42", agentId: "42", chainId: 56, owner: baseData().owner,
    metadataUri: "ipfs://normalized", name: "Normalized name", description: "Normalized description",
    imageUrl: null, categories: ["grid_trading"], marketplaceConfigured: false, metadataState: "ok",
    registeredAt: OBSERVED_AT, blockNumber: "123", priority: 100, state,
    admission: { state: "admitted", endpointKey: "a".repeat(64) },
    declarations: [{
      endpointKey: "a".repeat(64), protocol: "a2a", endpoint: "https://normalized.example/a2a",
      originKey: "b".repeat(64), safety: "safe", safetyReason: null, representativeAgentKey: "eip155:56:42",
      lastProbedAt: OBSERVED_AT, nextProbeAt: OBSERVED_AT + 900_000, consecutiveFailures: 0, priority: 100,
    }],
    observations: [{
      id: 1, agentKey: "eip155:56:42", endpointKey: "a".repeat(64), protocol: "a2a",
      source: "worker_probe", outcome: "protocol_valid", observedAt: OBSERVED_AT,
      expiresAt: OBSERVED_AT + 900_000, httpStatus: 200, errorCode: null, durationMs: 42, details: {},
      validationKind: "protocol", verificationLevel: "platform_observed",
    }],
  };
}

describe("catalog-backed marketplace policy", () => {
  it("uses normalized admission and platform evidence instead of legacy hireability", () => {
    const normalized = candidate({
      operationalStatus: "platform_reachable", freshness: "live", commerceStatus: "admitted",
      quoteStatus: "verified_fresh", buyerAction: "prepare_hire", canRequestBrowserValidation: true,
      canRequestInfrastructureValidation: true, canRequestQuote: true, canPrepareHire: true, blockingReasons: [],
    });
    const agent = toMarketplaceAgent({ ...baseData(), catalogCandidate: normalized }, { evaluateMarketplace: false });

    expect(agent).toMatchObject({
      name: "Legacy name",
      operator: "marketplace",
      categoryEvaluation: "evaluated",
      categories: [{ category: "grid_trading" }],
      hireability: { status: "quote_verified", canHire: true },
      endpointObservation: {
        status: "observed_ok", protocol: "a2a", endpoint: "https://normalized.example/a2a",
        lastTestedAt: new Date(OBSERVED_AT).toISOString(),
      },
    });
    expect(agent.hireability.reason).toContain("normalized catalog");
    expect(agent.provenance.endpointObservation).toMatchObject({ source: "marketplace-readiness", verifiedDirectly: true });
  });

  it("does not revive a stale legacy endpoint result when the catalog has no platform attempt", () => {
    const normalized = candidate({
      operationalStatus: "pending", freshness: "never", commerceStatus: "admission_pending",
      quoteStatus: "not_requested", buyerAction: "request_quote", canRequestBrowserValidation: true,
      canRequestInfrastructureValidation: true, canRequestQuote: true, canPrepareHire: false,
      blockingReasons: ["COMMERCE_NOT_ADMITTED"],
    });
    normalized.observations = [];
    const agent = toMarketplaceAgent({ ...baseData(), catalogCandidate: normalized }, { evaluateMarketplace: false });

    expect(agent.endpointObservation).toMatchObject({ status: "not_observed", protocol: null, endpoint: null });
    expect(agent.hireability).toMatchObject({ status: "protocol_discovered", canHire: false });
  });

  it("keeps an admitted seller hireable for fresh-quote negotiation without claiming prepare readiness", () => {
    const normalized = candidate({
      operationalStatus: "platform_reachable", freshness: "live", commerceStatus: "admitted",
      quoteStatus: "not_requested", buyerAction: "request_quote", canRequestBrowserValidation: true,
      canRequestInfrastructureValidation: true, canRequestQuote: true, canPrepareHire: false,
      blockingReasons: ["FRESH_QUOTE_REQUIRED"],
    });
    const agent = toMarketplaceAgent({ ...baseData(), catalogCandidate: normalized }, { evaluateMarketplace: false });

    expect(agent.hireability).toMatchObject({ status: "protocol_discovered", canHire: true });
    expect(agent.hireability.reason).toContain("fresh quote");
  });
});
