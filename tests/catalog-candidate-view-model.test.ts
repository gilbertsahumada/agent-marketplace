import { describe, expect, it } from "vitest";
import { catalogCandidateCard } from "../components/marketplace/catalog-candidate-view-model.ts";
import type { CatalogCandidate } from "../src/business/entities/catalog-candidate.ts";

const NOW = 1_788_000_000_000;

function candidate(): CatalogCandidate {
  return {
    agentKey: "eip155:56:42", agentId: "42", chainId: 56, name: "Agent", description: null,
    imageUrl: null, categories: [], marketplaceConfigured: false, metadataState: "ok",
    registeredAt: null, blockNumber: null, priority: 60,
    declarations: [{ endpointKey: "a".repeat(64), protocol: "a2a", endpoint: "https://agent.example/a2a",
      originKey: "b".repeat(64), safety: "safe", safetyReason: null, representativeAgentKey: null,
      lastProbedAt: null, nextProbeAt: 0, consecutiveFailures: 0, priority: 60 }],
    observations: [],
  };
}

describe("catalog candidate card", () => {
  it("does not promote browser evidence to reachable", () => {
    const value = candidate();
    value.observations.push({ id: 1, agentKey: value.agentKey, endpointKey: "a".repeat(64),
      protocol: "a2a", source: "browser_reported", outcome: "protocol_valid", observedAt: NOW,
      expiresAt: NOW + 900_000, httpStatus: 200, errorCode: null, durationMs: 12, details: {} });
    const card = catalogCandidateCard(value, NOW);
    expect(card.evidence.find(({ kind }) => kind === "reachable")).toMatchObject({ status: "unknown" });
    expect(card.monitoring).toMatchObject({ state: "never_probed" });
  });

  it("shows fresh platform reachability and only enables Hire for configured marketplace sellers", () => {
    const value = candidate();
    value.marketplaceConfigured = true;
    value.platformAttemptCount = 17;
    value.observations.push({ id: 2, agentKey: value.agentKey, endpointKey: "a".repeat(64),
      protocol: "a2a", source: "worker_probe", outcome: "protocol_valid", observedAt: NOW,
      expiresAt: NOW + 900_000, httpStatus: 200, errorCode: null, durationMs: 20, details: {} });
    const card = catalogCandidateCard(value, NOW);
    expect(card.evidence.find(({ kind }) => kind === "reachable")).toMatchObject({ status: "verified" });
    expect(card.quoteRequestAvailable).toBe(true);
    expect(card.monitoring).toMatchObject({ attemptCount: 17 });
  });
});
