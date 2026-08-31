import { describe, expect, it } from "vitest";
import type { MainnetJobProof } from "../src/business/entities/mainnet-job-proof.ts";
import type { MarketplaceAgent } from "../src/business/entities/marketplace-agent.ts";
import {
  buildEvidencePassport,
  type EvidencePassportInput,
} from "../src/business/policies/evidence-passport-policy.ts";
import { GetAgentEvidencePassport } from "../src/business/use-cases/get-agent-evidence-passport.ts";
import type { CatalogCandidate } from "../src/business/entities/catalog-candidate.ts";

const OBSERVED_AT = "2026-08-26T10:00:00.000Z";

function input(overrides: Partial<EvidencePassportInput> = {}): EvidencePassportInput {
  return {
    chainId: 56,
    agentId: "303779",
    name: "Marketplace Grid Planner",
    operator: "marketplace",
    indexedAt: OBSERVED_AT,
    onchainIdentity: {
      status: "match",
      observedAt: OBSERVED_AT,
      blockNumber: "118077255",
    },
    verification: null,
    hireability: {
      canHire: false,
      status: "not_evaluated",
      observedAt: OBSERVED_AT,
    },
    jobProofs: [],
    generatedAt: "2026-08-26T10:05:00.000Z",
    ...overrides,
  };
}

function proof(overrides: Partial<MainnetJobProof> = {}): MainnetJobProof {
  return {
    schemaVersion: 1,
    capturedAt: "2026-08-26T10:04:00.000Z",
    chainId: 56,
    agentId: "303779",
    jobId: "700",
    buyer: "0x1111111111111111111111111111111111111111",
    seller: "0x2222222222222222222222222222222222222222",
    token: "0x3333333333333333333333333333333333333333",
    budgetRaw: "1",
    finalState: "SUBMITTED",
    deliverableHash: `0x${"ab".repeat(32)}`,
    resultHashVerified: true,
    deterministicResultVerified: true,
    durationSeconds: "42",
    totalGasCostWei: "1234",
    transactions: {},
    ...overrides,
  };
}

describe("Evidence Passport policy", () => {
  it("keeps a directly registered but unprobed agent at Registered", () => {
    const passport = buildEvidencePassport(input());

    expect(passport.state).toBe("registered");
    expect(passport.checks.identity.status).toBe("verified");
    expect(passport.checks.endpoint.status).toBe("not_probed");
    expect(passport.nextRequirements).toContain("Run a bounded marketplace endpoint evaluation.");
  });

  it("requires current identity and endpoint observations for Evaluated", () => {
    const passport = buildEvidencePassport(input({
      verification: {
        freshness: "current",
        identityStatus: "match",
        endpointStatus: "verified",
        observedAt: OBSERVED_AT,
        staleAfter: "2026-08-29T10:00:00.000Z",
      },
    }));

    expect(passport.state).toBe("evaluated");
    expect(passport.checks.endpoint).toMatchObject({ status: "verified", provenance: "observed" });
    expect(passport.nextRequirements).toContain("Verify a current signed ERC-8183 quote.");
  });

  it("never promotes a declared seller protocol without a verified quote", () => {
    const passport = buildEvidencePassport(input({
      verification: {
        freshness: "current",
        identityStatus: "match",
        endpointStatus: "verified",
        observedAt: OBSERVED_AT,
        staleAfter: "2026-08-29T10:00:00.000Z",
      },
      hireability: {
        canHire: false,
        status: "protocol_discovered",
        observedAt: OBSERVED_AT,
      },
    }));

    expect(passport.state).toBe("evaluated");
    expect(passport.checks.quote.status).toBe("missing");
  });

  it("promotes a currently qualified seller to Hireable", () => {
    const passport = buildEvidencePassport(input({
      verification: {
        freshness: "current",
        identityStatus: "match",
        endpointStatus: "verified",
        observedAt: OBSERVED_AT,
        staleAfter: "2026-08-29T10:00:00.000Z",
      },
      hireability: {
        canHire: true,
        status: "quote_verified",
        observedAt: OBSERVED_AT,
      },
    }));

    expect(passport.state).toBe("hireable");
    expect(passport.checks.quote.status).toBe("verified");
    expect(passport.nextRequirements).toContain("Complete and verify an ERC-8183 job on BSC.");
  });

  it("treats a verified seller quote as an observed seller endpoint without inventing MCP evidence", () => {
    const passport = buildEvidencePassport(input({
      verification: {
        freshness: "current",
        identityStatus: "match",
        endpointStatus: "not_probed",
        observedAt: OBSERVED_AT,
        staleAfter: "2026-08-29T10:00:00.000Z",
      },
      hireability: {
        canHire: true,
        status: "quote_verified",
        observedAt: "2026-08-26T10:01:00.000Z",
      },
    }));

    expect(passport.state).toBe("hireable");
    expect(passport.checks.endpoint).toMatchObject({
      status: "verified",
      provenance: "observed",
      observedAt: "2026-08-26T10:01:00.000Z",
    });
    expect(passport.checks.endpoint.detail).toContain("seller endpoint");
  });

  it("records an ad-hoc verified quote without auto-promoting the agent", () => {
    const passport = buildEvidencePassport(input({
      verification: {
        freshness: "current",
        identityStatus: "match",
        endpointStatus: "verified",
        observedAt: OBSERVED_AT,
        staleAfter: "2026-08-29T10:00:00.000Z",
      },
      hireability: {
        canHire: false,
        status: "quote_verified",
        observedAt: OBSERVED_AT,
      },
    }));

    expect(passport.state).toBe("evaluated");
    expect(passport.checks.quote.status).toBe("verified");
    expect(passport.nextRequirements).toContain("Submit this evidence snapshot for marketplace promotion review.");
  });

  it("promotes only a matching hash-verified Mainnet job to Job Proven", () => {
    const matching = buildEvidencePassport(input({
      verification: {
        freshness: "current",
        identityStatus: "match",
        endpointStatus: "verified",
        observedAt: OBSERVED_AT,
        staleAfter: "2026-08-29T10:00:00.000Z",
      },
      hireability: { canHire: true, status: "quote_verified", observedAt: OBSERVED_AT },
      jobProofs: [proof()],
    }));
    const otherAgent = buildEvidencePassport(input({ jobProofs: [proof({ agentId: "999" })] }));

    expect(matching.state).toBe("job_proven");
    expect(matching.trackRecord).toMatchObject({ provenJobs: 1, sampleSize: 1, latestJobId: "700" });
    expect(matching.checks.job.status).toBe("verified");
    expect(otherAgent.state).toBe("registered");
    expect(otherAgent.trackRecord.provenJobs).toBe(0);
  });

  it("uses Attention as an honest override for stale or mismatched evidence", () => {
    const stale = buildEvidencePassport(input({
      verification: {
        freshness: "stale",
        identityStatus: "match",
        endpointStatus: "verified",
        observedAt: OBSERVED_AT,
        staleAfter: "2026-08-25T10:00:00.000Z",
      },
      hireability: { canHire: true, status: "quote_verified", observedAt: OBSERVED_AT },
    }));
    const mismatch = buildEvidencePassport(input({
      onchainIdentity: { status: "mismatch", observedAt: OBSERVED_AT, blockNumber: "118077255" },
    }));

    expect(stale.state).toBe("attention");
    expect(stale.attentionReasons).toContain("Verification evidence is stale.");
    expect(stale.checks.quote.status).toBe("stale");
    expect(mismatch.state).toBe("attention");
    expect(mismatch.attentionReasons).toContain("Indexed identity does not match the direct BSC read.");
  });

  it("produces a deterministic evidence fingerprint and changes it when evidence changes", () => {
    const first = buildEvidencePassport(input({ generatedAt: "2026-08-26T10:05:00.000Z" }));
    const rerendered = buildEvidencePassport(input({ generatedAt: "2026-08-26T11:05:00.000Z" }));
    const changed = buildEvidencePassport(input({
      generatedAt: "2026-08-26T11:05:00.000Z",
      onchainIdentity: { status: "mismatch", observedAt: OBSERVED_AT, blockNumber: "118077255" },
    }));

    expect(first.evidenceSnapshotHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(rerendered.evidenceSnapshotHash).toBe(first.evidenceSnapshotHash);
    expect(changed.evidenceSnapshotHash).not.toBe(first.evidenceSnapshotHash);
  });

  it.each<[string, Partial<MainnetJobProof>]>([
    ["buyer", { buyer: "0x4444444444444444444444444444444444444444" }],
    ["token", { token: "0x5555555555555555555555555555555555555555" }],
    ["budget", { budgetRaw: "2" }],
    ["duration", { durationSeconds: "43" }],
    ["gas cost", { totalGasCostWei: "1235" }],
    ["transaction", { transactions: {
      fund: {
        hash: `0x${"cd".repeat(32)}`,
        blockNumber: "118077256",
        timestamp: OBSERVED_AT,
        gasUsed: "1",
        effectiveGasPrice: "2",
        gasCostWei: "2",
        explorerUrl: "https://bscscan.com/tx/example",
        provenance: "onchain:bsc-mainnet-rpc" as const,
      },
    } }],
  ])("commits the job %s claim into the fingerprint", (_label, changedProof) => {
    const baseline = buildEvidencePassport(input({ jobProofs: [proof()] }));
    const changed = buildEvidencePassport(input({ jobProofs: [proof(changedProof)] }));
    expect(changed.evidenceSnapshotHash).not.toBe(baseline.evidenceSnapshotHash);
  });

  it("deduplicates identical job proofs and rejects conflicting copies", () => {
    const single = buildEvidencePassport(input({ jobProofs: [proof()] }));
    const duplicate = buildEvidencePassport(input({ jobProofs: [proof(), proof()] }));

    expect(duplicate.trackRecord.provenJobs).toBe(1);
    expect(duplicate.evidenceSnapshotHash).toBe(single.evidenceSnapshotHash);
    expect(() => buildEvidencePassport(input({
      jobProofs: [proof(), proof({ budgetRaw: "2" })],
    }))).toThrow("conflicting");
  });

  it("orders equal-timestamp proofs deterministically", () => {
    const first = proof({ jobId: "700" });
    const second = proof({ jobId: "701" });
    const forward = buildEvidencePassport(input({ jobProofs: [first, second] }));
    const reversed = buildEvidencePassport(input({ jobProofs: [second, first] }));

    expect(reversed.evidenceSnapshotHash).toBe(forward.evidenceSnapshotHash);
    expect(reversed.trackRecord.latestJobId).toBe(forward.trackRecord.latestJobId);
  });

  it("marks a completed but failed endpoint evaluation as Attention", () => {
    const passport = buildEvidencePassport(input({
      verification: {
        freshness: "current",
        identityStatus: "match",
        endpointStatus: "failed",
        observedAt: OBSERVED_AT,
        staleAfter: "2026-08-29T10:00:00.000Z",
      },
    }));

    expect(passport.state).toBe("attention");
    expect(passport.attentionReasons).toContain("The bounded endpoint evaluation failed.");
  });
});

describe("GetAgentEvidencePassport", () => {
  it("builds the indexed Passport from a fresh bridged marketplace quote", async () => {
    const now = Date.parse("2026-08-31T10:29:00.000Z");
    const agent = {
      chainId: 56,
      agentId: "303779",
      name: "Marketplace Grid Planner",
      operator: "marketplace",
      freshness: { fetchedAt: OBSERVED_AT },
      onchainIdentity: { status: "match", observedAt: OBSERVED_AT, blockNumber: "118077255" },
    } as unknown as MarketplaceAgent;
    const candidate: CatalogCandidate = {
      agentKey: "eip155:56:303779", agentId: "303779", chainId: 56,
      owner: null, metadataUri: null,
      name: "Marketplace Grid Planner", description: null, imageUrl: null,
      categories: ["grid_trading"], marketplaceConfigured: true, metadataState: "ok",
      registeredAt: null, blockNumber: null, priority: 100,
      state: {
        operationalStatus: "platform_reachable",
        freshness: "live",
        commerceStatus: "admitted",
        quoteStatus: "verified_fresh",
        buyerAction: "prepare_hire",
        canRequestBrowserValidation: true,
        canRequestInfrastructureValidation: true,
        canRequestQuote: true,
        canPrepareHire: true,
        blockingReasons: [],
      },
      declarations: [{ endpointKey: "a".repeat(64), protocol: "a2a", endpoint: "https://seller.example/a2a",
        originKey: "b".repeat(64), safety: "safe", safetyReason: null, representativeAgentKey: null,
        lastProbedAt: now, nextProbeAt: now + 900_000, consecutiveFailures: 0, priority: 100 }],
      observations: [{ id: 7, agentKey: "eip155:56:303779", endpointKey: null,
        protocol: "a2a", source: "marketplace_probe", outcome: "quote_verified",
        observedAt: now - 60_000, expiresAt: now + 840_000, httpStatus: null,
        errorCode: null, durationMs: 20, details: { legacyObservationId: 7 } }],
    };

    const passport = await new GetAgentEvidencePassport(
      { execute: async () => agent },
      { listByAgentId: () => [] },
      () => now,
      { execute: async () => candidate },
    ).execute({ agentId: "303779" });

    expect(passport.state).toBe("hireable");
    expect(passport.checks.endpoint).toMatchObject({ status: "verified", provenance: "observed" });
    expect(passport.checks.quote).toMatchObject({
      status: "verified",
      provenance: "observed",
      hireabilityStatus: "quote_verified",
    });
  });

  it("fails closed when only the legacy marketplace flag is present", async () => {
    const now = Date.parse("2026-08-31T10:29:00.000Z");
    const agent = {
      chainId: 56,
      agentId: "303779",
      name: "Marketplace Grid Planner",
      operator: "marketplace",
      freshness: { fetchedAt: OBSERVED_AT },
      onchainIdentity: { status: "match", observedAt: OBSERVED_AT, blockNumber: "118077255" },
    } as unknown as MarketplaceAgent;
    const candidate: CatalogCandidate = {
      agentKey: "eip155:56:303779", agentId: "303779", chainId: 56,
      owner: null, metadataUri: null,
      name: "Marketplace Grid Planner", description: null, imageUrl: null,
      categories: ["grid_trading"], marketplaceConfigured: true, metadataState: "ok",
      registeredAt: null, blockNumber: null, priority: 100,
      declarations: [{ endpointKey: "a".repeat(64), protocol: "a2a", endpoint: "https://seller.example/a2a",
        originKey: "b".repeat(64), safety: "safe", safetyReason: null, representativeAgentKey: null,
        lastProbedAt: now, nextProbeAt: now + 900_000, consecutiveFailures: 0, priority: 100 }],
      observations: [{ id: 8, agentKey: "eip155:56:303779", endpointKey: null,
        protocol: "a2a", source: "marketplace_probe", outcome: "quote_verified",
        observedAt: now - 60_000, expiresAt: now + 840_000, httpStatus: null,
        errorCode: null, durationMs: 20, details: { legacyObservationId: 8 } }],
    };

    const passport = await new GetAgentEvidencePassport(
      { execute: async () => agent },
      { listByAgentId: () => [] },
      () => now,
      { execute: async () => candidate },
    ).execute({ agentId: "303779" });

    expect(passport.state).toBe("evaluated");
    expect(passport.checks.quote.status).toBe("verified");
  });

  it("does not treat quote eligibility as hireability before a quote is verified", async () => {
    const now = Date.parse("2026-08-31T10:29:00.000Z");
    const agent = {
      chainId: 56,
      agentId: "303779",
      name: "Marketplace Grid Planner",
      operator: "marketplace",
      freshness: { fetchedAt: OBSERVED_AT },
      onchainIdentity: { status: "match", observedAt: OBSERVED_AT, blockNumber: "118077255" },
    } as unknown as MarketplaceAgent;
    const candidate: CatalogCandidate = {
      agentKey: "eip155:56:303779", agentId: "303779", chainId: 56,
      owner: null, metadataUri: null, name: "Marketplace Grid Planner", description: null, imageUrl: null,
      categories: ["grid_trading"], marketplaceConfigured: true, metadataState: "ok",
      registeredAt: null, blockNumber: null, priority: 100,
      state: {
        operationalStatus: "platform_reachable", freshness: "live", commerceStatus: "admitted",
        quoteStatus: "not_requested", buyerAction: "request_quote", canRequestBrowserValidation: true,
        canRequestInfrastructureValidation: true, canRequestQuote: true, canPrepareHire: false,
        blockingReasons: ["QUOTE_NOT_VERIFIED"],
      },
      declarations: [],
      observations: [],
    };

    const passport = await new GetAgentEvidencePassport(
      { execute: async () => agent },
      { listByAgentId: () => [] },
      () => now,
      { execute: async () => candidate },
    ).execute({ agentId: "303779" });

    expect(passport).toMatchObject({
      state: "registered",
      checks: { quote: { status: "missing", hireabilityStatus: "not_evaluated" } },
    });
  });

  it("scopes endpoint status to the admitted commerce declaration", async () => {
    const now = Date.parse("2026-08-31T10:29:00.000Z");
    const agent = {
      chainId: 56,
      agentId: "303779",
      name: "Marketplace Grid Planner",
      operator: "marketplace",
      freshness: { fetchedAt: OBSERVED_AT },
      onchainIdentity: { status: "match", observedAt: OBSERVED_AT, blockNumber: "118077255" },
    } as unknown as MarketplaceAgent;
    const admittedEndpoint = "a".repeat(64);
    const otherEndpoint = "b".repeat(64);
    const candidate: CatalogCandidate = {
      agentKey: "eip155:56:303779", agentId: "303779", chainId: 56,
      owner: null, metadataUri: null, name: "Marketplace Grid Planner", description: null, imageUrl: null,
      categories: ["grid_trading"], marketplaceConfigured: true, metadataState: "ok",
      registeredAt: null, blockNumber: null, priority: 100,
      admission: { state: "admitted", endpointKey: admittedEndpoint },
      state: {
        operationalStatus: "platform_reachable", freshness: "live", commerceStatus: "admitted",
        quoteStatus: "not_requested", buyerAction: "request_quote", canRequestBrowserValidation: true,
        canRequestInfrastructureValidation: true, canRequestQuote: true, canPrepareHire: false,
        blockingReasons: ["FRESH_QUOTE_REQUIRED"],
      },
      declarations: [
        { endpointKey: admittedEndpoint, protocol: "a2a", endpoint: "https://seller.example/a2a", originKey: null,
          safety: "safe", safetyReason: null, representativeAgentKey: null, lastProbedAt: now,
          nextProbeAt: now + 900_000, consecutiveFailures: 0, priority: 100 },
        { endpointKey: otherEndpoint, protocol: "mcp", endpoint: "https://seller.example/mcp", originKey: null,
          safety: "safe", safetyReason: null, representativeAgentKey: null, lastProbedAt: now,
          nextProbeAt: now + 900_000, consecutiveFailures: 0, priority: 90 },
      ],
      observations: [
        { id: 1, agentKey: "eip155:56:303779", endpointKey: admittedEndpoint, protocol: "a2a", source: "worker_probe",
          outcome: "protocol_valid", observedAt: now - 10_000, expiresAt: now + 900_000, httpStatus: 200,
          errorCode: null, durationMs: 10, details: {}, validationKind: "protocol", verificationLevel: "platform_observed" },
        { id: 2, agentKey: "eip155:56:303779", endpointKey: otherEndpoint, protocol: "mcp", source: "worker_probe",
          outcome: "network_error", observedAt: now, expiresAt: null, httpStatus: null,
          errorCode: "CATALOG_NETWORK_ERROR", durationMs: 10, details: {}, validationKind: "protocol", verificationLevel: "platform_observed" },
      ],
    };

    const passport = await new GetAgentEvidencePassport(
      { execute: async () => agent },
      { listByAgentId: () => [] },
      () => now,
      { execute: async () => candidate },
    ).execute({ agentId: "303779" });

    expect(passport.checks.endpoint).toMatchObject({ status: "verified", provenance: "observed" });
  });

  it("uses a cryptographically verified browser quote as scoped evidence", async () => {
    const now = Date.parse("2026-08-31T10:29:00.000Z");
    const agent = {
      chainId: 56,
      agentId: "303779",
      name: "Marketplace Grid Planner",
      operator: "marketplace",
      freshness: { fetchedAt: OBSERVED_AT },
      onchainIdentity: { status: "match", observedAt: OBSERVED_AT, blockNumber: "118077255" },
    } as unknown as MarketplaceAgent;
    const candidate: CatalogCandidate = {
      agentKey: "eip155:56:303779", agentId: "303779", chainId: 56,
      owner: null, metadataUri: null, name: "Marketplace Grid Planner", description: null, imageUrl: null,
      categories: ["grid_trading"], marketplaceConfigured: false, metadataState: "ok",
      registeredAt: null, blockNumber: null, priority: 100,
      state: {
        operationalStatus: "pending", freshness: "never", commerceStatus: "admitted",
        quoteStatus: "verified_fresh", buyerAction: "prepare_hire", canRequestBrowserValidation: true,
        canRequestInfrastructureValidation: true, canRequestQuote: true, canPrepareHire: true,
        blockingReasons: [],
      },
      declarations: [{ endpointKey: "a".repeat(64), protocol: "a2a", endpoint: "https://seller.example/a2a",
        originKey: "b".repeat(64), safety: "safe", safetyReason: null, representativeAgentKey: null,
        lastProbedAt: now, nextProbeAt: now + 900_000, consecutiveFailures: 0, priority: 100 }],
      observations: [{ id: 9, agentKey: "eip155:56:303779", endpointKey: "a".repeat(64), protocol: "a2a",
        source: "browser_reported", outcome: "quote_verified", observedAt: now - 60_000,
        expiresAt: now + 840_000, httpStatus: 200, errorCode: null, durationMs: 20, details: {},
        validationKind: "quote", verificationLevel: "cryptographic", artifactHash: "f".repeat(64) }],
    };

    const passport = await new GetAgentEvidencePassport(
      { execute: async () => agent },
      { listByAgentId: () => [] },
      () => now,
      { execute: async () => candidate },
    ).execute({ agentId: "303779" });

    expect(passport.checks.quote).toMatchObject({ status: "verified", hireabilityStatus: "quote_verified" });
    expect(passport.checks.endpoint.status).toBe("verified");
  });

  it("does not turn release-snapshot qualification into current indexed Passport claims", async () => {
    const agent = {
      chainId: 56,
      agentId: "303779",
      name: "Marketplace Grid Planner",
      operator: "marketplace",
      freshness: { fetchedAt: OBSERVED_AT },
      onchainIdentity: { status: "match", observedAt: OBSERVED_AT, blockNumber: "118077255" },
      verification: {
        freshness: "current",
        staleAfter: "2026-08-29T10:00:00.000Z",
        generatedAt: OBSERVED_AT,
        identity: { status: "match" },
        tools: { reachability: "verified", observedAt: OBSERVED_AT },
      },
      hireability: {
        canHire: true,
        status: "quote_verified",
        evidence: { observedAt: OBSERVED_AT },
      },
    } as unknown as MarketplaceAgent;

    const passport = await new GetAgentEvidencePassport(
      { execute: async () => agent },
      { listByAgentId: () => [] },
      () => Date.parse("2026-08-26T10:05:00.000Z"),
    ).execute({ agentId: "303779" });

    expect(passport.state).toBe("registered");
    expect(passport.checks.endpoint.status).toBe("not_probed");
    expect(passport.checks.quote.status).toBe("missing");
  });

  it("composes the live profile and only the matching Mainnet proof", async () => {
    const agent = {
      chainId: 56,
      agentId: "303779",
      name: "Marketplace Grid Planner",
      operator: "marketplace",
      freshness: { fetchedAt: OBSERVED_AT },
      onchainIdentity: {
        status: "match",
        observedAt: OBSERVED_AT,
        blockNumber: "118077255",
      },
      verification: {
        freshness: "current",
        staleAfter: "2026-08-29T10:00:00.000Z",
        generatedAt: OBSERVED_AT,
        identity: { status: "match" },
        tools: { reachability: "verified", observedAt: OBSERVED_AT },
      },
      hireability: {
        canHire: true,
        status: "quote_verified",
        evidence: { observedAt: OBSERVED_AT },
      },
    } as unknown as MarketplaceAgent;
    const getAgent = { execute: async () => agent };
    const getProof = { listByAgentId: () => [proof()] };

    const passport = await new GetAgentEvidencePassport(
      getAgent,
      getProof,
      () => Date.parse("2026-08-26T10:05:00.000Z"),
    ).execute({ agentId: "303779" });

    expect(passport).toMatchObject({
      agentId: "303779",
      state: "job_proven",
      trackRecord: { provenJobs: 1, latestJobId: "700" },
    });
  });

  it("returns profile and Passport from one agent read for the profile page", async () => {
    const agent = {
      chainId: 56,
      agentId: "303779",
      name: "Marketplace Grid Planner",
      operator: "marketplace",
      freshness: { fetchedAt: OBSERVED_AT },
      onchainIdentity: { status: "match", observedAt: OBSERVED_AT, blockNumber: "118077255" },
      verification: null,
      hireability: {
        canHire: false,
        status: "not_evaluated",
        evidence: { observedAt: OBSERVED_AT },
      },
    } as unknown as MarketplaceAgent;
    let reads = 0;
    const useCase = new GetAgentEvidencePassport(
      { execute: async () => { reads += 1; return agent; } },
      { listByAgentId: () => [] },
      () => Date.parse("2026-08-26T10:05:00.000Z"),
    );

    const result = await useCase.executeWithAgent({ agentId: "303779" });

    expect(reads).toBe(1);
    expect(result.agent).toBe(agent);
    expect(result.passport).toMatchObject({ agentId: "303779", state: "registered" });
  });

  it("loads all persisted proofs for the requested agent", async () => {
    const agent = {
      chainId: 56,
      agentId: "303779",
      name: "Marketplace Grid Planner",
      operator: "marketplace",
      freshness: { fetchedAt: OBSERVED_AT },
      onchainIdentity: { status: "match", observedAt: OBSERVED_AT, blockNumber: "118077255" },
      verification: null,
      hireability: { canHire: false, status: "not_evaluated", evidence: { observedAt: OBSERVED_AT } },
    } as unknown as MarketplaceAgent;
    const proofs = [proof({ jobId: "700" }), proof({ jobId: "701", capturedAt: "2026-08-26T10:06:00.000Z" })];
    const useCase = new GetAgentEvidencePassport(
      { execute: async () => agent },
      { listByAgentId: (agentId: string) => proofs.filter((item) => item.agentId === agentId) },
    );

    const passport = await useCase.execute({ agentId: "303779" });
    expect(passport.trackRecord).toMatchObject({ provenJobs: 2, sampleSize: 2, latestJobId: "701" });
  });
});
