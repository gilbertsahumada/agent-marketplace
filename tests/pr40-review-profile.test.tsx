// @vitest-environment happy-dom
// PR #40 review validation: desired behavior of AgentProfile hireability badge,
// entity-reason feed-down, and quote-on-request prose.
import "@testing-library/jest-dom/vitest";
import { createElement, type AnchorHTMLAttributes } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfile } from "../components/marketplace/agent-profile.tsx";
import type { EvidenceRecord, MarketplaceAgent } from "../src/business/entities/marketplace-agent.ts";
import type { AgentEvidencePassport } from "../src/business/entities/evidence-passport.ts";
import type { WorkerObservation, WorkerObservationTarget } from "../src/business/entities/worker-observations.ts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/agents",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const { createElement: createMockElement } = await import("react");
  return {
    default: ({ prefetch, ...anchorProps }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) =>
      createMockElement("a", { ...anchorProps, "data-prefetch": String(prefetch) }),
  };
});

function evidenceRecord(kind: EvidenceRecord["kind"], note: string): EvidenceRecord {
  return {
    kind,
    source: kind === "derived" ? "marketplace-inventory" : "trust8004-public-api",
    observedAt: "2026-08-17T00:00:00.000Z",
    verifiedDirectly: false,
    note,
  };
}

function marketplaceAgent(): MarketplaceAgent {
  return {
    chainId: 56,
    agentId: "45650",
    name: "V3 Pools powered by HeyAnon",
    description: "Sanitized candidate",
    owner: "0x1111111111111111111111111111111111111111",
    metadataUri: "ipfs://sanitized/45650",
    operator: "third_party",
    indexedIdentity: {
      owner: "0x1111111111111111111111111111111111111111",
      metadataUri: "ipfs://sanitized/45650",
      evidence: evidenceRecord("onchain", "Indexed identity."),
    },
    onchainIdentity: {
      status: "not_requested",
      owner: null,
      agentWallet: null,
      metadataUri: null,
      registryAddress: null,
      blockNumber: null,
      observedAt: null,
      checks: { ownerMatches: null, metadataUriMatches: null },
      error: null,
      evidence: null,
    },
    categoryEvaluation: "evaluated",
    categories: [{
      category: "rebalancing",
      evidence: evidenceRecord("derived", "Curated liquidity-management signal. Candidate mapping is not proof of operational capability."),
    }],
    services: [],
    endpoints: [],
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
    reputation: { totalFeedbacks: 2, averageScore: 80, uniqueReviewers: 2 },
    trustScore: { total: 70, tier: "Silver", dimensions: {}, calculatedAt: null, expiresAt: null },
    hireability: {
      status: "no_transport_declared",
      canHire: false,
      reason: "No verified seller.",
      evidence: evidenceRecord("derived", "No compatible seller transport is declared."),
    },
    freshness: {
      fetchedAt: "2026-08-17T00:00:00.000Z",
      metadataUpdatedAt: null,
      indexedUpdatedAt: "2026-08-17T00:00:00.000Z",
    },
    catalogCoverage: "partial",
    provenance: {
      identity: evidenceRecord("onchain", "Indexed identity."),
      services: evidenceRecord("declared", "Declared services."),
      endpointObservation: evidenceRecord("observed", "No persisted observation."),
      reputation: evidenceRecord("onchain", "Indexed reputation; not re-read directly from BSC."),
      trustScore: evidenceRecord("derived", "Calculated by trust8004."),
    },
  };
}

function evidencePassport(state: AgentEvidencePassport["state"]): AgentEvidencePassport {
  const verified = { status: "verified" as const, provenance: "onchain" as const, observedAt: "2026-08-26T10:00:00.000Z", detail: "Verified directly." };
  return {
    schemaVersion: 1,
    chainId: 56,
    agentId: "303779",
    name: "Marketplace Grid Planner",
    operator: "marketplace",
    state,
    evidenceSnapshotHash: `0x${"ab".repeat(32)}`,
    generatedAt: "2026-08-26T10:05:00.000Z",
    attentionReasons: state === "attention" ? ["Verification evidence is stale."] : [],
    checks: {
      identity: verified,
      endpoint: state === "registered" ? { status: "not_probed", provenance: "not_probed", observedAt: null, detail: "Not probed." } : { ...verified, provenance: "observed" },
      quote: { ...(state === "hireable" || state === "job_proven" ? { ...verified, provenance: "observed" as const } : { status: "missing" as const, provenance: "derived" as const, observedAt: null, detail: "No current quote." }), hireabilityStatus: state === "hireable" || state === "job_proven" ? "quote_verified" : "not_evaluated" },
      job: state === "job_proven" ? verified : { status: "missing", provenance: "onchain", observedAt: null, detail: "No proven job." },
      hireActivity: { status: "missing", provenance: "onchain", observedAt: null, detail: "No chain-verified hire activity is linked to this agent." },
    },
    trackRecord: {
      provenJobs: state === "job_proven" ? 1 : 0,
      sampleSize: state === "job_proven" ? 1 : 0,
      submittedJobs: state === "job_proven" ? 1 : 0,
      completedJobs: 0,
      latestJobId: state === "job_proven" ? "700" : null,
      latestCapturedAt: state === "job_proven" ? "2026-08-26T10:04:00.000Z" : null,
      latestDurationSeconds: state === "job_proven" ? "42" : null,
      latestGasCostWei: state === "job_proven" ? "1234" : null,
    },
    nextRequirements: state === "registered" ? ["Run a bounded marketplace endpoint evaluation."] : [],
  };
}

function observation(overrides: Partial<WorkerObservation> = {}): WorkerObservation {
  return {
    probedAt: Date.now() - 5_000,
    probeCategory: null,
    outcome: "protocol_valid",
    quoteExpiresAt: null,
    observedMetadataUpdatedAt: null,
    quoteNegotiatedAt: null,
    errorCode: null,
    ...overrides,
  };
}

function observationTarget(overrides: Partial<WorkerObservationTarget> = {}): WorkerObservationTarget {
  return {
    agentId: "45650",
    chainId: 56,
    transport: "a2a",
    endpoint: "https://seller.example",
    name: "A2A",
    categories: ["rebalancing"],
    declarationState: "current",
    currentMetadataUpdatedAt: null,
    lastMetadataCheckedAt: Date.now(),
    latest: null,
    latestByCategory: {},
    ...overrides,
  };
}

// Quote-current per view-models.ts agentCardWithObservation: declarationState "current",
// outcome "quote_verified", probedAt within 60s, metadata reconciled, quoteNegotiatedAt
// within 60s, quoteExpiresAt in the future.
function quoteCurrentTarget(): WorkerObservationTarget {
  const now = Date.now();
  return observationTarget({
    latest: observation({
      probedAt: now - 5_000,
      outcome: "quote_verified",
      quoteNegotiatedAt: now - 5_000,
      quoteExpiresAt: now + 600_000,
    }),
  });
}

function quoteStaleTarget(): WorkerObservationTarget {
  const now = Date.now();
  return observationTarget({
    latest: observation({
      probedAt: now - 5_000,
      outcome: "quote_verified",
      quoteNegotiatedAt: now - 300_000, // negotiated 5 minutes ago — outside the 60s window
      quoteExpiresAt: now - 200_000,
    }),
  });
}

function quoteRequestableAgent(): MarketplaceAgent {
  const agent = marketplaceAgent();
  agent.operator = "marketplace";
  agent.services = [{ name: "A2A", endpoint: "https://seller.example", version: null, tools: [], capabilities: [] }];
  agent.endpoints = [{ name: "A2A", endpoint: "https://seller.example" }];
  return agent;
}

afterEach(() => {
  cleanup();
});

describe("PR #40 review findings — AgentProfile", () => {
  it("T1: shows Quote on request when quote requests are available but no observation is quote-current", () => {
    render(createElement(AgentProfile, {
      agent: quoteRequestableAgent(),
      observationTargets: [observationTarget({ latest: observation({ outcome: "protocol_valid" }) })],
      observationsAvailable: true,
      passport: evidencePassport("registered"),
    }));

    // Sanity: quoteRequestAvailable really is true — the hire CTA renders.
    expect(screen.getByRole("link", { name: /hire agent/i })).toHaveAttribute("href", "/hire/45650");

    expect(screen.getByText("Quote on request")).toBeInTheDocument();
    expect(screen.queryByText("Not hireable")).not.toBeInTheDocument();
    expect(screen.queryByText("Not evaluated")).not.toBeInTheDocument();
  });

  it("T2: does not render the contradicting entity reason next to a Hireable now observation badge", () => {
    const agent = marketplaceAgent();
    agent.hireability = {
      status: "protocol_discovered",
      canHire: false,
      reason: "A seller protocol is declared, but no signed ERC-8183 quote is verified in this catalogue record.",
      evidence: evidenceRecord("derived", "Protocol discovered."),
    };

    render(createElement(AgentProfile, {
      agent,
      observationTargets: [quoteCurrentTarget()],
      observationsAvailable: true,
      passport: evidencePassport("evaluated"),
    }));

    expect(screen.getByText("Hireable now")).toBeInTheDocument();
    expect(screen.queryByText("A seller protocol is declared, but no signed ERC-8183 quote is verified in this catalogue record.")).not.toBeInTheDocument();
  });

  it("T3: labels a historically verified but no-longer-current quote as Quote expired", () => {
    render(createElement(AgentProfile, {
      agent: marketplaceAgent(),
      observationTargets: [quoteStaleTarget()],
      observationsAvailable: true,
      passport: evidencePassport("evaluated"),
    }));

    expect(screen.getByText("Quote expired")).toBeInTheDocument();
  });

  it("T4: explains the Quote on request state with the agreed prose", () => {
    render(createElement(AgentProfile, {
      agent: quoteRequestableAgent(),
      observationTargets: [observationTarget({ latest: observation({ outcome: "protocol_valid" }) })],
      observationsAvailable: true,
      passport: evidencePassport("registered"),
    }));

    expect(screen.getByText("No current verified quote is held. Continuing requests a fresh ERC-8183 quote that is verified before any wallet interaction.")).toBeInTheDocument();
  });

  it("T5: keeps the structural no-seller reason visible when no observations exist (regression pin)", () => {
    render(createElement(AgentProfile, {
      agent: marketplaceAgent(),
      passport: evidencePassport("registered"),
    }));

    expect(screen.getByText("No verified seller.")).toBeInTheDocument();
  });
});
