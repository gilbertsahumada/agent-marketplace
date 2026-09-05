import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogCandidate } from "../src/business/entities/catalog-candidate.ts";

const { executePassport, executeConfig, renderDemo, redirectRoute, executeJobs } = vi.hoisted(() => ({
  executePassport: vi.fn(),
  executeConfig: vi.fn(),
  renderDemo: vi.fn(),
  redirectRoute: vi.fn(),
  executeJobs: vi.fn(async () => ({ jobs: [], nextBefore: null, scope: "wallet" })),
}));

vi.mock("@/src/business/composition", () => ({
  getAgentEvidencePassport: { executeWithAgent: executePassport },
  getMainnetBrowserDemoConfig: { execute: executeConfig },
  listAgentHireJobs: { execute: executeJobs },
}));

vi.mock("@/components/spikes/erc8183-browser-spike", () => ({
  Erc8183MainnetDemo: () => {
    renderDemo();
    return null;
  },
}));

vi.mock("@/components/marketplace/quote-request-panel", () => ({
  QuoteRequestPanel: ({ checkCompatibilityFirst }: { checkCompatibilityFirst?: boolean }) => {
    renderDemo();
    return createElement("section", {}, checkCompatibilityFirst ? "Check compatibility panel" : "Quote request panel");
  },
}));

vi.mock("@/components/marketplace/agent-profile", () => ({
  marketplaceAgentDisplayName: (name: string) => name,
  AgentProfile: ({ catalogCandidate, hireFlow }: {
    catalogCandidate: CatalogCandidate;
    hireFlow?: ReturnType<typeof createElement> | null;
  }) => createElement("main", {},
    catalogCandidate.state?.buyerAction === "check_availability"
      && (catalogCandidate.state.canRequestBrowserValidation
        || catalogCandidate.state.canRequestInfrastructureValidation)
      ? createElement("a", { href: "#validation" }, "Hire agent")
      : null,
    hireFlow,
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectRoute,
  permanentRedirect: redirectRoute,
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: HirePage } = await import("../app/hire/[agentId]/page.tsx");
const { default: AgentPage } = await import("../app/agents/[agentId]/page.tsx");
const { default: PassportPage } = await import("../app/agents/[agentId]/passport/page.tsx");
const { default: MainnetDemoAliasPage } = await import("../app/demo/erc8183-mainnet/page.tsx");
const { default: Job514ProofAliasPage } = await import("../app/proof/job-514/page.tsx");

function candidate(state: NonNullable<CatalogCandidate["state"]>): CatalogCandidate {
  return {
    agentKey: "56:303779",
    agentId: "303779",
    chainId: 56,
    owner: "0x1111111111111111111111111111111111111111",
    metadataUri: "ipfs://agent",
    name: "Marketplace Grid planner",
    description: "Grid planner",
    imageUrl: null,
    categories: ["grid_trading"],
    marketplaceConfigured: true,
    metadataState: "ok",
    registeredAt: 1,
    blockNumber: "1",
    priority: 100,
    admission: {
      state: state?.commerceStatus === "suspended" ? "suspended" : state?.commerceStatus === "admitted" ? "admitted" : "candidate",
      endpointKey: "endpoint:a2a",
    },
    state,
    declarations: [{
      endpointKey: "endpoint:a2a",
      protocol: "a2a",
      declaredProtocol: "a2a",
      role: "operational",
      validationProtocol: "a2a",
      externalKind: null,
      eligibility: "eligible",
      endpoint: "https://seller.example.com/a2a",
      originKey: "https://seller.example.com",
      safety: "safe",
      safetyReason: null,
      representativeAgentKey: "56:303779",
      lastProbedAt: null,
      nextProbeAt: null,
      consecutiveFailures: 0,
      priority: 100,
    }],
    observations: [],
  };
}

function state(overrides: Partial<NonNullable<CatalogCandidate["state"]>> = {}): NonNullable<CatalogCandidate["state"]> {
  return {
    operationalStatus: "platform_reachable",
    freshness: "live",
    commerceStatus: "admitted",
    quoteStatus: "not_requested",
    buyerAction: "request_quote",
    canRequestBrowserValidation: true,
    canRequestInfrastructureValidation: true,
    canRequestQuote: true,
    canPrepareHire: false,
    blockingReasons: [],
    ...overrides,
  };
}

async function render(candidateState: NonNullable<CatalogCandidate["state"]>) {
  executePassport.mockResolvedValue({
    agent: { agentId: "303779", name: "Marketplace Grid planner" },
    catalogCandidate: candidate(candidateState),
  });
  const page = await HirePage({ params: Promise.resolve({ agentId: "303779" }) });
  return renderToStaticMarkup(page);
}

describe("hire page normalized commerce gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeConfig.mockReturnValue({ agentId: 303779 });
  });

  it("redirects the former profile route to the canonical hire journey", async () => {
    await AgentPage({ params: Promise.resolve({ agentId: "113284" }) });

    expect(redirectRoute).toHaveBeenCalledWith("/hire/113284");
  });

  it("redirects the former Passport page to the canonical hire journey", async () => {
    await PassportPage({ params: Promise.resolve({ agentId: "113284" }) });

    expect(redirectRoute).toHaveBeenCalledWith("/hire/113284");
  });

  it("redirects retired demo and proof aliases to their canonical destinations", async () => {
    MainnetDemoAliasPage();
    expect(redirectRoute).toHaveBeenCalledWith("/hire/303779");

    Job514ProofAliasPage();
    expect(redirectRoute).toHaveBeenCalledWith("/jobs/514");
  });

  it("does not mount the quote flow while the seller is suspended", async () => {
    await render(state({
      commerceStatus: "suspended",
      buyerAction: "unavailable",
      canRequestQuote: false,
      blockingReasons: ["NO_QUOTE_TRANSPORT"],
    }));

    expect(renderDemo).not.toHaveBeenCalled();
  });

  it("offers an explicit compatibility check instead of a quote when canRequestQuote=false", async () => {
    const markup = await render(state({ buyerAction: "request_quote", canRequestQuote: false }));
    expect(markup).toContain("Check compatibility panel");
    expect(markup).not.toContain("Quote request panel");
  });

  it("fails closed when request_quote contradicts a suspended commerce state", async () => {
    await render(state({ commerceStatus: "suspended", buyerAction: "request_quote", canRequestQuote: true }));

    expect(renderDemo).not.toHaveBeenCalled();
  });

  it("mounts the quote flow for a coherent request_quote state", async () => {
    await render(state());

    expect(renderDemo).toHaveBeenCalledOnce();
  });

  it("offers the real validation destination for check_availability", async () => {
    const markup = await render(state({
      commerceStatus: "declared",
      buyerAction: "check_availability",
      canRequestQuote: false,
      blockingReasons: ["NO_QUOTE_TRANSPORT"],
    }));

    expect(markup).toContain('href="#validation"');
    expect(markup).toContain("Hire agent");
  });

  it("fails closed when check_availability has no enabled validation capability", async () => {
    const markup = await render(state({
      commerceStatus: "declared",
      buyerAction: "check_availability",
      canRequestBrowserValidation: false,
      canRequestInfrastructureValidation: false,
      canRequestQuote: false,
      blockingReasons: ["NO_QUOTE_TRANSPORT"],
    }));

    expect(markup).not.toContain("Hire agent");
  });

  it("does not depend on a hardcoded seller when the configured demo changes", async () => {
    executeConfig.mockReturnValue({ agentId: 99 });

    const markup = await render(state());

    expect(renderDemo).toHaveBeenCalledOnce();
    expect(markup).toContain("Quote request panel");
  });
  it("scopes history queries to Testnet without changing the seller identity", async () => {
    await render(state());
    await HirePage({ params: Promise.resolve({ agentId: "303779" }), searchParams: Promise.resolve({ jobsNetwork: "testnet", jobsBefore: "42" }) });
    expect(executeJobs).toHaveBeenLastCalledWith({ agent: { agentId: "303779", name: "Marketplace Grid planner" }, chainId: 97, before: "42" });
  });
});
