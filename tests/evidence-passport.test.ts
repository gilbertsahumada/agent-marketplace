import { describe, expect, it } from "vitest";
import type { MainnetJobProof } from "../src/business/entities/mainnet-job-proof.js";
import type { MarketplaceAgent } from "../src/business/entities/marketplace-agent.js";
import {
  buildEvidencePassport,
  type EvidencePassportInput,
} from "../src/business/policies/evidence-passport-policy.js";
import { GetAgentEvidencePassport } from "../src/business/use-cases/get-agent-evidence-passport.js";

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
});

describe("GetAgentEvidencePassport", () => {
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
    const getProof = { execute: () => proof() };

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
      { execute: () => null },
      () => Date.parse("2026-08-26T10:05:00.000Z"),
    );

    const result = await useCase.executeWithAgent({ agentId: "303779" });

    expect(reads).toBe(1);
    expect(result.agent).toBe(agent);
    expect(result.passport).toMatchObject({ agentId: "303779", state: "registered" });
  });
});
