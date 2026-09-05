import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogCandidate } from "../src/business/entities/catalog-candidate.ts";

const { executePassport, executeConfig, executeHireJobs, profileProps, renderDemo, redirectRoute } = vi.hoisted(() => ({
  executePassport: vi.fn(),
  executeConfig: vi.fn(),
  executeHireJobs: vi.fn(),
  profileProps: vi.fn(),
  renderDemo: vi.fn(),
  redirectRoute: vi.fn(),
}));

vi.mock("@/src/business/composition", () => ({
  getAgentEvidencePassport: { executeWithAgent: executePassport },
  getMainnetBrowserDemoConfig: { execute: executeConfig },
  listAgentHireJobs: { execute: executeHireJobs },
}));

vi.mock("@/components/spikes/erc8183-browser-spike", () => ({
  Erc8183MainnetDemo: () => {
    renderDemo();
    return null;
  },
}));

vi.mock("@/components/marketplace/agent-profile", () => ({
  marketplaceAgentDisplayName: (name: string) => name,
  AgentProfile: (props: {
    catalogCandidate: CatalogCandidate;
    hireFlow?: ReturnType<typeof createElement> | null;
  }) => {
    profileProps(props);
    const { catalogCandidate, hireFlow } = props;
    return createElement("main", {},
      catalogCandidate.state?.buyerAction === "check_availability"
        && (catalogCandidate.state.canRequestBrowserValidation
          || catalogCandidate.state.canRequestInfrastructureValidation)
        ? createElement("a", { href: "#validation" }, "Hire agent")
        : null,
      hireFlow,
    );
  },
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

const INDEXED_JOB = {
  chainId: 56 as const, jobId: "56696", buyer: "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52" as const,
  provider: "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5" as const, budgetRaw: "10000000000000000", status: "COMPLETED" as const,
  expiresAt: "2026-09-03T12:00:00.000Z", submittedAt: null, marketplace: true, updatedAt: "2026-09-03T12:00:00.000Z",
};

const ACTIVITY = {
  chainId: 56 as const, days: 30, from: "2026-08-04T12:00:00.000Z", to: "2026-09-03T12:00:00.000Z",
  byDay: [{ day: "2026-09-01", created: 1, funded: 1, submitted: 0, settled: 0, refunded: 0 }],
  totals: { created: 1, funded: 1, submitted: 0, settled: 0, refunded: 0 },
};

describe("hire page normalized commerce gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeConfig.mockReturnValue({ agentId: 303779 });
    executeHireJobs.mockResolvedValue({ jobs: [INDEXED_JOB], nextBefore: "56600", scope: "wallet", activity: ACTIVITY });
  });

  it("hands the indexed ledger page, its cursor, its scope and its activity window to the profile", async () => {
    await render(state());

    expect(executeHireJobs).toHaveBeenCalledWith({ agent: expect.objectContaining({ agentId: "303779" }) });
    expect(profileProps).toHaveBeenCalledWith(expect.objectContaining({
      hireJobs: [expect.objectContaining({ jobId: "56696" })],
      hireJobsMore: true,
      hireJobsScope: "wallet",
      hireActivity: ACTIVITY,
    }));
  });

  it("passes a missing activity window as null without hiding the jobs", async () => {
    executeHireJobs.mockResolvedValue({ jobs: [INDEXED_JOB], nextBefore: null, scope: "wallet", activity: null });

    await render(state());

    expect(profileProps).toHaveBeenCalledWith(expect.objectContaining({
      hireJobs: [expect.objectContaining({ jobId: "56696" })],
      hireActivity: null,
    }));
  });

  it("tells the profile the ledger is unavailable rather than empty", async () => {
    executeHireJobs.mockResolvedValue(null);

    await render(state());

    expect(profileProps).toHaveBeenCalledWith(expect.objectContaining({ hireJobs: null, hireJobsMore: false, hireJobsScope: "agent", hireActivity: null }));
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

  it("does not mount the ERC-8183 flow while admission is pending", async () => {
    await render(state({
      commerceStatus: "admission_pending",
      buyerAction: "request_quote",
      canRequestQuote: true,
      blockingReasons: ["COMMERCE_NOT_ADMITTED"],
    }));

    expect(renderDemo).not.toHaveBeenCalled();
  });

  it("fails closed when request_quote contradicts canRequestQuote=false", async () => {
    await render(state({ buyerAction: "request_quote", canRequestQuote: false }));

    expect(renderDemo).not.toHaveBeenCalled();
  });

  it("fails closed when request_quote contradicts a suspended commerce state", async () => {
    await render(state({ commerceStatus: "suspended", buyerAction: "request_quote", canRequestQuote: true }));

    expect(renderDemo).not.toHaveBeenCalled();
  });

  it("mounts the ERC-8183 flow for a coherent admitted request_quote state", async () => {
    await render(state());

    expect(renderDemo).toHaveBeenCalledOnce();
  });

  it("offers the real validation destination for check_availability", async () => {
    const markup = await render(state({
      commerceStatus: "declared",
      buyerAction: "check_availability",
      canRequestQuote: false,
      blockingReasons: ["COMMERCE_NOT_ADMITTED"],
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
      blockingReasons: ["COMMERCE_NOT_ADMITTED"],
    }));

    expect(markup).not.toContain("Hire agent");
  });

  it("does not render a self-link when the configured seller does not match", async () => {
    executeConfig.mockReturnValue({ agentId: 99 });

    const markup = await render(state());

    expect(renderDemo).not.toHaveBeenCalled();
    expect(markup).not.toContain("Try again");
  });
});
