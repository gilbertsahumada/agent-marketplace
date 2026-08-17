// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import axe from "axe-core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AgentCard } from "../components/marketplace/agent-card.js";
import { AgentProfile } from "../components/marketplace/agent-profile.js";
import { CatalogPage } from "../components/marketplace/catalog-page.js";
import { EvidenceRail } from "../components/marketplace/evidence-rail.js";
import { PublicProofPage } from "../components/marketplace/public-proof-page.js";
import { MarketplaceShell } from "../components/marketplace/site-shell.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import type {
  EvidenceRecord,
  MarketplaceAgent,
  MarketplaceAgentPage,
} from "../src/business/entities/marketplace-agent.js";
import type { PublicJobProof } from "../src/business/entities/public-job-proof.js";
import { GATE1_JOB_514_MANIFEST } from "../src/data/proofs/gate1-job-514.js";
import { Erc8183BrowserSpike } from "../components/spikes/erc8183-browser-spike.js";

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
      status: "not_declared",
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

function publicProof(status: PublicJobProof["live"]["status"]): PublicJobProof {
  return {
    schemaVersion: 1,
    snapshot: GATE1_JOB_514_MANIFEST,
    live: {
      status,
      source: "onchain:bsc-testnet-rpc",
      observedAt: "2026-08-17T00:00:00.000Z",
      observedState: status === "unavailable" ? null : status === "verified" ? "SUBMITTED" : "FUNDED",
      buyer: null,
      seller: null,
      agentWallet: null,
      paymentToken: null,
      budgetRaw: null,
      deadline: null,
      submittedAt: null,
      deliverableHash: null,
      transactions: {},
      checks: status === "mismatch" ? { stateMatches: false } : {},
      error: status === "unavailable"
        ? { code: "GATE1_PROOF_READ_FAILED", message: "Gate 1 proof verification did not complete successfully." }
        : null,
    },
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("marketplace presentation rules", () => {
  it("does not render a Hire action for an MCP-only agent", () => {
    render(createElement(AgentCard, { agent: { agentId: "45650", name: "V3 Pools", description: "Agent", categories: ["rebalancing"], href: "/agents/45650", hireability: "mcp_only", evidence } }));
    expect(screen.getByText("MCP only")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /hire agent/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view evidence/i })).toHaveAttribute("href", "/agents/45650");
  });

  it("keeps the evidence rail accessible as an ordered progression", () => {
    render(createElement(EvidenceRail, { ariaLabel: "Agent evidence", steps: evidence }));
    expect(screen.getByRole("list", { name: "Agent evidence" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getAllByText("verified")).not.toHaveLength(0);
    expect(screen.getAllByText("not observed")).toHaveLength(3);
  });

  it("shows the required honest Grid empty state", () => {
    const page: MarketplaceAgentPage = {
      view: "marketplace",
      items: [],
      pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };
    render(createElement(CatalogPage, { data: page, query: { view: "marketplace", category: "grid_trading" } }));
    expect(screen.getByText("No verified Grid Trading agent yet")).toBeInTheDocument();
    expect(screen.getByText("We have not found a seller with sufficient operational evidence.")).toBeInTheDocument();
    expect(screen.queryByText(/0 reported/)).not.toBeInTheDocument();
  });

  it("shows the upstream total only for all registered agents", () => {
    const page: MarketplaceAgentPage = {
      view: "all",
      items: [],
      pagination: { page: 1, pageSize: 24, total: 80_058, totalPages: 3336 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };
    render(createElement(CatalogPage, { data: page, query: { view: "all", sort: "newest" } }));
    expect(screen.getByText("Catalog coverage: partial · 80,058 reported")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort agents" })).toHaveValue("newest");
  });

  it("renders curated categories as derived evidence with their rationale", async () => {
    const user = userEvent.setup();
    render(createElement(AgentProfile, { agent: marketplaceAgent() }));
    expect(screen.getAllByText("derived")).not.toHaveLength(0);
    expect(screen.getByText(/Curated liquidity-management signal/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Reputation" }));
    expect(screen.getByText(/Indexed reputation; not re-read directly from BSC/)).toBeInTheDocument();
  });

  it("keeps historical SUBMITTED evidence separate from live mismatch or unavailability", () => {
    const { rerender } = render(createElement(PublicProofPage, { proof: publicProof("mismatch") }));
    expect(screen.getByText("Live verification mismatch")).toBeInTheDocument();
    expect(screen.getByText(/stateMatches/)).toBeInTheDocument();
    expect(screen.queryByText("in progress")).not.toBeInTheDocument();
    expect(screen.getByText(GATE1_JOB_514_MANIFEST.transactions.submit.hash)).toBeInTheDocument();
    expect(screen.getByText(`Block ${GATE1_JOB_514_MANIFEST.transactions.submit.blockNumber}`)).toBeInTheDocument();

    rerender(createElement(PublicProofPage, { proof: publicProof("unavailable") }));
    expect(screen.getByText("Historical proof · live check unavailable")).toBeInTheDocument();
    expect(screen.getByText(/historical SUBMITTED proof remains available/)).toBeInTheDocument();
  });

  it("supports keyboard focus through the shell and arrow navigation through tabs", async () => {
    const user = userEvent.setup();
    const { unmount } = render(createElement(MarketplaceShell, {
      children: createElement("main", { id: "main-content" }, "Content"),
    }));
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
    const menu = screen.getByText("Menu");
    for (let index = 0; index < 12 && document.activeElement !== menu; index += 1) {
      await user.tab();
    }
    expect(menu).toHaveFocus();
    unmount();

    render(createElement(Tabs, { defaultValue: "one" },
      createElement(TabsList, {},
        createElement(TabsTrigger, { value: "one" }, "One"),
        createElement(TabsTrigger, { value: "two" }, "Two"),
      ),
      createElement(TabsContent, { value: "one" }, "First panel"),
      createElement(TabsContent, { value: "two" }, "Second panel"),
    ));
    await user.tab();
    expect(screen.getByRole("tab", { name: "One" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveFocus();
    expect(screen.getByText("Second panel")).toBeInTheDocument();
  });

  it("has no basic automated accessibility violations in the evidence component", async () => {
    render(createElement("main", {}, createElement("h1", {}, "Evidence"), createElement(EvidenceRail, { steps: evidence })));
    const result = await axe.run(document.body);
    expect(result.violations).toEqual([]);
  });

  it("labels the browser spike as Testnet infrastructure and requires a quote before wallet access", async () => {
    render(createElement(Erc8183BrowserSpike));
    expect(screen.getByRole("heading", { name: /sign the erc-8183 lifecycle yourself/i })).toBeInTheDocument();
    expect(screen.getByText("Testing infrastructure — not a marketplace agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect injected wallet/i })).toBeDisabled();
    expect(screen.queryByText(/mainnet/i)).not.toBeInTheDocument();
    const result = await axe.run(document.body);
    expect(result.violations).toEqual([]);
  });
});
