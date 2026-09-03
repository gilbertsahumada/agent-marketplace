import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogCandidate } from "../src/business/entities/catalog-candidate.ts";

const { executePassport, executeConfig, renderDemo } = vi.hoisted(() => ({
  executePassport: vi.fn(),
  executeConfig: vi.fn(),
  renderDemo: vi.fn(),
}));

vi.mock("@/src/business/composition", () => ({
  getAgentEvidencePassport: { executeWithAgent: executePassport },
  getMainnetBrowserDemoConfig: { execute: executeConfig },
}));

vi.mock("@/components/spikes/erc8183-browser-spike", () => ({
  Erc8183MainnetDemo: () => {
    renderDemo();
    return null;
  },
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: HirePage } = await import("../app/hire/[agentId]/page.tsx");

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

    expect(markup).toContain('href="/agents/303779#validation"');
    expect(markup).toContain("Check availability");
  });

  it("does not render a self-link when the configured seller does not match", async () => {
    executeConfig.mockReturnValue({ agentId: 99 });

    const markup = await render(state());

    expect(renderDemo).not.toHaveBeenCalled();
    expect(markup).not.toContain("Try again");
  });
});
