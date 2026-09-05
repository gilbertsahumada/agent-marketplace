// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement, type AnchorHTMLAttributes } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import axe from "axe-core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { Erc8183MainnetDemo, Erc8183MarketplaceHire, Erc8183SavedHire, Erc8183TestnetDemo, Erc8183TransactionList, hireConfirmationLabel, sharedEvidenceSyncMessage } from "../components/spikes/erc8183-browser-spike.tsx";
import { ERC8183_MAINNET } from "../src/mainnet/contracts.ts";
import { Providers } from "../app/providers.tsx";
import { VerificationDrift } from "../components/marketplace/verification-drift.tsx";
import { EvidencePassportCard } from "../components/marketplace/evidence-passport-card.tsx";
import type { AgentEvidencePassport } from "../src/business/entities/evidence-passport.ts";
import type { MainnetJobProof } from "../src/business/entities/mainnet-job-proof.ts";
import { ValidateAgentPanel } from "../components/marketplace/validate-agent-panel.tsx";
import type { AgentValidationReport } from "../src/business/entities/agent-validation.ts";
import { ComparePage } from "../components/marketplace/compare-page.tsx";
import ValidateAgentPage from "../app/validate/page.tsx";
import { agentCardViewModel } from "../components/marketplace/view-models.ts";
import { MarketplaceLanding } from "../components/marketplace/landing-page.tsx";
import AgentsLoading from "../app/agents/loading.tsx";
import HireAgentLoading from "../app/hire/[agentId]/loading.tsx";

const walletState = vi.hoisted(() => ({
  address: null as `0x${string}` | null,
  chainId: 56,
  switchChainAsync: vi.fn(),
}));
const routerPush = vi.hoisted(() => vi.fn());
const routerReplace = vi.hoisted(() => vi.fn());

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return {
    ...actual,
    useAccount: () => ({
      address: walletState.address,
      isConnected: walletState.address !== null,
      connector: null,
    }),
    useChainId: () => walletState.chainId,
    useSwitchChain: () => ({ switchChainAsync: walletState.switchChainAsync }),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/agents",
  useRouter: () => ({ push: routerPush, replace: routerReplace, refresh: vi.fn() }),
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
    promotion: { status: "already_marketplace_configured", note: "The seller was configured before validation." },
    qualification: { status: "marketplace_configured", canHire: true, note: "Hire requests a fresh quote before signing." },
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
      observationSync: { status: "recorded", attempted: 2, recorded: 2, failed: 0, notConfigured: 0 },
    },
    passport: evidencePassport("evaluated"),
  };
}

const MAINNET_DEMO_CONFIG = {
  agentId: 303779,
  seller: "0x2222222222222222222222222222222222222222" as const,
  commerce: "0x3333333333333333333333333333333333333333" as const,
  router: "0x5555555555555555555555555555555555555555" as const,
  policy: "0x6666666666666666666666666666666666666666" as const,
  token: "0x4444444444444444444444444444444444444444" as const,
  maximumBudgetRaw: "10",
  rpcUrl: "https://bsc-rpc.publicnode.com",
  explorerUrl: "https://bscscan.com",
  sellerOrigin: "https://seller.example",
};

function mainnetQuote(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1_000);
  return {
    schemaVersion: 1,
    agentId: 303779,
    chainId: 56,
    endpoint: "https://seller.example/a2a",
    provider: MAINNET_DEMO_CONFIG.seller,
    commerce: MAINNET_DEMO_CONFIG.commerce,
    router: MAINNET_DEMO_CONFIG.router,
    policy: MAINNET_DEMO_CONFIG.policy,
    token: MAINNET_DEMO_CONFIG.token,
    tokenSymbol: "USDT",
    tokenDecimals: 18,
    priceRaw: "1",
    priceDisplay: "0.000000000000000001",
    negotiatedAt: now,
    quoteExpiresAt: now + 600,
    description: "Test hire",
    envelope: {},
    observationSync: { status: "synced" },
    ...overrides,
  };
}

function mainnetPlan(quote: ReturnType<typeof mainnetQuote>) {
  return {
    quote,
    buyer: "0x7777777777777777777777777777777777777777",
    seller: MAINNET_DEMO_CONFIG.seller,
    nativeBalanceRaw: "1",
    tokenBalanceRaw: "10",
    allowanceRaw: "0",
    approvalRequired: true,
    approvalAmountRaw: "1",
    deadline: String(Math.floor(Date.now() / 1_000) + 1200),
    disputeWindowSeconds: "600",
    executeBefore: quote.quoteExpiresAt,
    maximumSignatures: 5,
    guardrails: {
      custody: "injected_wallet",
      buyerPrivateKeyReceivedByServer: false,
      spendCeilingRaw: "10",
      approvalMode: "exact_if_required",
      approvalSpender: MAINNET_DEMO_CONFIG.commerce,
      cancellationAvailableAfterFunding: false,
    },
    transactions: [{ kind: "createJob", contract: MAINNET_DEMO_CONFIG.commerce, purpose: "Create job", required: true }],
  };
}

function mainnetJob(status: "FUNDED" | "SUBMITTED" | "COMPLETED") {
  return {
    chainId: 56,
    jobId: "42",
    buyer: "0x7777777777777777777777777777777777777777",
    provider: MAINNET_DEMO_CONFIG.seller,
    evaluator: MAINNET_DEMO_CONFIG.seller,
    policy: MAINNET_DEMO_CONFIG.policy,
    description: "Prior job",
    budgetRaw: "1",
    deadline: String(Math.floor(Date.now() / 1_000) + 600),
    status,
    submittedAt: "1",
    deliverableHash: `0x${"34".repeat(32)}`,
    deliverableUrl: null,
    result: null,
    quotedToken: MAINNET_DEMO_CONFIG.token,
    quotedPriceRaw: "1",
    quoteExpiresAt: Math.floor(Date.now() / 1_000) + 60,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderMainnetDemo() {
  return render(createElement(Providers, { children: createElement(Erc8183MainnetDemo, {
    config: MAINNET_DEMO_CONFIG,
    agentName: "Marketplace Grid Planner",
  }) }));
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
  walletState.address = null;
  walletState.chainId = 56;
  walletState.switchChainAsync.mockReset();
  vi.unstubAllGlobals();
});

describe("marketplace presentation rules", () => {
  it("renders the ERC-8183 flow as embeddable content without a second main landmark", () => {
    render(createElement(Providers, { children: createElement(Erc8183MainnetDemo, {
      config: MAINNET_DEMO_CONFIG,
      agentName: "Marketplace Grid Planner",
      embedded: true,
    }) }));

    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    const flow = screen.getByRole("region", { name: "ERC-8183 hiring flow" });
    expect(flow).toBeInTheDocument();
    expect(within(flow).queryByText("Hire with your wallet. Verify every step.")).not.toBeInTheDocument();
    expect(within(flow).getByRole("list", { name: "Hiring progress" })).toBeInTheDocument();
    expect(within(flow).getByRole("button", { name: "Request quote" })).toBeInTheDocument();
    expect(within(flow).getByText("Authorize & fund")).toBeInTheDocument();
    expect(within(flow).getByText("No signature")).toBeInTheDocument();
    expect(within(flow).queryByText("Guardrails and continuing authority")).not.toBeInTheDocument();
    expect(within(flow).queryByText(/server resolves Agent/i)).not.toBeInTheDocument();
    expect(within(flow).queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("turns historical quote evidence into an explicit fresh-quote action", () => {
    render(createElement(Providers, { children: createElement(Erc8183MainnetDemo, {
      agentName: "Marketplace Grid Planner",
      config: MAINNET_DEMO_CONFIG,
      embedded: true,
      evidence: {
        protocol: "a2a",
        endpoint: "https://example.test/.well-known/agent-card.json",
        reachable: true,
        quoteStatus: "verified_historical",
        lastCheckedAt: new Date(Date.now() - 30_000).toISOString(),
        attemptCount: 191,
        httpStatus: 200,
        durationMs: 204,
      },
    }) }));

    const flow = screen.getByRole("region", { name: "ERC-8183 hiring flow" });
    expect(within(flow).getByText("Endpoint verified")).toBeInTheDocument();
    expect(within(flow).getByText("HTTP 200")).toBeInTheDocument();
    expect(within(flow).getByText("204 ms")).toBeInTheDocument();
    expect(within(flow).getByText("191 checks")).toBeInTheDocument();
    expect(within(flow).getByText("Quote expired")).toBeInTheDocument();
    expect(within(flow).getByRole("button", { name: "Request fresh quote" })).toBeInTheDocument();
    expect(within(flow).getByText("Expired — refresh required")).toBeInTheDocument();
  });

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
    expect(screen.getByRole("link", { name: "Open hiring workspace" })).toHaveAttribute("href", "/hire/303779");
    expect(screen.getByRole("link", { name: "Open identity on trust8004" })).toHaveAttribute("href", "https://trust8004.xyz/agents/56:303779");
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

    expect(screen.getByRole("link", { name: "View V3 Pools powered by HeyAnon identity and reputation on trust8004 (opens in a new tab)" })).toHaveAttribute("href", "https://trust8004.xyz/agents/56:45650");
    expect(screen.getByRole("link", { name: "View Aave powered by HeyAnon identity and reputation on trust8004 (opens in a new tab)" })).toHaveAttribute("href", "https://trust8004.xyz/agents/56:45381");
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

  it("uses one contextual journey action for an MCP-only agent", () => {
    render(createElement(AgentCard, { agent: { agentId: "45650", name: "V3 Pools", description: "Agent", operator: "third_party", categories: ["rebalancing"], href: "/hire/45650", hireability: "mcp_only", evidence, passportState: "evaluated" } }));
    expect(screen.getAllByText("Not checked yet")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /hire agent/i })).not.toBeInTheDocument();
    const journeyLink = screen.getByRole("link", { name: /check availability/i });
    expect(journeyLink).toHaveAttribute("href", "/hire/45650#validation");
    expect(journeyLink).toHaveAttribute("data-prefetch", "false");
    const registryLink = screen.getByRole("link", { name: /View V3 Pools on trust8004/i });
    expect(registryLink).toHaveAttribute("href", "https://trust8004.xyz/agents/56:45650");
    expect(registryLink).toHaveTextContent("BSC Mainnet · Agent #45650");
    expect(screen.queryByText(/^trust8004$/i)).not.toBeInTheDocument();
  });

  it("labels registrations without a probeable endpoint explicitly", () => {
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
      monitoring: { state: "no_endpoint_declared", attemptCount: 0 },
    } }));

    expect(screen.getAllByText("No endpoint declared")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /hire agent/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not available" })).toBeDisabled();
  });

  it("labels a quote-enabled seller separately from one that is already ready to hire", () => {
    render(createElement(AgentCard, { agent: {
      agentId: "303779",
      name: "Marketplace Grid Planner",
      description: "Agent",
      operator: "marketplace",
      categories: ["grid_trading"],
      href: "/hire/303779",
      hireability: "listed_only",
      quoteRequestAvailable: true,
      capabilityState: "ready",
      evidence: evidence.map((step) => step.kind === "reachable" ? { ...step, status: "verified" as const } : step),
      passportState: "registered",
    } }));

    expect(screen.getByText("Ready to quote")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /view profile/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request quote/i })).toHaveAttribute("href", "/hire/303779#hire-flow");
    expect(screen.queryByRole("link", { name: /hire agent/i })).not.toBeInTheDocument();
  });

  it("offers a retry when the latest seller capability attempt failed", () => {
    render(createElement(AgentCard, { agent: {
      agentId: "303779",
      name: "Marketplace Grid Planner",
      description: "Agent",
      operator: "marketplace",
      categories: ["grid_trading"],
      href: "/hire/303779",
      hireability: "listed_only",
      quoteRequestAvailable: true,
      buyerAction: "request_quote",
      capabilityState: "failed",
      evidence: evidence.map((step) => step.kind === "reachable" ? { ...step, status: "verified" as const } : step),
      passportState: "registered",
    } }));

    expect(screen.getByText("Quote failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /retry quote/i })).toHaveAttribute("href", "/hire/303779#hire-flow");
  });

  it("prioritizes a failed connection over previously ready quote capability", () => {
    render(createElement(AgentCard, { agent: {
      agentId: "334760", name: "Seller", description: "Agent",
      operator: "third_party", categories: [], href: "/hire/334760",
      hireability: "listed_only", quoteRequestAvailable: true,
      buyerAction: "request_quote", capabilityState: "ready",
      evidence: evidence.map((step) => step.kind === "reachable" ? { ...step, status: "failed" as const } : step),
      passportState: "evaluated",
    } }));
    expect(screen.getByText("Connection failed")).toBeInTheDocument();
    expect(screen.queryByText("Ready to quote")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retry availability" })).toHaveAttribute("href", "/hire/334760#validation");
    expect(screen.queryByRole("link", { name: "Request quote" })).not.toBeInTheDocument();
  });

  it("reserves Hire agent for a seller with a fresh quote and current chain checks", () => {
    render(createElement(AgentCard, { agent: {
      agentId: "303779",
      name: "Marketplace Grid Planner",
      description: "Agent",
      operator: "marketplace",
      categories: ["grid_trading"],
      href: "/hire/303779",
      hireability: "hireable",
      quoteRequestAvailable: true,
      buyerAction: "prepare_hire",
      evidence: evidence.map((step) => step.kind === "reachable" ? { ...step, status: "verified" as const } : step),
      passportState: "hireable",
    } }));

    expect(screen.getByText("Ready to hire")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /hire agent/i })).toHaveAttribute("href", "/hire/303779#hire-flow");
  });

  it("lets a buyer check a declared endpoint without waiting for the scheduler", () => {
    render(createElement(AgentCard, { agent: {
      agentId: "113284",
      name: "Topaz Agent",
      description: "Agent",
      operator: "third_party",
      categories: [],
      href: "/hire/113284",
      hireability: "listed_only",
      buyerAction: "check_availability",
      evidence,
      passportState: "evaluated",
      monitoring: { state: "probed", source: "worker", latestOutcome: "protocol_valid" },
    } }));

    expect(screen.getByRole("link", { name: "Check availability" }))
      .toHaveAttribute("href", "/hire/113284#validation");
  });

  it("does not imply hiring when a reachable agent has no marketplace quote flow", () => {
    render(createElement(AgentCard, { agent: {
      agentId: "113284",
      name: "Topaz Agent",
      description: "Agent",
      operator: "third_party",
      categories: [],
      href: "/hire/113284",
      hireability: "listed_only",
      buyerAction: "check_availability",
      evidence: evidence.map((step) => step.kind === "reachable" ? { ...step, status: "verified" as const } : step),
      passportState: "evaluated",
      monitoring: { state: "probed", source: "worker", latestOutcome: "protocol_valid" },
    } }));

    expect(screen.getByText("Reachable only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check compatibility" })).toHaveAttribute("href", "/hire/113284#hire-flow");
    expect(screen.queryByRole("link", { name: /hire agent|request quote/i })).not.toBeInTheDocument();
  });

  it("shows declared transports and a concise platform observation on the catalog card", () => {
    render(createElement(AgentCard, { agent: {
      agentId: "113284",
      name: "Topaz Agent",
      description: "Agent",
      operator: "third_party",
      categories: [],
      protocols: ["A2A", "MCP", "ERC-8183 HTTP"],
      href: "/hire/113284",
      hireability: "listed_only",
      buyerAction: "check_availability",
      evidence: evidence.map((step) => step.kind === "reachable" ? { ...step, status: "verified" as const } : step),
      passportState: "evaluated",
      monitoring: {
        state: "probed",
        source: "worker",
        latestOutcome: "protocol_valid",
        lastAttemptAt: "2026-09-03T12:00:00.000Z",
        latestHttpStatus: 200,
        latestDurationMs: 346,
      },
    } }));

    expect(screen.getByLabelText("Declared protocols")).toHaveTextContent("A2AMCPERC-8183 HTTP");
    expect(screen.getByText("Reachable only")).toBeInTheDocument();
    expect(screen.getByText("Reachable now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Latest check: Reachable now" })).toBeInTheDocument();
    expect(screen.getByText("HTTP 200 · 346 ms")).toBeInTheDocument();
    expect(screen.getByTitle("Last checked 03 Sept 2026 12:00 UTC")).toBeInTheDocument();
  });

  it("keeps a rejected quote visibly reachable while separating quote failure", () => {
    render(createElement(AgentCard, { agent: {
      agentId: "45422",
      name: "Quote-rejecting seller",
      description: "Agent",
      operator: "third_party",
      categories: [],
      protocols: ["A2A"],
      href: "/hire/45422",
      hireability: "listed_only",
      evidence: evidence.map((step) => step.kind === "reachable"
        ? { ...step, status: "verified" as const }
        : step.kind === "quote"
          ? { ...step, status: "failed" as const }
          : step),
      passportState: "evaluated",
      monitoring: {
        state: "probed",
        source: "worker",
        latestOutcome: "quote_rejected",
        latestHttpStatus: 200,
        latestDurationMs: 401,
      },
    } }));

    expect(screen.getByText("Reachable only")).toBeInTheDocument();
    expect(screen.getByText("Reachable now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Latest check: Reachable now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Latest check: Reachable now" }).closest("[data-observation-status=\"Reachable now\"]")).not.toBeNull();
    expect(screen.queryByText("Check failed")).not.toBeInTheDocument();
  });

  it("keeps the quote CTA for an admitted seller that declares only ERC-8183", () => {
    const agent = marketplaceAgent();
    agent.operator = "marketplace";
    agent.services = [{
      name: "ERC-8183",
      endpoint: "https://seller.example/grid",
      version: null,
      tools: [],
      capabilities: [],
    }];

    expect(agentCardViewModel(agent).quoteRequestAvailable).toBe(true);
  });

  it("fails closed when the normalized hiring state is unavailable", () => {
    const agent = marketplaceAgent();
    agent.agentId = "303779";
    agent.name = "Marketplace Grid Planner";
    agent.operator = "marketplace";
    agent.services = [{ name: "A2A", endpoint: "https://seller.example", version: null, tools: [], capabilities: [] }];
    agent.endpoints = [{ name: "A2A", endpoint: "https://seller.example" }];
    agent.hireability = {
      status: "protocol_discovered",
      canHire: false,
      reason: "A compatible seller transport is declared.",
      evidence: evidenceRecord("derived", "A compatible seller transport is declared."),
    };

    render(createElement(AgentProfile, {
      agent,
      passport: evidencePassport("registered"),
    }));

    expect(screen.getByRole("heading", { name: "Check compatibility" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hire agent/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Identity & reputation/i }))
      .toHaveAttribute("href", "https://trust8004.xyz/agents/56:303779");
  });

  it("presents the agent route as a hiring workspace with ERC-8183 history", () => {
    const agent = marketplaceAgent();
    agent.agentId = "303779";
    agent.name = "Marketplace Grid Planner";
    const passport = evidencePassport("job_proven");
    const job = {
      schemaVersion: 1,
      capturedAt: "2026-08-26T10:04:00.000Z",
      chainId: 56,
      agentId: "303779",
      jobId: "700",
      buyer: `0x${"11".repeat(20)}`,
      seller: `0x${"22".repeat(20)}`,
      token: `0x${"33".repeat(20)}`,
      budgetRaw: "2500000",
      finalState: "COMPLETED",
      deliverableHash: `0x${"44".repeat(32)}`,
      resultHashVerified: true,
      deterministicResultVerified: true,
      durationSeconds: "42",
      totalGasCostWei: "1234",
      transactions: {},
    } as MainnetJobProof;

    render(createElement(AgentProfile, {
      agent,
      hireFlow: createElement("div", {}, "Quote flow"),
      jobProofs: [job],
      passport,
    }));

    expect(screen.getByRole("heading", { name: "Marketplace Grid Planner" })).toBeInTheDocument();
    expect(screen.queryByText("Readiness at a glance")).not.toBeInTheDocument();
    expect(screen.getByText("Identity declared")).toBeInTheDocument();
    expect(screen.getByText("Job totals unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Hire agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ERC-8183 job history", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View job 700" })).toHaveAttribute("href", "/jobs/mainnet/700");
    expect(screen.getByRole("link", { name: /Identity & reputation/i }))
      .toHaveAttribute("href", "https://trust8004.xyz/agents/56:303779");
    expect(screen.queryByRole("heading", { name: "Indexed Evidence Passport" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Reputation" })).not.toBeInTheDocument();
    expect(screen.queryByText("Verified hire activity")).not.toBeInTheDocument();
  });

  it("does not present old free-text hire events as current indexed state or invent totals", () => {
    const agent = marketplaceAgent();
    agent.agentId = "303779";
    const passport = evidencePassport("hireable");
    passport.checks.hireActivity = {
      status: "verified",
      provenance: "onchain",
      observedAt: "2026-09-02T18:30:00.000Z",
      detail: `Latest chain-verified hire phase: funded (Job 812, tx 0x${"cd".repeat(32)}).`,
    };

    render(createElement(AgentProfile, { agent, hireJobs: [], passport }));

    expect(screen.queryByText("Verified hire activity")).not.toBeInTheDocument();
    expect(screen.queryByText(/Latest chain-verified hire phase: funded \(Job 812/)).not.toBeInTheDocument();
    expect(screen.getByText("Job totals unavailable")).toBeInTheDocument();
    expect(screen.getByText("No indexed jobs on this network.")).toBeInTheDocument();
  });

  const hireJob = (jobId: string, status: "FUNDED" | "SUBMITTED" | "COMPLETED" = "FUNDED") => ({
    chainId: 56 as const, jobId, buyer: `0x${"11".repeat(20)}` as `0x${string}`, provider: `0x${"22".repeat(20)}` as `0x${string}`,
    budgetRaw: "10000000000000000", status, expiresAt: "2026-09-10T11:37:24.000Z", submittedAt: null,
    marketplace: status !== "FUNDED", updatedAt: "2026-09-03T11:12:30.000Z",
  });

  it("adds a 30-day phase subtitle to the job history only when the window was read", async () => {
    const agent = marketplaceAgent();
    const zero = { created: 0, funded: 0, submitted: 0, settled: 0, refunded: 0 };
    const hireActivity = {
      chainId: 56 as const, days: 30, from: "2026-08-04T12:00:00.000Z", to: "2026-09-03T12:00:00.000Z",
      byDay: [{ day: "2026-09-01", ...zero, created: 4, settled: 2 }],
      totals: { ...zero, created: 4, settled: 2 },
    };
    const { rerender } = render(createElement(AgentProfile, {
      agent, hireActivity, hireJobs: [hireJob("56696", "SUBMITTED")], hireJobsScope: "wallet", passport: evidencePassport("registered"),
    }));

    expect(screen.getByText("Last 30 days: 4 created · 2 settled")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Provider wallet jobs" })).toBeInTheDocument();
    // Scoped to the job history: the avatar fallback elsewhere on the profile
    // is a pre-existing, unrelated finding.
    const history = screen.getByRole("heading", { name: "Provider wallet jobs" }).closest("details");
    expect(history).not.toBeNull();
    expect((await axe.run(history as HTMLElement)).violations).toEqual([]);

    rerender(createElement(AgentProfile, { agent, hireActivity: null, hireJobs: [hireJob("56696", "SUBMITTED")], passport: evidencePassport("registered") }));
    expect(screen.queryByText(/Last 30 days/)).not.toBeInTheDocument();

    rerender(createElement(AgentProfile, { agent, hireJobs: [hireJob("56696", "SUBMITTED")], passport: evidencePassport("registered") }));
    expect(screen.queryByText(/Last 30 days/)).not.toBeInTheDocument();
  });

  it("states the number of wallet confirmations only once the wallet has answered", () => {
    expect(hireConfirmationLabel(null, 5)).toBeNull();
    expect(hireConfirmationLabel("batched", 5)).toBe("One wallet confirmation");
    expect(hireConfirmationLabel("sequential", 4)).toBe("4 wallet confirmations");
  });

  it("uses a route-specific loading state for the hiring workspace", () => {
    render(createElement(HireAgentLoading));
    expect(screen.getByRole("main", { name: "Loading hiring workspace" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading hiring workspace");
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
    expect(within(container).getByText(/Declared tool list was not compared/)).toBeInTheDocument();
    expect(within(container).queryByText(/Tool endpoint was not probed/)).toBeNull();
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
    expect(screen.getAllByText("Verified")).not.toHaveLength(0);
    expect(screen.getAllByText("Not checked")).toHaveLength(3);
  });

  it("keeps summary evidence concise and exposes details on focus", async () => {
    const user = userEvent.setup();
    render(createElement(EvidenceRail, {
      ariaLabel: "Agent evidence summary",
      density: "summary",
      steps: evidence,
    }));

    expect(screen.getByRole("list", { name: "Agent evidence summary" })).toHaveClass(
      "evidence-rail-summary",
      "grid-cols-4",
    );
    expect(screen.queryByText("Derived · Not checked")).not.toBeInTheDocument();
    const quote = screen.getByRole("button", { name: /Quote verified: Not checked/i });
    expect(quote).toHaveClass("cursor-pointer");
    quote.focus();
    await user.keyboard("{Tab}{Shift>}{Tab}{/Shift}");
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Unknown");
  });

  it("uses green for verified evidence, red borders for observed failures, and gray for unknown states", () => {
    const { container } = render(createElement(EvidenceRail, {
      ariaLabel: "Evidence status colors",
      density: "summary",
      steps: [
        evidence[0]!,
        { ...evidence[1]!, status: "failed" as const, detail: "The endpoint failed." },
        evidence[2]!,
        evidence[3]!,
      ],
    }));

    expect(container.querySelector('[data-evidence-status="verified"]')).toHaveClass(
      "border-emerald-400/70",
      "text-emerald-300",
    );
    expect(container.querySelector('[data-evidence-status="failed"]')).toHaveClass(
      "border-red-400/70",
      "text-zinc-500",
    );
    expect(container.querySelector('[data-evidence-status="unknown"]')).toHaveClass(
      "border-zinc-700",
      "text-zinc-500",
    );
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
    expect(screen.getByText(/No agent status or profile data was invented/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/agents?view=all&page=2");
    expect(screen.getByRole("link", { name: "Return to marketplace status" })).toHaveAttribute("href", "/");
  });

  it("shows registry and operational totals without explanatory copy", () => {
    const page: MarketplaceAgentPage = {
      view: "all",
      items: [],
      pagination: { page: 1, pageSize: 24, total: 80_058, totalPages: 3336 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };
    render(createElement(CatalogPage, {
      data: page,
      operationalTotal: 30_006,
      query: { view: "all", sort: "newest" },
      registryTotal: 80_058,
    }));
    expect(screen.getByRole("heading", { name: "Agents" })).toHaveClass("sr-only");
    const totals = screen.getByLabelText("Catalog totals");
    expect(within(totals).getByText("ERC-8004 registered")).toBeInTheDocument();
    expect(within(totals).getByText("80,058")).toBeInTheDocument();
    expect(within(totals).getByText("Can request quote")).toBeInTheDocument();
    expect(within(totals).getByText("30,006")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Catalog scope" })).not.toBeInTheDocument();
    expect(screen.getByTestId("catalog-summary")).toContainElement(totals);
    expect(screen.queryByText(/Registration alone is not evaluation or hireability/)).not.toBeInTheDocument();
    expect(screen.queryByText(/trust8004 response\.total/)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort agents" })).toHaveValue("newest");
  });

  it("defaults the catalogue to cards and lets buyers switch to a comparison table", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const agent = marketplaceAgent();
    const page: MarketplaceAgentPage = {
      view: "marketplace",
      items: [agent],
      pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };

    const { container } = render(createElement(CatalogPage, {
      data: page,
      operationalTotal: 30_006,
      query: { view: "marketplace" },
      registryTotal: 80_058,
    }));

    expect(screen.queryByText("One registry: all identities, or only identities that declare a usable public service endpoint.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Operational candidates" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "All registered agents" })).not.toBeInTheDocument();
    const mobileFilterButton = screen.getByRole("button", { name: "Filters" });
    const mobileFilterDetails = mobileFilterButton.closest("details");
    const searchInput = screen.getByRole("textbox", { name: "Search agents" });
    expect(mobileFilterDetails).not.toHaveAttribute("open");
    expect(mobileFilterDetails?.nextElementSibling).toContainElement(searchInput);
    expect(mobileFilterButton.querySelector(".lucide-list-filter")).not.toBeNull();
    expect(mobileFilterButton.closest("form")).toHaveClass("w-full", "lg:block");
    expect(searchInput.closest("label")).toHaveClass("w-full", "min-w-0");
    expect(searchInput).toHaveClass("focus-visible:ring-0");
    expect(screen.getByRole("tablist", { name: "Catalog layout" }).parentElement).toHaveClass("min-[30rem]:grid-cols-[minmax(0,1fr)_auto]");
    expect(screen.getByRole("tablist", { name: "Catalog layout" })).toHaveClass("h-10");
    await user.click(mobileFilterButton);
    expect(mobileFilterDetails).toHaveAttribute("open");
    await user.click(mobileFilterButton);
    expect(mobileFilterDetails).not.toHaveAttribute("open");
    expect(screen.getByRole("complementary", { name: "Catalog filters" })).toHaveClass("lg:sticky", "lg:overflow-y-auto");
    expect(screen.getByRole("region", { name: "Agent results" })).toHaveClass("lg:h-full", "lg:overflow-y-auto");
    expect(container.querySelector(".lucide-search")).toHaveClass("top-1/2", "-translate-y-1/2");
    expect(screen.getAllByRole("checkbox", { name: "Declared endpoints" })).toHaveLength(2);
    expect(screen.getAllByRole("checkbox", { name: "Declared endpoints" }).every((checkbox) => checkbox.getAttribute("data-state") === "unchecked")).toBe(true);
    expect(screen.getAllByRole("checkbox", { name: "Ready to quote" }).every((checkbox) => checkbox.getAttribute("data-state") === "unchecked")).toBe(true);
    expect(screen.getAllByRole("checkbox", { name: "Grid trading" }).every((checkbox) => checkbox.getAttribute("data-state") === "unchecked")).toBe(true);
    expect(screen.getByRole("tab", { name: "Cards" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "Cards" })).toHaveClass("cursor-pointer");
    expect(screen.queryByRole("navigation", { name: "Catalog scope" })).not.toBeInTheDocument();
    const quickFilters = screen.getByTestId("catalog-quick-filters");
    expect(screen.getByRole("button", { name: /Ready to quote/ })).toHaveClass("h-8", "rounded-md", "w-auto");
    expect(searchInput.closest("form")?.parentElement?.nextElementSibling).toBe(quickFilters);
    expect(screen.getByRole("complementary", { name: "Catalog filters" })).toHaveClass("marketplace-surface", "rounded-xl");
    expect(screen.getByText("Catalog data")).toBeInTheDocument();
    expect(screen.getByText("trust8004 catalog + marketplace observation Worker")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Agent comparison" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View .* on trust8004/i })).toHaveAttribute(
      "href",
      "https://trust8004.xyz/agents/56:45650",
    );

    await user.click(screen.getByRole("tab", { name: "Table" }));
    const comparisonTable = screen.getByRole("table", { name: "Agent comparison" });
    expect(comparisonTable).toBeInTheDocument();
    expect(comparisonTable.querySelector(".border-l-primary")).toBeNull();
    expect(comparisonTable.querySelector("[data-evidence-status]")).toHaveClass("size-8");
    expect(screen.getByRole("region", { name: "Scrollable agent comparison" })).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("columnheader", { name: "Evidence" })).toHaveClass("text-xs");
    expect(screen.getByRole("link", { name: /View V3 Pools powered by HeyAnon on trust8004/i })).toHaveTextContent("Agent #45650");
    expect(screen.getByRole("button", { name: "Not available" })).toBeDisabled();
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("Each child in a list should have a unique \"key\" prop");
    consoleError.mockRestore();
  });

  it("renders combined filters, a clear action, and an agents-specific loading skeleton", () => {
    const page: MarketplaceAgentPage = {
      view: "marketplace",
      items: [],
      pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };

    render(createElement(CatalogPage, {
      data: page,
      query: {
        view: "marketplace",
        statuses: ["declared"],
        protocols: ["a2a"],
        categories: ["grid_trading", "rebalancing"],
      },
    }));

    expect(screen.getAllByRole("checkbox", { name: "Declared endpoints" }).every((item) => item.getAttribute("data-state") === "checked")).toBe(true);
    expect(screen.getAllByRole("checkbox", { name: "A2A" }).every((item) => item.getAttribute("data-state") === "checked")).toBe(true);
    expect(screen.getAllByRole("checkbox", { name: "Grid trading" }).every((item) => item.getAttribute("data-state") === "checked")).toBe(true);
    expect(screen.getAllByRole("checkbox", { name: "Rebalancing" }).every((item) => item.getAttribute("data-state") === "checked")).toBe(true);
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(3);
    expect(screen.getByTestId("catalog-quick-filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reachable now/ })).toHaveAttribute("aria-pressed", "false");

    cleanup();
    render(createElement(AgentsLoading));
    expect(screen.getByRole("status", { name: "Loading agents" })).toBeInTheDocument();
    expect(screen.getByTestId("agents-loading-results")).toBeInTheDocument();
  });

  it("allows clearing the last evidence filter and shows global counts beside every filter", async () => {
    const user = userEvent.setup();
    const page: MarketplaceAgentPage = {
      view: "marketplace",
      items: [marketplaceAgent()],
      pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };
    routerPush.mockClear();
    render(createElement(CatalogPage, {
      data: page,
      filterCounts: {
        statuses: {
          declared: 30_024,
          pending: 29_998,
          a2a: 4,
          mcp: 2,
          mcp_only: 1,
          erc8183: 13,
          quote_capable: 1,
          hireable: 1,
          failed: 3,
        },
        categories: {
          rebalancing: 5,
          grid_trading: 7,
          yield_optimisation: 3,
          health_factor_monitoring: 2,
        },
        reachability: { live: 9_999, historical: 8, never: 7, browser_observed: 1 },
        },
      query: { view: "marketplace", statuses: ["declared"] },
    }));

    expect(screen.getAllByText("30,024")).toHaveLength(2);
    expect(screen.getAllByText("7")).toHaveLength(2);
    expect(screen.getAllByText("9,999")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Reachable now 9,999/ })).toBeInTheDocument();
    await user.click(screen.getAllByRole("checkbox", { name: "Declared endpoints" })[0]!);
    expect(routerPush).toHaveBeenCalledWith("/agents?view=marketplace");
  });

  it("removes the final quick status without replacing it or dropping other groups", async () => {
    const user = userEvent.setup();
    routerPush.mockClear();
    const page: MarketplaceAgentPage = { view: "marketplace", items: [], pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 }, categories: [], catalogCoverage: "partial", fetchedAt: "2026-08-17T00:00:00.000Z" };
    render(createElement(CatalogPage, { data: page, query: { view: "marketplace", statuses: ["requestable"], protocols: ["mcp"], q: "grid" } }));
    await user.click(screen.getByRole("button", { name: /^Can request quote/ }));
    expect(routerPush).toHaveBeenCalledWith("/agents?view=marketplace&protocol=mcp&q=grid");
  });

  it("shows result skeletons while applying a second evidence filter", async () => {
    const user = userEvent.setup();
    const page: MarketplaceAgentPage = {
      view: "marketplace",
      items: [marketplaceAgent()],
      pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };
    routerPush.mockClear();
    render(createElement(CatalogPage, { data: page, query: { view: "marketplace", statuses: ["declared"] } }));

    await user.click(screen.getAllByRole("checkbox", { name: "A2A" })[0]!);

    expect(routerPush).toHaveBeenCalledWith("/agents?view=marketplace&status=declared&protocol=a2a");
    expect(screen.getByRole("status", { name: "Loading agents" })).toBeInTheDocument();
    expect(screen.queryByText("V3 Pools powered by HeyAnon")).not.toBeInTheDocument();
  });

  it("preserves the real-time reachability filter alongside status filters", async () => {
    const user = userEvent.setup();
    const page: MarketplaceAgentPage = {
      view: "marketplace",
      items: [marketplaceAgent()],
      pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };
    routerPush.mockClear();
    render(createElement(CatalogPage, {
      data: page,
      query: { view: "marketplace", statuses: ["declared"], reachability: ["live"] },
    }));

    expect(screen.getAllByRole("checkbox", { name: "Reachable now" }).every((item) => item.getAttribute("data-state") === "checked")).toBe(true);
    expect(screen.getByRole("button", { name: /Reachable now/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getAllByRole("checkbox", { name: "MCP" })[0]!);
    expect(routerPush).toHaveBeenCalledWith("/agents?view=marketplace&status=declared&reachability=live&protocol=mcp");
  });

  it("searches while typing with one focus border and preserves active filters", () => {
    vi.useFakeTimers();
    const page: MarketplaceAgentPage = {
      view: "marketplace",
      items: [marketplaceAgent()],
      pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };
    routerReplace.mockClear();
    render(createElement(CatalogPage, {
      data: page,
      query: {
        view: "marketplace",
        statuses: ["declared", "a2a"],
        categories: ["grid_trading"],
        reachability: ["live"],
      },
    }));
    const search = screen.getByRole("textbox", { name: "Search agents" });

    expect(search).toHaveClass("catalog-search-input", "focus-visible:ring-0");
    expect(search).not.toHaveClass("focus-visible:ring-inset");
    fireEvent.change(search, { target: { value: "grid" } });
    expect(routerReplace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));

    expect(routerReplace).toHaveBeenCalledWith("/agents?view=marketplace&status=declared&status=a2a&category=grid_trading&reachability=live&q=grid");
    expect(screen.getByRole("status", { name: "Loading agents" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("resets the reactive search when the server query is cleared", () => {
    const page: MarketplaceAgentPage = {
      view: "marketplace",
      items: [],
      pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };
    const { rerender } = render(createElement(CatalogPage, {
      data: page,
      query: { view: "marketplace", statuses: ["declared"], q: "grid" },
    }));
    expect(screen.getByRole("textbox", { name: "Search agents" })).toHaveValue("grid");

    rerender(createElement(CatalogPage, {
      data: page,
      query: { view: "marketplace", statuses: ["declared"] },
    }));

    expect(screen.getByRole("textbox", { name: "Search agents" })).toHaveValue("");
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

  it("keeps ERC-8004 profile details out of the marketplace hiring route", () => {
    const agent = marketplaceAgent();
    agent.endpointObservation.status = "observed_ok";
    render(createElement(AgentProfile, { agent, passport: evidencePassport("registered") }));
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Agents" })).toHaveAttribute("href", "/agents");
    expect(within(breadcrumb).getByText("V3 Pools powered by HeyAnon")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: agent.name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Identity & reputation/i })).toBeInTheDocument();
    expect(screen.queryByText(/Curated liquidity-management signal/)).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Services" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Reputation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Technical" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("complementary", { name: "Network context" })).not.toBeInTheDocument();

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

  it("requests Mainnet quotes only after the buyer asks and supports refreshing them", async () => {
    const user = userEvent.setup();
    const quote = {
      schemaVersion: 1,
      agentId: "303779",
      endpoint: "https://seller.example/a2a",
      provider: "0x2222222222222222222222222222222222222222",
      commerce: "0x3333333333333333333333333333333333333333",
      token: "0x4444444444444444444444444444444444444444",
      tokenSymbol: "USDT",
      tokenDecimals: 18,
      priceRaw: "1",
      priceDisplay: "0.000000000000000001",
      quoteExpiresAt: 1_950_000_600,
      envelope: {},
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Seller timed out safely." } }), {
        status: 504,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...quote, observationSync: { status: "failed" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValue(new Response(JSON.stringify({ ...quote, observationSync: { status: "synced" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true, writable: true });
    render(createElement(Providers, { children: createElement(Erc8183MainnetDemo, { config: {
      agentId: 303779,
      seller: "0x2222222222222222222222222222222222222222",
      commerce: "0x3333333333333333333333333333333333333333",
      router: "0x5555555555555555555555555555555555555555",
      policy: "0x6666666666666666666666666666666666666666",
      token: "0x4444444444444444444444444444444444444444",
      maximumBudgetRaw: "10",
      rpcUrl: "https://bsc-rpc.publicnode.com",
      explorerUrl: "https://bscscan.com",
      sellerOrigin: "https://seller.example",
    }, agentName: "Marketplace Grid Planner" }) }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /get fresh quote/i }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/marketplace/demo/erc8183-mainnet/quote", expect.objectContaining({ method: "POST" }));
    // The click itself is reported as sanitized telemetry through the same-origin
    // route, never with buyer, session or request context.
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [beaconUrl, beaconBody] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(beaconUrl).toBe("/api/marketplace/hire-events");
    expect(beaconBody.type).toBe("application/json");
    expect(JSON.parse(await beaconBody.text())).toEqual({ agentId: "303779", chainId: 56, phase: "clicked", jobId: null, txHash: null });
    expect(await screen.findByText("Seller timed out safely.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try quote again/i }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const refresh = await screen.findByRole("button", { name: /request fresh quote/i });
    expect(screen.getByText("Quote verified for this session. Shared evidence sync pending.")).toBeInTheDocument();
    expect(screen.getByText("Quote verified", { selector: "span" })).toBeInTheDocument();
    await user.click(refresh);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await screen.findByText("Shared evidence updated")).toBeInTheDocument();
  });

  it("hydrates safely when an authorized wallet is restored before the first client render", async () => {
    walletState.address = null;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tree = createElement(Providers, { children: createElement(Erc8183MainnetDemo, {
      config: MAINNET_DEMO_CONFIG,
      agentName: "Marketplace Grid Planner",
    }) });
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    expect(container.textContent).toContain("Connect a wallet in the header");
    walletState.address = "0x7777777777777777777777777777777777777777";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot>;

    await act(async () => {
      root = hydrateRoot(container, tree);
    });

    const hydrationErrors = consoleError.mock.calls.flat().join(" ");
    expect(hydrationErrors).not.toMatch(/hydration failed|did not match|hydration mismatch/i);
    expect(within(container).getByRole("button", { name: /prepare hire as/i })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    consoleError.mockRestore();
  });

  it("shows indexed Commerce state in the hero panel with links into the ledger", () => {
    render(createElement(MarketplaceLanding, {
      categories: [],
      demoEnabled: true,
      featuredAgents: [],
      funnel: null,
      ledgerPulse: {
        network: "ERC-8183 Commerce · BSC Mainnet",
        jobsIndexed: "56,716",
        jobsIndexedCount: 56716,
        processedHere: "1",
        indexedThrough: { blockNumber: "120,146,010", ago: "12s ago" },
        window: { days: 7, created: "1,048", settled: "730", refunded: "9" },
        recent: [
          { jobId: "56713", status: "COMPLETED", href: "/jobs/mainnet/56713", buyerShort: "0x5ee7…0b1c", updatedAgo: "2m ago", marketplace: true },
          { jobId: "56712", status: "FUNDED", href: "/jobs/mainnet/56712", buyerShort: "0x1234…abcd", updatedAgo: "15m ago", marketplace: false },
        ],
      },
      publicProof: [],
      qualifiedSeller: null,
    }));

    expect(screen.getByText("LIVE")).toBeInTheDocument();
    const pulse = screen.getByLabelText(/Indexed ERC-8183 Commerce state/);
    expect(pulse).toHaveTextContent("56,716 jobs indexed");
    expect(pulse).toHaveTextContent("1,048 created · 730 settled · 9 refunded");
    expect(pulse).toHaveTextContent("block 120,146,010 · 12s ago");
    expect(screen.getByRole("link", { name: /Job #56713 · buyer 0x5ee7…0b1c · hired here/ })).toHaveAttribute("href", "/jobs/mainnet/56713");
    expect(screen.getByRole("link", { name: /Job #56712 · buyer 0x1234…abcd$/ })).toHaveAttribute("href", "/jobs/mainnet/56712");
    expect(screen.getByRole("link", { name: "All indexed jobs" })).toHaveAttribute("href", "/jobs");
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.getByLabelText("Indexed marketplace ledger feed").textContent).not.toMatch(/proven|track record/i);
  });

  it("marks the feed offline instead of showing zeros when the ledger cannot be read", () => {
    render(createElement(MarketplaceLanding, {
      categories: [],
      demoEnabled: true,
      featuredAgents: [],
      funnel: null,
      ledgerPulse: null,
      publicProof: [],
      qualifiedSeller: null,
    }));

    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/indexer unreachable/);
    expect(screen.queryByRole("link", { name: "All indexed jobs" })).not.toBeInTheDocument();
    expect(screen.queryByText(/jobs indexed/)).not.toBeInTheDocument();
  });

  it("does not claim Mainnet has no seller while Grid has quote-capability evidence", () => {
    render(createElement(MarketplaceLanding, {
      categories: [],
      demoEnabled: true,
      featuredAgents: [],
      funnel: null,
      publicProof: [],
      qualifiedSeller: null,
    }));

    expect(screen.queryByText(/no Mainnet seller/i)).not.toBeInTheDocument();
    expect(screen.getByText(/current quote-capability evidence.*Grid seller/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore Mainnet agents" })).toHaveAttribute("href", "/agents?view=marketplace&category=grid_trading");
    expect(screen.queryByText(/Try a verified Testnet hire/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/BSC Testnet.*Job #551/i)).not.toBeInTheDocument();
  });

  it("shows the historical Testnet journey only for a wallet connected to chain 97", async () => {
    walletState.address = "0x7777777777777777777777777777777777777777";
    walletState.chainId = 97;
    render(createElement(MarketplaceLanding, {
      categories: [],
      demoEnabled: true,
      featuredAgents: [],
      funnel: null,
      publicProof: [],
      qualifiedSeller: null,
    }));

    expect(await screen.findByRole("link", { name: /Try a verified Testnet hire/i })).toHaveAttribute("href", "/demo/erc8183");
    expect(screen.getByText(/BSC Testnet.*Job #551/i)).toBeInTheDocument();
    expect(screen.queryByText("BSC Mainnet · chain 56")).not.toBeInTheDocument();
  });

  it("keeps Mainnet as the default on unsupported chains", () => {
    walletState.address = "0x7777777777777777777777777777777777777777";
    walletState.chainId = 1;
    render(createElement(MarketplaceLanding, {
      categories: [],
      demoEnabled: true,
      featuredAgents: [],
      funnel: null,
      publicProof: [],
      qualifiedSeller: null,
    }));

    expect(screen.getByText("BSC Mainnet · chain 56")).toBeInTheDocument();
    expect(screen.queryByText(/BSC Testnet.*Job #551/i)).not.toBeInTheDocument();
  });

  it("hydrates the Mainnet default safely before revealing a restored Testnet wallet", async () => {
    walletState.address = null;
    walletState.chainId = 56;
    const tree = createElement(MarketplaceLanding, {
      categories: [],
      demoEnabled: true,
      featuredAgents: [],
      funnel: null,
      publicProof: [],
      qualifiedSeller: null,
    });
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    expect(container.textContent).toContain("BSC Mainnet · chain 56");
    walletState.address = "0x7777777777777777777777777777777777777777";
    walletState.chainId = 97;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot>;

    await act(async () => {
      root = hydrateRoot(container, tree);
    });

    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/hydration failed|did not match|hydration mismatch/i);
    await waitFor(() => expect(within(container).getByText(/BSC Testnet.*Job #551/i)).toHaveTextContent("BSC Testnet · Job #551"));
    await act(async () => root!.unmount());
    consoleError.mockRestore();
  });

  it("invalidates the previous prepared plan when a quote refresh fails", async () => {
    const user = userEvent.setup();
    walletState.address = "0x7777777777777777777777777777777777777777";
    const quote = mainnetQuote({ quoteExpiresAt: Math.floor(Date.now() / 1_000) + 600 });
    const plan = mainnetPlan(quote);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(quote))
      .mockResolvedValueOnce(jsonResponse(plan))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Seller timed out safely." } }, 504));
    vi.stubGlobal("fetch", fetchMock);
    renderMainnetDemo();

    await user.click(screen.getByRole("button", { name: /get fresh quote/i }));
    await user.click(await screen.findByRole("button", { name: /prepare hire as/i }));
    expect(await screen.findByText(/maximum signatures/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /request fresh quote/i }));
    expect(await screen.findByText("Seller timed out safely.")).toBeInTheDocument();
    expect(screen.queryByText(/maximum signatures/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect a wallet in the header|prepare hire as/i })).toBeDisabled();
  });

  it("marks an expired quote and blocks preparing or signing it", async () => {
    const user = userEvent.setup();
    walletState.address = "0x7777777777777777777777777777777777777777";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(mainnetQuote({
      quoteExpiresAt: Math.floor(Date.now() / 1_000) - 1,
    }))));
    renderMainnetDemo();

    await user.click(screen.getByRole("button", { name: /get fresh quote/i }));
    expect(await screen.findByText(/quote expired/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prepare hire as/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /wallet approval/i })).toBeDisabled();
  });

  it("resumes original funded job with an expired, different quote without preparing or sending transactions", async () => {
    const user = userEvent.setup();
    const buyer = "0x7777777777777777777777777777777777777777" as const;
    walletState.address = buyer;
    localStorage.setItem("bnb-agent-marketplace:erc8183-browser:56:303779:v1", JSON.stringify({
      schemaVersion: 1, chainId: 56, buyer, seller: MAINNET_DEMO_CONFIG.seller,
      jobId: "42", quoteRequestId: 17, transactions: {}, lastConfirmedStep: "funded",
    }));
    const quote = mainnetQuote({ quoteExpiresAt: Math.floor(Date.now() / 1_000) - 60, priceRaw: "2" });
    const previousJob = { ...mainnetJob("FUNDED"), evaluator: quote.router };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ job: previousJob })));
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(Providers, { children: createElement(Erc8183MarketplaceHire, { quote: { ...quote, chainId: 56, observationSync: { status: "synced" } }, quoteRequestId: 99 }) }));
    const resume = await screen.findByRole("button", { name: "Resume job #42" });
    expect(resume).toBeEnabled();
    await user.click(resume);
    expect(screen.queryByText(/Recovered chain state|older job|not funded/)).not.toBeInTheDocument();
    await waitFor(() => expect(document.body.textContent).toContain("Resumed job #42 · FUNDED"));
    await user.click(screen.getByRole("button", { name: "Retry seller notification" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      "/api/marketplace/agents/303779/hire/jobs/42?quoteRequestId=17",
      "/api/marketplace/agents/303779/hire/jobs/42?quoteRequestId=17",
      "/api/marketplace/agents/303779/hire/notify",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual({ buyer, jobId: "42", quoteRequestId: 17 });
    expect(walletState.switchChainAsync).not.toHaveBeenCalled();
    expect(screen.queryByText("Confirmed onchain")).not.toBeInTheDocument();
  });

  it("offers saved funded recovery after reload without any buyer quote", async () => {
    walletState.address = "0x7777777777777777777777777777777777777777";
    localStorage.setItem("bnb-agent-marketplace:erc8183-browser:56:303779:v1", JSON.stringify({
      schemaVersion: 1, chainId: 56, buyer: walletState.address, seller: MAINNET_DEMO_CONFIG.seller,
      jobId: "42", quoteRequestId: 17, transactions: {}, lastConfirmedStep: "funded",
    }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ job: { ...mainnetJob("FUNDED"),
      evaluator: ERC8183_MAINNET.router, policy: ERC8183_MAINNET.policy, quotedToken: ERC8183_MAINNET.token } }));
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(Providers, { children: createElement(Erc8183SavedHire, { agentId: "303779" }) }));
    await userEvent.click(await screen.findByRole("button", { name: "Resume job #42" }));
    expect(await screen.findByText(/Resumed job #42 · FUNDED/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("quoteRequestId=17");
    expect(screen.queryByRole("button", { name: /request quote|prepare hire/i })).not.toBeInTheDocument();
  });

  it.each(["FUNDED", "SUBMITTED", "COMPLETED"] as const)("does not restore a saved %s job into a new quote", async (status) => {
    vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
    const user = userEvent.setup();
    const buyer = "0x7777777777777777777777777777777777777777" as const;
    walletState.address = buyer;
    localStorage.setItem("bnb-agent-marketplace:erc8183-browser:56:303779:v1", JSON.stringify({
      schemaVersion: 1,
      chainId: 56,
      buyer,
      seller: "0x2222222222222222222222222222222222222222",
      jobId: "42",
      transactions: { createJob: `0x${"12".repeat(32)}` },
      lastConfirmedStep: "submitted",
    }));
    const quote = mainnetQuote({ quoteExpiresAt: Math.floor(Date.now() / 1_000) + 600 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(quote))
      .mockResolvedValueOnce(jsonResponse(mainnetPlan(quote)));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderMainnetDemo();

    expect(await screen.findByRole("button", { name: "Resume job #42" })).toBeEnabled();
    expect(screen.queryByText(`Current state: ${status}`)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /get fresh quote/i }));
    expect(localStorage.getItem("bnb-agent-marketplace:erc8183-browser:56:303779:v1")).not.toBeNull();
    await user.click(await screen.findByRole("button", { name: /prepare hire as/i }));
    expect(await screen.findByRole("button", { name: /begin \d+ wallet approval/i })).toBeEnabled();
    expect(screen.queryByText("Confirmed onchain")).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(jsonResponse({ job: { ...mainnetJob(status), description: quote.description, evaluator: quote.router, budgetRaw: quote.priceRaw, quotedPriceRaw: quote.priceRaw } }));
    await user.click(screen.getByRole("button", { name: "Resume job #42" }));
    expect(await screen.findByText(new RegExp(`Resumed job #42 · ${status}`))).toBeInTheDocument();
    expect(screen.queryByText("Confirmed onchain")).not.toBeInTheDocument();
    if (status === "FUNDED") {
      const fundedJob = { ...mainnetJob(status), description: quote.description, evaluator: quote.router, budgetRaw: quote.priceRaw, quotedPriceRaw: quote.priceRaw };
      fetchMock.mockResolvedValueOnce(jsonResponse({ job: fundedJob }))
        .mockResolvedValueOnce(jsonResponse({ error: { message: "Seller unavailable" } }, 503));
      const beforeRetry = fetchMock.mock.calls.length;
      await user.click(screen.getByRole("button", { name: "Retry seller notification" }));
      expect(await screen.findByText(/Seller unavailable/)).toBeInTheDocument();
      expect(fetchMock.mock.calls.slice(beforeRetry).map(call => String(call[0]))).toEqual([
        "/api/marketplace/jobs/mainnet/42", "/api/marketplace/demo/erc8183-mainnet/notify",
      ]);
    }
    walletState.address = "0x8888888888888888888888888888888888888888";
    view.rerender(createElement(Providers, { children: createElement(Erc8183MainnetDemo, { config: MAINNET_DEMO_CONFIG, agentName: "Marketplace Grid Planner" }) }));
    expect(screen.queryByText(new RegExp(`Resumed job #42 · ${status}`))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume job #42" })).toBeDisabled();
    view.unmount();
    renderMainnetDemo();
    expect(screen.queryByText("Confirmed onchain")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume job #42" })).toBeDisabled();
  });

  it.each([
    ["synced", "Shared evidence updated"],
    ["duplicate", "Shared evidence updated"],
    ["failed", "Quote verified for this session. Shared evidence sync pending."],
    ["not_configured", "Quote verified for this session. Shared evidence sync pending."],
  ] as const)("maps %s evidence sync to buyer-safe copy", (status, expected) => {
    expect(sharedEvidenceSyncMessage({ status })).toBe(expected);
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

    expect(screen.getByText("Confirmed onchain")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view createJob transaction/i })).toHaveAttribute("href", `https://bscscan.com/tx/${hash}`);
  });

  it("distinguishes planned and submitted wallet calls from confirmed receipts", () => {
    const hash = `0x${"34".repeat(32)}` as const;
    render(createElement(Erc8183TransactionList, {
      explorerUrl: "https://bscscan.com",
      intents: [
        {
          kind: "createJob",
          contract: "0x1111111111111111111111111111111111111111",
          purpose: "Create the job",
          required: true,
        },
        {
          kind: "approve",
          contract: "0x2222222222222222222222222222222222222222",
          purpose: "Approve exact funding",
          required: true,
        },
        {
          kind: "fund",
          contract: "0x3333333333333333333333333333333333333333",
          purpose: "Fund escrow",
          required: false,
        },
      ],
      journal: {
        schemaVersion: 1,
        chainId: 56,
        buyer: "0x4444444444444444444444444444444444444444",
        seller: "0x5555555555555555555555555555555555555555",
        jobId: null,
        transactions: { createJob: hash },
        lastConfirmedStep: "connected",
      },
    }));

    expect(screen.getByText(/These are the exact calls the wallet may execute/)).toBeInTheDocument();
    expect(screen.getByText("Sent · awaiting confirmation")).toBeInTheDocument();
    expect(screen.getByText("Not sent")).toBeInTheDocument();
    expect(screen.getByText("Not required")).toBeInTheDocument();
  });

  it("renders the Job 551 proof with complete hashes when live RPC is unavailable", async () => {
    render(createElement(TestnetJobTracker, {
      tracking: { liveStatus: "unavailable", job: null, snapshot: GATE6A_JOB_551_MANIFEST, verifiedPhases: [], buyerIdentity: UNKNOWN_BUYER },
    }));
    expect(screen.getByRole("heading", { name: "ERC-8183 Job #551" })).toBeInTheDocument();
    expect(screen.getByText("Live chain check unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Hired by an agent")).not.toBeInTheDocument();
    expect(screen.getByText(GATE6A_JOB_551_MANIFEST.transactions.createJob.hash)).toBeInTheDocument();
    expect(screen.getByText(GATE6A_JOB_551_MANIFEST.transactions.submit.hash)).toBeInTheDocument();
    expect(screen.getByText(GATE6A_JOB_551_MANIFEST.deliverable.content)).toBeInTheDocument();
    expect(screen.queryByText("Chain-verified hire phases")).not.toBeInTheDocument();
    const result = await axe.run(document.body);
    expect(result.violations).toEqual([]);
  });

  it("lists chain-verified hire phases with their Testnet transaction links", async () => {
    const txHash = `0x${"cd".repeat(32)}` as const;
    render(createElement(TestnetJobTracker, {
      tracking: {
        liveStatus: "unavailable",
        job: null,
        snapshot: GATE6A_JOB_551_MANIFEST,
        verifiedPhases: [{
          chainId: 97, agentId: "1866", phase: "funded", jobId: "551", txHash,
          blockNumber: "70000001", occurredAt: "2026-09-01T12:00:00.000Z", verifiedAt: null,
        }],
        buyerIdentity: UNKNOWN_BUYER,
      },
    }));
    expect(screen.getByText("Chain-verified hire phases")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Chain-verified hire phases for Testnet Job 551" });
    expect(within(list).getByRole("link")).toHaveAttribute("href", `https://testnet.bscscan.com/tx/${txHash}`);
    expect(within(list).getByText("funded")).toBeInTheDocument();
    const result = await axe.run(document.body);
    expect(result.violations).toEqual([]);
  });

  it("labels an agent-initiated job as delegation with chain-resolved facts only", async () => {
    const registry = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
    const { rerender } = render(createElement(TestnetJobTracker, {
      tracking: {
        liveStatus: "unavailable", job: null, snapshot: GATE6A_JOB_551_MANIFEST, verifiedPhases: [],
        buyerIdentity: { kind: "demo_agent", agentId: "7", verified: true, registry },
      },
    }));
    expect(screen.getByText("Hired by an agent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ERC-8004 #7 · registry wallet verified/ }))
      .toHaveAttribute("href", `https://testnet.bscscan.com/token/${registry}?a=7`);

    rerender(createElement(TestnetJobTracker, {
      tracking: {
        liveStatus: "unavailable", job: null, snapshot: GATE6A_JOB_551_MANIFEST, verifiedPhases: [],
        buyerIdentity: { kind: "demo_agent", agentId: null, verified: false, registry: null },
      },
    }));
    expect(screen.getByText("Hired by an agent")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /registry wallet verified/ })).not.toBeInTheDocument();
    expect(screen.getByText("Demo agent-buyer wallet · no ERC-8004 identity declared")).toBeInTheDocument();
    const result = await axe.run(document.body);
    expect(result.violations).toEqual([]);
  });
});

const UNKNOWN_BUYER = { kind: "unknown" as const, agentId: null, verified: false, registry: null };
