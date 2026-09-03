// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement, type AnchorHTMLAttributes } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCard } from "../components/marketplace/agent-card.tsx";
import { ComparePage } from "../components/marketplace/compare-page.tsx";
import type { EvidenceRecord, MarketplaceAgent } from "../src/business/entities/marketplace-agent.ts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/compare",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const { createElement: createMockElement } = await import("react");
  return {
    default: ({ prefetch, ...anchorProps }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) =>
      createMockElement("a", { ...anchorProps, "data-prefetch": String(prefetch) }),
  };
});

const evidence = [
  { kind: "declared" as const, label: "Declared", status: "verified" as const, provenance: "declared" as const, detail: "Declared" },
  { kind: "reachable" as const, label: "Reachable", status: "unknown" as const, provenance: "observed" as const, detail: "Unknown" },
  { kind: "quote" as const, label: "Quote verified", status: "unknown" as const, provenance: "derived" as const, detail: "Unknown" },
  { kind: "job" as const, label: "Job proven", status: "unknown" as const, provenance: "onchain" as const, detail: "Unknown" },
];

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

function renderCompare(first: MarketplaceAgent, second: MarketplaceAgent) {
  return render(createElement(ComparePage, {
    candidates: [
      { agentId: first.agentId, name: first.name },
      { agentId: second.agentId, name: second.name },
    ],
    comparison: {
      agents: [first, second],
      winner: null,
      note: "No universal winner.",
      catalogCoverage: "partial",
      fetchedAt: "2026-08-26T10:00:00.000Z",
    },
    selected: [first.agentId, second.agentId],
  }));
}

/** The dd values of the "Hireability" comparison rows, in card order. */
function hireabilityCells(): (string | undefined)[] {
  return screen.getAllByText("Hireability").map((dt) => dt.nextElementSibling?.textContent?.trim());
}

afterEach(() => {
  cleanup();
});

describe("PR40 review: card badge and compare hireability labels", () => {
  // C1 — mutation guard: listed_only without quoteRequestAvailable must stay "Not evaluated".
  it("shows Not evaluated on the card for a listed-only agent without quote-on-request", () => {
    render(createElement(AgentCard, { agent: {
      agentId: "45650",
      name: "V3 Pools",
      description: "Agent",
      operator: "third_party",
      categories: ["rebalancing"],
      href: "/hire/45650",
      hireability: "listed_only",
      evidence,
      passportState: "registered",
    } }));

    expect(screen.getByText("Never probed")).toBeInTheDocument();
    expect(screen.queryByText("Hireable on Mainnet")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view agent/i })).toHaveAttribute("href", "/hire/45650");
  });

  // C2 — compare must render the shared human label, not the raw enum.
  it("renders the shared Not evaluated label in the compare Hireability row", () => {
    const first = marketplaceAgent();
    const second = { ...marketplaceAgent(), agentId: "45381", name: "Aave powered by HeyAnon" };
    renderCompare(first, second);

    // The categories row shows "rebalancing" for both fixtures, so any
    // "Not evaluated" text can only come from the Hireability rows.
    expect(screen.queryAllByText("listed only")).toHaveLength(0);
    expect(hireabilityCells()).toEqual(["Not evaluated", "Not evaluated"]);
    expect(screen.getAllByText("Not evaluated").length).toBeGreaterThanOrEqual(2);
  });

  // C3 — compare must reflect quote-on-request availability like the card does.
  it("renders Quote on request in compare for an admitted seller with a declared A2A endpoint", () => {
    const first = marketplaceAgent();
    const second = { ...marketplaceAgent(), agentId: "45381", name: "Aave powered by HeyAnon" };
    second.operator = "marketplace";
    second.services = [{ name: "A2A", endpoint: "https://seller.example", version: null, tools: [], capabilities: [] }];
    renderCompare(first, second);

    expect(screen.getByText("Quote on request")).toBeInTheDocument();
    expect(hireabilityCells()[1]).toBe("Quote on request");
  });
});
