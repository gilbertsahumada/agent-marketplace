import { describe, expect, it } from "vitest";
import { agentCardWithObservation, agentCardWithObservations, evidenceForAgent, snapshotAgentCardViewModel } from "../components/marketplace/view-models.ts";
import { determineHireability, toMarketplaceAgent } from "../src/business/policies/marketplace-agent-policy.ts";
import { assertPublicVerificationSnapshotFresh, parsePublicVerificationSnapshot } from "../src/data/verification/public-verification-snapshot.ts";
import type { MarketplaceAgentData } from "../src/data/repositories/marketplace-agent-repository.ts";
import type { WorkerObservationTarget } from "../src/business/entities/worker-observations.ts";
import {
  marketplaceEvidenceFromReleaseInput,
  sanitizeVerificationReport,
  verificationReportFromReleaseInput,
} from "../src/verification/publish.ts";
import type { BscVerificationReport, McpVerificationStatus } from "../src/verification/types.ts";

const GENERATED_AT = "2026-08-24T12:00:00.000Z";

function verificationReport(status: McpVerificationStatus): BscVerificationReport {
  return {
    schemaVersion: 2,
    generatedAt: GENERATED_AT,
    chainId: 56,
    catalog: { source: "trust8004", coverage: "partial", snapshotGeneratedAt: GENERATED_AT },
    onchain: {
      network: "bsc-mainnet",
      registryAddress: "0x1111111111111111111111111111111111111111",
      blockNumber: "123",
    },
    categories: {
      rebalancing: { status: "unverified", agentIds: [], note: "none" },
      grid_trading: { status: "candidates", agentIds: ["9001"], note: "operated" },
      yield_optimisation: { status: "unverified", agentIds: [], note: "none" },
      health_factor_monitoring: { status: "unverified", agentIds: [], note: "none" },
    },
    summary: {
      status: status === "protocol_valid" ? "complete" : "attention_required",
      agentsTotal: 1,
      identityMatches: 1,
      identityAttention: 0,
      endpointsTotal: 1,
      endpointsValid: status === "protocol_valid" ? 1 : 0,
      endpointsNotProbed: status === "not_probed" ? 1 : 0,
      endpointAttention: status === "protocol_valid" ? 0 : 1,
      agentsWithoutMcpEndpoint: 0,
      toolDriftEndpoints: 0,
    },
    agents: [{
      agentId: "9001",
      name: "Marketplace Grid planner",
      categories: ["grid_trading"],
      identity: {
        status: "match",
        declared: {
          owner: "0x2222222222222222222222222222222222222222",
          metadataUri: "ipfs://sanitized",
          provenance: "declared:trust8004-public-api",
        },
        onchain: {
          owner: "0x2222222222222222222222222222222222222222",
          agentWallet: "0x3333333333333333333333333333333333333333",
          metadataUri: "ipfs://sanitized",
          registryAddress: "0x1111111111111111111111111111111111111111",
          blockNumber: "123",
          provenance: "onchain:bsc-rpc",
        },
        checks: { ownerMatches: true, metadataUriMatches: true },
        observedAt: GENERATED_AT,
        error: null,
      },
      mcpEndpoints: [{
        status,
        endpoint: "https://removed.example/mcp",
        protocol: "mcp",
        declaredTools: ["planGrid"],
        observedTools: status === "protocol_valid" ? ["planGrid"] : [],
        comparison: {
          matched: status === "protocol_valid" ? ["planGrid"] : [],
          declaredOnly: status === "protocol_valid" ? [] : ["planGrid"],
          observedOnly: [],
        },
        negotiatedProtocolVersion: status === "protocol_valid" ? "2025-06-18" : null,
        serverInfo: null,
        latencyMs: status === "not_probed" ? null : 100,
        observedAt: status === "not_probed" ? null : GENERATED_AT,
        provenance: status === "not_probed"
          ? "declared:trust8004-public-api+derived:probe-budget"
          : "observed:mcp-tools-list",
        error: status === "protocol_valid" || status === "not_probed"
          ? null
          : { code: "MCP_TIMEOUT", message: "Sanitized timeout" },
      }],
      hireability: "not_assessed",
    }],
  };
}

function readinessInput(status: McpVerificationStatus) {
  return {
    schemaVersion: 3,
    verification: verificationReport(status),
    sellerQualification: { status: "passed", qualifiedAgentIds: ["9001"] },
    candidates: [{
      agentId: "9001",
      selection: "marketplace_operated",
      qualification: {
        status: "qualified",
        observedAt: "2026-08-24T11:59:30.000Z",
        reasons: [],
        provenance: "derived:marketplace-seller-qualification",
      },
    }],
  };
}

function marketplaceData(qualification: "qualified" | "not_qualified", freshness: "current" | "stale"): MarketplaceAgentData {
  return {
    sourceDetail: "profile",
    chainId: 56,
    agentId: "9001",
    name: "Marketplace Grid planner",
    description: "Deterministic Grid planning",
    owner: "0x2222222222222222222222222222222222222222",
    metadataUri: "ipfs://sanitized",
    services: [{ name: "A2A", endpoint: "https://seller.example/a2a", version: null, tools: [], capabilities: [] }],
    endpoints: [{ name: "A2A", endpoint: "https://seller.example/a2a" }],
    tools: [],
    capabilities: [],
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
    reputation: { totalFeedbacks: 0, averageScore: null, uniqueReviewers: null },
    trustScore: { total: null, tier: null, dimensions: {}, calculatedAt: null, expiresAt: null },
    freshness: { fetchedAt: GENERATED_AT, metadataUpdatedAt: null, indexedUpdatedAt: null },
    verification: {
      freshness,
      generatedAt: GENERATED_AT,
      staleAfter: "2026-08-27T12:00:00.000Z",
      blockNumber: "123",
      selection: "marketplace_operated",
      operator: "marketplace",
      qualification: {
        status: qualification,
        observedAt: GENERATED_AT,
        provenance: "derived:marketplace-seller-qualification",
      },
      identity: { status: "match", mismatchFields: [], observedAt: GENERATED_AT, provenance: ["declared", "onchain"] },
      tools: {
        status: "observed",
        probeOutcomes: ["protocol_valid"],
        reachability: "verified",
        declaredOnly: [],
        observedOnly: [],
        observedAt: GENERATED_AT,
      },
    },
  };
}

describe("PR 16 marketplace evidence boundaries", () => {
  it("never falls back to release qualification when the Worker has no target", () => {
    const agent = toMarketplaceAgent(marketplaceData("qualified", "current"), { evaluateMarketplace: false });
    const card = agentCardWithObservation(agent, null, true, Date.parse(GENERATED_AT));

    expect(card.hireability).toBe("listed_only");
    expect(card.evidence.find(({ kind }) => kind === "quote")).toMatchObject({
      status: "unavailable",
      provenance: "not_probed",
    });
    expect(card.evidence.find(({ kind }) => kind === "quote")).not.toHaveProperty("timestamp");
  });

  it("does not treat a recent quote on a removed target as current", () => {
    const now = Date.parse(GENERATED_AT);
    const agent = toMarketplaceAgent(marketplaceData("qualified", "current"), { evaluateMarketplace: false });
    const card = agentCardWithObservation(agent, {
      agentId: agent.agentId,
      chainId: 56,
      transport: "a2a",
      endpoint: "https://seller.example/grid",
      name: agent.name,
      categories: ["grid_trading"],
      declarationState: "removed",
      currentMetadataUpdatedAt: now,
      lastMetadataCheckedAt: now,
      latest: {
        probedAt: now,
        probeCategory: "grid_trading",
        outcome: "quote_verified",
        observedMetadataUpdatedAt: now,
        quoteNegotiatedAt: now,
        quoteExpiresAt: now + 60_000,
        errorCode: null,
      },
      latestByCategory: {},
    }, true, now);

    expect(card.hireability).toBe("quote_stale");
    expect(card.evidence.find(({ kind }) => kind === "reachable")?.detail).toContain("no longer declared");
  });

  it("uses the category-specific observation in a filtered catalogue", () => {
    const now = Date.parse(GENERATED_AT);
    const agent = toMarketplaceAgent(marketplaceData("qualified", "current"), { evaluateMarketplace: false });
    const quote = {
      probedAt: now,
      probeCategory: "grid_trading" as const,
      outcome: "quote_verified" as const,
      observedMetadataUpdatedAt: now,
      quoteNegotiatedAt: now,
      quoteExpiresAt: now + 60_000,
      errorCode: null,
    };
    const target = {
      agentId: agent.agentId,
      chainId: 56,
      transport: "a2a",
      endpoint: "https://seller.example/grid",
      name: agent.name,
      categories: ["grid_trading", "yield_optimisation"],
      declarationState: "current" as const,
      currentMetadataUpdatedAt: now,
      lastMetadataCheckedAt: now,
      latest: quote,
      latestByCategory: {
        grid_trading: quote,
        yield_optimisation: {
          probedAt: now,
          probeCategory: "yield_optimisation" as const,
          outcome: "unreachable" as const,
          observedMetadataUpdatedAt: now,
          quoteNegotiatedAt: null,
          quoteExpiresAt: null,
          errorCode: "SELLER_TIMEOUT",
        },
      },
    } satisfies WorkerObservationTarget;

    expect(agentCardWithObservation(agent, target, true, now, undefined, "grid_trading").hireability)
      .toBe("hireable");
    expect(agentCardWithObservation(agent, target, true, now, undefined, "yield_optimisation").hireability)
      .toBe("listed_only");
  });

  it("does not present an old protocol response as current reachability", () => {
    const now = Date.parse(GENERATED_AT);
    const agent = toMarketplaceAgent(marketplaceData("qualified", "current"), { evaluateMarketplace: false });
    const card = agentCardWithObservation(agent, {
      agentId: agent.agentId,
      chainId: 56,
      transport: "a2a",
      endpoint: "https://seller.example/grid",
      name: agent.name,
      categories: ["grid_trading"],
      declarationState: "current",
      currentMetadataUpdatedAt: now - 24 * 60 * 60 * 1_000,
      lastMetadataCheckedAt: now,
      latest: {
        probedAt: now - 24 * 60 * 60 * 1_000,
        probeCategory: "grid_trading",
        outcome: "protocol_valid",
        observedMetadataUpdatedAt: now - 24 * 60 * 60 * 1_000,
        quoteNegotiatedAt: null,
        quoteExpiresAt: null,
        errorCode: null,
      },
      latestByCategory: {},
    }, true, now);

    expect(card.evidence.find(({ kind }) => kind === "reachable")).toMatchObject({
      status: "unknown",
      provenance: "observed",
    });
  });

  it("invalidates a quote negotiated before current metadata", () => {
    const now = Date.parse(GENERATED_AT);
    const agent = toMarketplaceAgent(marketplaceData("qualified", "current"), { evaluateMarketplace: false });
    const target = {
      agentId: agent.agentId,
      name: agent.name,
      categories: ["grid_trading"],
      declarationState: "current",
      currentMetadataUpdatedAt: now - 10_000,
      lastMetadataCheckedAt: now,
      latest: {
        probedAt: now,
        probeCategory: "grid_trading",
        outcome: "quote_verified",
        observedMetadataUpdatedAt: now - 20_000,
        quoteNegotiatedAt: now,
        quoteExpiresAt: now + 60_000,
        errorCode: null,
      },
      latestByCategory: {},
    } as unknown as WorkerObservationTarget;

    expect(agentCardWithObservation(agent, target, true, now).hireability).toBe("quote_stale");
  });

  it("uses quoteNegotiatedAt, not a recent probe timestamp, for the 60-second window", () => {
    const now = Date.parse(GENERATED_AT);
    const agent = toMarketplaceAgent(marketplaceData("qualified", "current"), { evaluateMarketplace: false });
    const target = {
      agentId: agent.agentId,
      name: agent.name,
      categories: ["grid_trading"],
      declarationState: "current",
      currentMetadataUpdatedAt: now - 120_000,
      lastMetadataCheckedAt: now,
      latest: {
        probedAt: now,
        probeCategory: "grid_trading",
        outcome: "quote_verified",
        observedMetadataUpdatedAt: now - 120_000,
        quoteNegotiatedAt: now - 60_001,
        quoteExpiresAt: now + 60_000,
        errorCode: null,
      },
      latestByCategory: {},
    } as unknown as WorkerObservationTarget;

    expect(agentCardWithObservation(agent, target, true, now).hireability).toBe("quote_stale");
  });

  it("selects multiple endpoint observations deterministically", () => {
    const now = Date.parse(GENERATED_AT);
    const agent = toMarketplaceAgent(marketplaceData("qualified", "current"), { evaluateMarketplace: false });
    const verified = {
      agentId: agent.agentId,
      name: agent.name,
      categories: ["grid_trading"],
      declarationState: "current",
      currentMetadataUpdatedAt: now,
      lastMetadataCheckedAt: now,
      latest: {
        probedAt: now,
        probeCategory: "grid_trading",
        outcome: "protocol_valid",
        observedMetadataUpdatedAt: now,
        quoteNegotiatedAt: null,
        quoteExpiresAt: null,
        errorCode: null,
      },
      latestByCategory: {},
    } as unknown as WorkerObservationTarget;
    const removed = {
      ...verified,
      endpoint: "https://old.example.com/grid",
      declarationState: "removed",
      latest: { ...verified.latest, probedAt: now + 1 },
    } as unknown as WorkerObservationTarget;

    expect(agentCardWithObservations(agent, [verified, removed], true, now))
      .toEqual(agentCardWithObservations(agent, [removed, verified], true, now));
    expect(agentCardWithObservations(agent, [verified, removed], true, now)
      .evidence.find(({ kind }) => kind === "reachable")?.status).toBe("verified");
  });

  it("prefers a current quote over an expired quote across endpoints", () => {
    const now = Date.parse(GENERATED_AT);
    const agent = toMarketplaceAgent(marketplaceData("qualified", "current"), { evaluateMarketplace: false });
    const target = (endpoint: string, quoteExpiresAt: number) => ({
      agentId: agent.agentId,
      chainId: 56 as const,
      transport: "a2a" as const,
      endpoint,
      name: agent.name,
      categories: ["grid_trading" as const],
      declarationState: "current" as const,
      currentMetadataUpdatedAt: now - 1_000,
      lastMetadataCheckedAt: now - 1,
      latest: {
        probedAt: now,
        probeCategory: "grid_trading" as const,
        outcome: "quote_verified" as const,
        observedMetadataUpdatedAt: now - 1_000,
        quoteNegotiatedAt: now,
        quoteExpiresAt,
        errorCode: null,
      },
      latestByCategory: {},
    });
    const expired = target("https://a.example.com/grid", now - 1);
    const current = target("https://z.example.com/grid", now + 60_000);

    expect(agentCardWithObservations(agent, [expired, current], true, now).hireability).toBe("hireable");
    expect(agentCardWithObservations(agent, [current, expired], true, now).hireability).toBe("hireable");
  });

  it("cannot enable Hire from an environment flag without current qualification", () => {
    process.env.ERC8183_MAINNET_DEMO_ENABLED = "true";
    try {
      expect(determineHireability(marketplaceData("not_qualified", "current"), Date.parse(GENERATED_AT))).toMatchObject({
        canHire: false,
        status: "protocol_discovered",
      });
      expect(determineHireability(marketplaceData("qualified", "stale"), Date.parse(GENERATED_AT))).toMatchObject({
        canHire: false,
        status: "quote_stale",
      });
      expect(determineHireability(marketplaceData("qualified", "current"), Date.parse(GENERATED_AT))).toMatchObject({
        canHire: true,
        status: "quote_verified",
        evidence: { source: "marketplace-readiness", observedAt: GENERATED_AT },
      });
      const explicit = marketplaceData("qualified", "current");
      explicit.verification!.selection = "operator_explicit";
      explicit.verification!.operator = "third_party";
      expect(determineHireability(explicit, Date.parse(GENERATED_AT))).toMatchObject({
        canHire: false,
        status: "protocol_discovered",
      });
    } finally {
      delete process.env.ERC8183_MAINNET_DEMO_ENABLED;
    }
  });

  it("keeps a reachable seller visible after the 60-second quote window expires", () => {
    const data = marketplaceData("qualified", "current");
    const result = determineHireability(data, Date.parse(GENERATED_AT) + 60_001);
    expect(result).toMatchObject({
      status: "quote_stale",
      canHire: false,
      evidence: { source: "marketplace-readiness", kind: "observed", observedAt: GENERATED_AT },
    });
    expect(result.reason).toContain("older than 60 seconds");
  });

  it("keeps the last qualified quote visible after the release snapshot expires", () => {
    const data = marketplaceData("qualified", "stale");
    const result = determineHireability(data, Date.parse(GENERATED_AT));
    expect(result).toMatchObject({
      status: "quote_stale",
      canHire: false,
      evidence: { source: "marketplace-readiness", kind: "observed" },
    });
    expect(result.reason).toContain("expired release snapshot");
  });

  it("does not expose Hire when the evaluated seller wallet maps to multiple Agent IDs", () => {
    const data = marketplaceData("qualified", "current");
    data.verification!.identity.walletAttribution = {
      status: "ambiguous",
      candidateCount: 2,
      candidateAgentIds: ["9001", "9002"],
      provenance: "derived:marketplace-readiness",
    };
    expect(determineHireability(data, Date.parse(GENERATED_AT))).toMatchObject({
      status: "wallet_ambiguous",
      canHire: false,
    });
  });

  it("preserves marketplace operation and qualification through sanitization and presentation", () => {
    const release = readinessInput("protocol_valid");
    const snapshot = sanitizeVerificationReport(verificationReportFromReleaseInput(release), {
      now: Date.parse(GENERATED_AT),
      marketplaceEvidence: marketplaceEvidenceFromReleaseInput(release),
    });
    expect(snapshot.agents[0]).toMatchObject({
      operator: "marketplace",
      qualification: {
        status: "qualified",
        observedAt: "2026-08-24T11:59:30.000Z",
        provenance: "derived:marketplace-seller-qualification",
      },
    });
    expect(snapshotAgentCardViewModel(snapshot.agents[0]!, snapshot, Date.parse(GENERATED_AT))).toMatchObject({
      operator: "marketplace",
      hireability: "hireable",
    });
    expect(snapshotAgentCardViewModel(
      snapshot.agents[0]!,
      snapshot,
      Date.parse(GENERATED_AT),
      snapshot.agents[0]!.agentId,
    )).toMatchObject({ passportState: "job_proven" });
  });

  it("preserves failed probe outcomes and never presents them as verified Reachable", () => {
    const release = readinessInput("timeout");
    const snapshot = sanitizeVerificationReport(verificationReportFromReleaseInput(release), {
      now: Date.parse(GENERATED_AT),
      marketplaceEvidence: marketplaceEvidenceFromReleaseInput(release),
    });
    expect(snapshot.agents[0]?.tools).toMatchObject({
      status: "observed",
      probeOutcomes: ["timeout"],
      reachability: "failed",
    });
    const reachable = snapshotAgentCardViewModel(snapshot.agents[0]!, snapshot, Date.parse(GENERATED_AT))
      .evidence.find(({ kind }) => kind === "reachable");
    expect(reachable).toMatchObject({ status: "unknown", provenance: "observed" });
    expect(reachable?.detail).toContain("timeout");

    const profileData = marketplaceData("not_qualified", "current");
    profileData.endpointObservation.status = "observed_ok";
    profileData.verification!.tools.reachability = "failed";
    profileData.verification!.tools.probeOutcomes = ["timeout"];
    const profileReachable = evidenceForAgent(toMarketplaceAgent(profileData, { evaluateMarketplace: false }))
      .find(({ kind }) => kind === "reachable");
    expect(profileReachable).toMatchObject({ status: "unknown", provenance: "observed" });
    expect(profileReachable?.detail).toContain("timeout");
  });

  it("rejects verification timestamps beyond the five-minute clock-skew allowance", () => {
    const report = verificationReport("protocol_valid");
    expect(() => sanitizeVerificationReport(report, {
      now: Date.parse(GENERATED_AT) - 5 * 60 * 1_000 - 1,
    })).toThrow(/too far in the future/);
    const snapshot = sanitizeVerificationReport(report, { now: Date.parse(GENERATED_AT) });
    expect(() => assertPublicVerificationSnapshotFresh(
      snapshot,
      Date.parse(GENERATED_AT) - 5 * 60 * 1_000 - 1,
    )).toThrow(/too far in the future/);
  });

  it("rejects missing or contradictory schema 2 provenance and probe fields", () => {
    const release = readinessInput("protocol_valid");
    const snapshot = sanitizeVerificationReport(verificationReportFromReleaseInput(release), {
      now: Date.parse(GENERATED_AT),
      marketplaceEvidence: marketplaceEvidenceFromReleaseInput(release),
    });
    expect(snapshot.schemaVersion).toBe(2);

    const missingOperator = structuredClone(snapshot) as unknown as { agents: Array<Record<string, unknown>> };
    delete missingOperator.agents[0]!.operator;
    expect(() => parsePublicVerificationSnapshot(missingOperator)).toThrow(/operator/);

    const contradiction = structuredClone(snapshot) as unknown as {
      agents: Array<{ tools: { status: string } }>;
    };
    contradiction.agents[0]!.tools.status = "not_probed";
    expect(() => parsePublicVerificationSnapshot(contradiction)).toThrow(/do not match probeOutcomes/);

    const identityContradiction = structuredClone(snapshot) as unknown as {
      agents: Array<{ identity: { status: string; mismatchFields: string[] } }>;
    };
    identityContradiction.agents[0]!.identity.status = "read_error";
    identityContradiction.agents[0]!.identity.mismatchFields = ["owner"];
    expect(() => parsePublicVerificationSnapshot(identityContradiction)).toThrow(/does not match identity.status/);

    const mixedProbe = structuredClone(snapshot) as unknown as {
      agents: Array<{ tools: { probeOutcomes: string[] } }>;
    };
    mixedProbe.agents[0]!.tools.probeOutcomes = ["protocol_valid", "not_probed"];
    expect(() => parsePublicVerificationSnapshot(mixedProbe)).toThrow(/cannot mix/);
  });

  it("does not render a stale protocol observation as current reachability", () => {
    const release = readinessInput("protocol_valid");
    const snapshot = sanitizeVerificationReport(verificationReportFromReleaseInput(release), {
      now: Date.parse(GENERATED_AT),
      marketplaceEvidence: marketplaceEvidenceFromReleaseInput(release),
    });
    const card = snapshotAgentCardViewModel(
      snapshot.agents[0]!,
      snapshot,
      Date.parse(snapshot.staleAfter) + 1,
    );
    expect(card.evidence.find(({ kind }) => kind === "reachable")).toMatchObject({
      status: "unknown",
      provenance: "observed",
    });
    expect(card.evidence.find(({ kind }) => kind === "reachable")?.detail).toContain("stale");
  });

  it("publishes read errors as unavailable identity attempts, never verified onchain provenance", () => {
    const release = readinessInput("protocol_valid");
    const report = verificationReportFromReleaseInput(release);
    report.agents[0]!.identity.status = "read_error";
    report.agents[0]!.identity.checks = { ownerMatches: null, metadataUriMatches: null };
    const snapshot = sanitizeVerificationReport(report, {
      now: Date.parse(GENERATED_AT),
      marketplaceEvidence: marketplaceEvidenceFromReleaseInput(release),
    });
    expect(snapshot.agents[0]?.identity).toMatchObject({
      status: "read_error",
      provenance: ["declared", "unavailable"],
    });
    expect(parsePublicVerificationSnapshot(snapshot).agents[0]?.identity.provenance)
      .toEqual(["declared", "unavailable"]);
  });
});
