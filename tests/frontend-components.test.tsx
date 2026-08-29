// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement, type AnchorHTMLAttributes } from "react";
import axe from "axe-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCard } from "../components/marketplace/agent-card.tsx";
import { AgentProfile } from "../components/marketplace/agent-profile.tsx";
import { CatalogPage } from "../components/marketplace/catalog-page.tsx";
import { CatalogUnavailable } from "../components/marketplace/catalog-unavailable.tsx";
import { EvidenceRail } from "../components/marketplace/evidence-rail.tsx";
import { PublicProofPage } from "../components/marketplace/public-proof-page.tsx";
import { TestnetJobTracker } from "../components/marketplace/testnet-job-tracker.tsx";
import { MarketplaceShell } from "../components/marketplace/site-shell.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import type {
  EvidenceRecord,
  MarketplaceAgent,
  MarketplaceAgentPage,
} from "../src/business/entities/marketplace-agent.ts";
import type { PublicJobProof } from "../src/business/entities/public-job-proof.ts";
import { GATE1_JOB_514_MANIFEST } from "../src/data/proofs/gate1-job-514.ts";
import { GATE6A_JOB_551_MANIFEST } from "../src/data/proofs/gate6a-job-551.ts";
import { Erc8183TestnetDemo, Erc8183TransactionList } from "../components/spikes/erc8183-browser-spike.tsx";
import { Providers } from "../app/providers.tsx";
import { VerificationDrift } from "../components/marketplace/verification-drift.tsx";
import { EvidencePassportCard } from "../components/marketplace/evidence-passport-card.tsx";
import type { AgentEvidencePassport } from "../src/business/entities/evidence-passport.ts";
import { ValidateAgentPanel } from "../components/marketplace/validate-agent-panel.tsx";
import type { AgentValidationReport } from "../src/business/entities/agent-validation.ts";
import { ComparePage } from "../components/marketplace/compare-page.tsx";
import ValidateAgentPage from "../app/validate/page.tsx";

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

function validationReport(): AgentValidationReport {
  return {
    schemaVersion: 1,
    chainId: 56,
    status: "complete",
    generatedAt: "2026-08-26T10:05:00.000Z",
    agent: {
      agentId: "303779",
      name: "Marketplace Grid Planner",
      description: "Deterministic grid planning",
      owner: "0x1111111111111111111111111111111111111111",
      metadataUri: "ipfs://grid",
      operator: "marketplace",
      indexedAt: "2026-08-26T10:00:00.000Z",
      declaredServices: [{ name: "A2A", hasEndpoint: true, tools: [] }],
    },
    classification: { status: "not_assigned", categories: [], note: "Validation does not assign marketplace categories." },
    promotion: { status: "manual_review_required", note: "Validation evidence never promotes an agent automatically." },
    qualification: { status: "quote_verified_candidate", canHire: false, note: "Manual review is required before Hire." },
    evidence: {
      identity: {
        status: "match",
        ownerMatches: true,
        metadataUriMatches: true,
        agentWallet: "0x2222222222222222222222222222222222222222",
        registryAddress: "0x3333333333333333333333333333333333333333",
        blockNumber: "118077255",
        observedAt: "2026-08-26T10:00:00.000Z",
        error: null,
      },
      endpointChecks: [{ protocol: "a2a", status: "verified", declaredTools: [], observedTools: [], declaredOnlyTools: [], observedOnlyTools: [], observedAt: "2026-08-26T10:00:00.000Z", error: null }],
      quote: { status: "verified", provider: "0x2222222222222222222222222222222222222222", currency: "0x4444444444444444444444444444444444444444", priceRaw: "1", expiresAt: "2026-08-26T10:10:00.000Z", observedAt: "2026-08-26T10:00:00.000Z" },
    },
    passport: evidencePassport("evaluated"),
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("marketplace presentation rules", () => {
  it("renders the Evidence Passport as evidence, not as an NFT or guarantee", async () => {
    const { rerender } = render(createElement("main", {}, createElement(EvidencePassportCard, { passport: evidencePassport("registered") })));
    expect(screen.getByRole("heading", { name: "Indexed Evidence Passport" })).toBeInTheDocument();
    expect(screen.getByText("Registered")).toBeInTheDocument();
    expect(screen.getByText("Not probed")).toBeInTheDocument();
    expect(screen.getByText(/indexed identity and declaration snapshot/i)).toBeInTheDocument();
    expect(screen.queryByText(/NFT/i)).not.toBeInTheDocument();

    rerender(createElement("main", {}, createElement(EvidencePassportCard, { passport: evidencePassport("job_proven"), apiHref: "/api/marketplace/agents/303779/passport" })));
    expect(screen.getByText("Job proven")).toBeInTheDocument();
    expect(screen.getByText("1 proven job")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open passport JSON" })).toHaveAttribute("href", "/api/marketplace/agents/303779/passport");
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("validates an Agent ID without accepting an endpoint or enabling Hire", async () => {
    const fetchMock = vi.fn(async () => Response.json(validationReport()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(createElement("main", {}, createElement(ValidateAgentPanel)));

    expect(screen.getByRole("textbox", { name: "BSC Agent ID" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /endpoint/i })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "BSC Agent ID" }), "303779");
    await user.click(screen.getByRole("button", { name: "Validate agent" }));

    expect(await screen.findByRole("heading", { name: "Indexed Evidence Passport" })).toBeInTheDocument();
    expect(screen.getByText("Manual review required")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /hire/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/marketplace/validate", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ agentId: "303779" }),
    }));
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("wraps a uint256-sized raw quote on narrow screens", async () => {
    const raw = "9".repeat(78);
    const report = validationReport();
    report.evidence.quote.priceRaw = raw;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(report)));
    const user = userEvent.setup();
    render(createElement("main", {}, createElement(ValidateAgentPanel)));

    await user.type(screen.getByRole("textbox", { name: "BSC Agent ID" }), "303779");
    await user.click(screen.getByRole("button", { name: "Validate agent" }));

    expect(await screen.findByText(raw)).toHaveClass("break-all", "text-right");
  });

  it("links each comparison column to its evidence Passport without extra claims", () => {
    const first = marketplaceAgent();
    first.endpointObservation.status = "observed_ok";
    const second = { ...marketplaceAgent(), agentId: "45381", name: "Aave powered by HeyAnon" };
    render(createElement(ComparePage, {
      candidates: [
        { agentId: "45650", name: "V3 Pools powered by HeyAnon" },
        { agentId: "45381", name: "Aave powered by HeyAnon" },
      ],
      comparison: {
        agents: [first, second],
        winner: null,
        note: "No universal winner.",
        catalogCoverage: "partial",
        fetchedAt: "2026-08-26T10:00:00.000Z",
      },
      selected: ["45650", "45381"],
    }));

    expect(screen.getByRole("link", { name: "Passport · Registered for V3 Pools powered by HeyAnon" })).toHaveAttribute("href", "/agents/45650/passport");
    expect(screen.getByRole("link", { name: "Passport · Registered for Aave powered by HeyAnon" })).toHaveAttribute("href", "/agents/45381/passport");
    expect(screen.queryByText("observed ok")).not.toBeInTheDocument();
  });

  it("explains the builder path from registration to proven work", async () => {
    render(createElement(ValidateAgentPage));
    expect(screen.getByRole("heading", { name: "From Agent Studio to marketplace evidence" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("Register"),
      expect.stringContaining("Validate"),
      expect.stringContaining("Review"),
      expect.stringContaining("Hire"),
      expect.stringContaining("Prove"),
    ]));
    expect(screen.getByRole("link", { name: "Read the verification methodology" })).toHaveAttribute("href", "/evidence/verification");
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("does not render a Hire action for an MCP-only agent", () => {
    render(createElement(AgentCard, { agent: { agentId: "45650", name: "V3 Pools", description: "Agent", operator: "third_party", categories: ["rebalancing"], href: "/agents/45650", hireability: "mcp_only", evidence, passportState: "evaluated", passportHref: "/agents/45650/passport" } }));
    expect(screen.getByText("MCP only")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /hire agent/i })).not.toBeInTheDocument();
    const profileLink = screen.getByRole("link", { name: /view evidence/i });
    expect(profileLink).toHaveAttribute("href", "/agents/45650");
    expect(profileLink).toHaveAttribute("data-prefetch", "false");
    expect(screen.getByRole("link", { name: "Passport · Evaluated" })).toHaveAttribute("href", "/agents/45650/passport");
    expect(screen.getByRole("link", { name: "Compare V3 Pools" })).toHaveAttribute("href", "/compare?agentId=45650");
  });

  it("renders not-probed evidence neutrally instead of with a green verified icon", () => {
    const { container } = render(createElement(VerificationDrift, {
      compact: true,
      verification: {
        freshness: "current",
        generatedAt: "2026-08-24T12:00:00.000Z",
        blockNumber: "123",
        identityStatus: "match",
        identityMismatchFields: [],
        identityObservedAt: "2026-08-24T12:00:00.000Z",
        identityOnchainProvenance: "onchain",
        toolsStatus: "not_probed",
        toolReachability: "not_probed",
        toolProbeOutcomes: ["not_probed"],
        declaredOnlyTools: [],
        observedOnlyTools: [],
        toolsObservedAt: null,
      },
    }));
    expect(within(container).getByText(/Tool endpoint was not probed/)).toBeInTheDocument();
    expect(within(container).getByText(/Not probed/)).toBeInTheDocument();
    expect(container.querySelector(".text-emerald-300")).toBeNull();
  });

  it("renders a failed identity read as unavailable rather than onchain provenance", () => {
    const { container } = render(createElement(VerificationDrift, {
      verification: {
        freshness: "current",
        generatedAt: "2026-08-24T12:00:00.000Z",
        blockNumber: "123",
        identityStatus: "read_error",
        identityMismatchFields: [],
        identityObservedAt: "2026-08-24T12:00:00.000Z",
        identityOnchainProvenance: "unavailable",
        toolsStatus: "not_probed",
        toolReachability: "not_probed",
        toolProbeOutcomes: ["not_probed"],
        declaredOnlyTools: [],
        observedOnlyTools: [],
        toolsObservedAt: null,
      },
    }));
    expect(within(container).getAllByText(/unavailable/i).length).toBeGreaterThan(0);
    expect(within(container).queryByText("onchain")).toBeNull();
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

  it("renders a recoverable catalogue outage without fabricating fallback rows", () => {
    render(createElement(CatalogUnavailable, { retryHref: "/agents?view=all&page=2" }));
    expect(screen.getByText("Live catalogue temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByText(/No registered agent or profile data was invented/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/agents?view=all&page=2");
    expect(screen.getByRole("link", { name: "Return to marketplace status" })).toHaveAttribute("href", "/");
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
    expect(screen.getByText("Partial coverage · 80,058 agents")).toBeInTheDocument();
    expect(screen.getByText(/count is trust8004 response\.total for chainId 56 with active=true, fetched /)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort agents" })).toHaveValue("newest");
  });

  it("does not promote indexed reachability in the all-agents view when Worker observations are unavailable", () => {
    const agent = marketplaceAgent();
    agent.endpointObservation = {
      status: "observed_ok",
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
      lastTestedAt: "2026-08-17T00:00:00.000Z",
      httpStatus: 200,
      capabilitiesCount: 1,
      requiresAuth: false,
      error: null,
    };
    const page: MarketplaceAgentPage = {
      view: "all",
      items: [agent],
      pagination: { page: 1, pageSize: 24, total: 1, totalPages: 1 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };

    render(createElement(CatalogPage, { data: page, query: { view: "all", sort: "newest" } }));
    const rail = screen.getByRole("list", { name: `Evidence for ${agent.name}` });
    const reachable = within(rail).getAllByRole("listitem")[1]!;
    expect(reachable).toHaveAttribute("data-status", "unavailable");
    expect(within(reachable).queryByText("verified")).not.toBeInTheDocument();
  });

  it("renders curated categories as derived evidence with their rationale", async () => {
    const user = userEvent.setup();
    const agent = marketplaceAgent();
    agent.endpointObservation.status = "observed_ok";
    render(createElement(AgentProfile, { agent, passport: evidencePassport("registered") }));
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Agents" })).toHaveAttribute("href", "/agents");
    expect(within(breadcrumb).getByText("V3 Pools powered by HeyAnon")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText(/Catalog coverage|Partial coverage/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Indexed Evidence Passport" })).toBeInTheDocument();
    expect(screen.queryByText("Live marketplace evidence snapshot — not a financial guarantee.")).not.toBeInTheDocument();
    expect(screen.getAllByText("derived")).not.toHaveLength(0);
    expect(screen.getByText(/Curated liquidity-management signal/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Services" }));
    expect(screen.queryByText("observed ok")).not.toBeInTheDocument();
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
    const { unmount } = render(createElement(Providers, {
      children: createElement(MarketplaceShell, {
        children: createElement("main", { id: "main-content" }, "Content"),
      }),
    }));
    const active = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", "/agents");

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
    render(createElement(Providers, { children: createElement(Erc8183TestnetDemo) }));
    expect(screen.getByRole("heading", { name: /hire with your wallet/i })).toBeInTheDocument();
    expect(screen.getByText("Testing infrastructure — not a marketplace agent")).toBeInTheDocument();
    expect(screen.getAllByText(/Agent 1866/)).toHaveLength(2);
    expect(screen.queryByText(/Agent 1815/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect a wallet in the header/i })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Guardrails and continuing authority" })).toBeInTheDocument();
    expect(screen.getByText(/never receives the buyer private key/i)).toBeInTheDocument();
    expect(screen.getByText(/does not expose a cancellation action after funding/i)).toBeInTheDocument();
    expect(screen.queryByText(/mainnet/i)).not.toBeInTheDocument();
    const result = await axe.run(document.body);
    expect(result.violations).toEqual([]);
  });

  it("shows confirmed wallet transactions with explorer links", () => {
    const hash = `0x${"12".repeat(32)}` as const;
    render(createElement(Erc8183TransactionList, {
      explorerUrl: "https://bscscan.com",
      intents: [{
        kind: "createJob",
        contract: "0x1111111111111111111111111111111111111111",
        purpose: "Create the job",
        required: true,
      }],
      journal: {
        schemaVersion: 1,
        chainId: 56,
        buyer: "0x2222222222222222222222222222222222222222",
        seller: "0x3333333333333333333333333333333333333333",
        jobId: "56662",
        transactions: { createJob: hash },
        receipts: { createJob: { blockNumber: "1", gasUsed: "2", effectiveGasPrice: "3", confirmedAt: "2026-08-27T00:00:00.000Z" } },
        lastConfirmedStep: "created",
      },
    }));

    expect(screen.getByText("confirmed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view createJob transaction/i })).toHaveAttribute("href", `https://bscscan.com/tx/${hash}`);
  });

  it("renders the Job 551 proof with complete hashes when live RPC is unavailable", async () => {
    render(createElement(TestnetJobTracker, {
      tracking: { liveStatus: "unavailable", job: null, snapshot: GATE6A_JOB_551_MANIFEST },
    }));
    expect(screen.getByRole("heading", { name: "ERC-8183 Job #551" })).toBeInTheDocument();
    expect(screen.getByText("Live chain check unavailable")).toBeInTheDocument();
    expect(screen.getByText(GATE6A_JOB_551_MANIFEST.transactions.createJob.hash)).toBeInTheDocument();
    expect(screen.getByText(GATE6A_JOB_551_MANIFEST.transactions.submit.hash)).toBeInTheDocument();
    expect(screen.getByText(GATE6A_JOB_551_MANIFEST.deliverable.content)).toBeInTheDocument();
    const result = await axe.run(document.body);
    expect(result.violations).toEqual([]);
  });
});
