// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validateEndpointInBrowser = vi.fn();
const refresh = vi.fn();
vi.mock("@/src/verification/browser-endpoint-validation", () => ({ validateEndpointInBrowser }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: null, isConnected: false, connector: null }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

const { AgentValidationActions } = await import("../components/marketplace/agent-validation-actions.tsx");
const { AgentProfile } = await import("../components/marketplace/agent-profile.tsx");
const { Erc8183MainnetDemo } = await import("../components/spikes/erc8183-browser-spike.tsx");
const { default: HireAgentLoading } = await import("../app/hire/[agentId]/loading.tsx");

describe("AgentValidationActions", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("runs only after buyer action and labels browser/CORS evidence honestly", async () => {
    validateEndpointInBrowser.mockResolvedValue({
      source: "browser_reported",
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
      outcome: "cors_blocked",
      observedAt: "2026-08-30T00:00:00.000Z",
      expiresAt: null,
      httpStatus: null,
      durationMs: 25,
      capabilityCount: 0,
      errorCode: "BROWSER_FETCH_BLOCKED",
      message: "The browser could not read this endpoint. This is not proof that the agent is unreachable.",
      method: "POST",
      cors: false,
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      validation: "accepted",
      persistence: "recorded",
    }, { status: 201 })));
    render(<AgentValidationActions agentId="45422" targets={[{
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
    }]} />);

    expect(validateEndpointInBrowser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /validate from browser/i }));
    await screen.findByText("cors blocked");
    expect(screen.getByText(/not proof that the agent is unreachable/i)).toBeInTheDocument();
    expect(screen.getByText(/saved as browser-reported evidence/i)).toBeInTheDocument();
  });

  it("refreshes shared state after a browser result is persisted without treating it as platform evidence", async () => {
    validateEndpointInBrowser.mockResolvedValue({
      source: "browser_reported",
      protocol: "a2a",
      endpoint: "https://seller.example/agent-card.json",
      outcome: "protocol_valid",
      observedAt: "2026-08-30T00:00:00.000Z",
      expiresAt: "2026-08-30T00:15:00.000Z",
      httpStatus: 200,
      durationMs: 25,
      capabilityCount: 1,
      errorCode: null,
      message: "The endpoint returned a protocol-valid response to this browser.",
      method: "GET",
      cors: true,
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      validation: "accepted",
      persistence: "recorded",
    }, { status: 201 })));
    render(<AgentValidationActions agentId="45422" targets={[{
      protocol: "a2a",
      endpoint: "https://seller.example/agent-card.json",
    }]} />);

    fireEvent.click(screen.getByRole("button", { name: /validate from browser/i }));

    await screen.findByText(/saved as browser-reported evidence/i);
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByText(/shared marketplace evidence was updated/i)).not.toBeInTheDocument();
  });

  it("queues the selected catalog endpoint, polls its opaque request and refreshes shared evidence", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 2,
        status: "queued",
        requestId: "opaque.request",
        pollAfterMs: 0,
      }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 2,
        requestId: "opaque.request",
        status: "completed",
        attemptCount: 1,
        createdAt: 1,
        startedAt: 2,
        completedAt: 3,
        errorCode: null,
        hasResult: true,
        result: {
          protocol: "mcp",
          source: "buyer_refresh",
          outcome: "protocol_valid",
          observedAt: 3,
          expiresAt: 60_003,
          httpStatus: 200,
          durationMs: 125,
        },
      }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentValidationActions agentId="45422" targets={[{
      endpointKey: "a".repeat(64),
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
    }]} />);
    fireEvent.click(screen.getByRole("button", { name: /validate through marketplace/i }));

    await waitFor(() => expect(screen.getByText(/^marketplace check completed$/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/marketplace/validate", expect.objectContaining({
      body: JSON.stringify({
        agentId: "45422",
        endpointKey: "a".repeat(64),
        validationKind: "protocol",
      }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/marketplace/validate/opaque.request", expect.objectContaining({
      cache: "no-store",
    }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("explains when a fresh shared observation is reused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      schemaVersion: 2,
      status: "completed",
      reused: true,
      requestId: null,
    }, { status: 200 })));
    render(<AgentValidationActions agentId="45422" targets={[{
      endpointKey: "r".repeat(64),
      protocol: "a2a",
      endpoint: "https://seller.example/agent-card.json",
    }]} />);

    fireEvent.click(screen.getByRole("button", { name: /validate through marketplace/i }));

    expect(await screen.findByText(/fresh shared A2A observation already exists/i)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not offer infrastructure validation for a target without a catalog endpoint key", () => {
    render(<AgentValidationActions agentId="45422" targets={[{
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
    }]} />);

    expect(screen.queryByRole("button", { name: /validate through marketplace/i })).not.toBeInTheDocument();
  });

  it("does not offer a browser action for a catalog target that is not browser-validatable", () => {
    render(<AgentValidationActions agentId="45422" targets={[{
      endpointKey: "x".repeat(64),
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
      browserValidatable: false,
    }]} />);

    expect(screen.queryByRole("button", { name: /validate from browser/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /validate through marketplace/i })).toBeInTheDocument();
  });

  it("keeps catalog-only targets on the marketplace action when profile declarations differ", () => {
    const agent = {
      agentId: "45422",
      name: "Catalog seller",
      services: [{ name: "A2A", endpoint: "https://declared.example/a2a" }],
      endpoints: [{ name: "A2A", endpoint: "https://declared.example/a2a" }],
      validationTargets: [{
        endpointKey: "y".repeat(64),
        protocol: "a2a",
        endpoint: "https://normalized.example/a2a",
      }],
    };
    const catalogCandidate = {
      agentKey: "eip155:56:45422",
      agentId: "45422",
      chainId: 56,
      owner: null,
      metadataUri: null,
      name: "Catalog seller",
      description: null,
      imageUrl: null,
      categories: [],
      marketplaceConfigured: false,
      metadataState: "ok",
      registeredAt: null,
      blockNumber: null,
      priority: 0,
      declarations: [],
      observations: [],
      state: {
        operationalStatus: "pending",
        freshness: "never",
        commerceStatus: "declared",
        quoteStatus: "not_requested",
        buyerAction: "check_availability",
        canRequestBrowserValidation: true,
        canRequestInfrastructureValidation: true,
        canRequestQuote: false,
        canPrepareHire: false,
        blockingReasons: [],
      },
    };
    const passport = {
      checks: {
        quote: { status: "missing" },
        hireActivity: { status: "missing" },
      },
      trackRecord: { provenJobs: 0 },
    };

    render(<AgentProfile
      agent={agent as never}
      catalogCandidate={catalogCandidate as never}
      passport={passport as never}
    />);

    const normalizedTarget = screen.getByText("normalized.example/a2a").closest("li");
    expect(normalizedTarget).not.toBeNull();
    expect(within(normalizedTarget as HTMLElement).queryByRole("button", { name: /validate from browser/i })).not.toBeInTheDocument();
    expect(within(normalizedTarget as HTMLElement).getByRole("button", { name: /validate through marketplace/i })).toBeInTheDocument();
  });

  it("shows the latest shared observation separately from a new browser check", () => {
    render(<AgentValidationActions agentId="45422" initialObservations={[{
      endpointKey: "e".repeat(64),
      protocol: "mcp",
      source: "worker_probe",
      outcome: "protocol_valid",
      observedAt: Date.now() - 1_000,
      expiresAt: Date.now() + 60_000,
      httpStatus: 200,
      durationMs: 340,
    }]} targets={[{
      endpointKey: "e".repeat(64),
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
    }]} />);

    expect(screen.getByText(/Shared: protocol valid · scheduled Worker/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 200 · 340 ms/)).toBeInTheDocument();
    expect(screen.queryByText(/no browser result was recorded/i)).not.toBeInTheDocument();
  });

  it("reports the committed protocol outcome, transport and attempt count", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 2,
        status: "queued",
        requestId: "opaque.result",
        pollAfterMs: 0,
      }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 2,
        requestId: "opaque.result",
        status: "completed",
        attemptCount: 2,
        createdAt: 1,
        startedAt: 2,
        completedAt: 3,
        errorCode: null,
        hasResult: true,
        result: {
          protocol: "mcp",
          source: "buyer_refresh",
          outcome: "protocol_valid",
          observedAt: 3,
          expiresAt: 60_003,
          httpStatus: 200,
          durationMs: 340,
        },
      })));
    render(<AgentValidationActions agentId="45422" targets={[{
      endpointKey: "f".repeat(64),
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
    }]} />);

    fireEvent.click(screen.getByRole("button", { name: /validate through marketplace/i }));

    expect(await screen.findByText(/MCP protocol valid · HTTP 200 · 340 ms · 2 attempts/i)).toBeInTheDocument();
  });

  it("keeps a non-terminal validation retryable after the bounded polling window", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 2,
        status: "queued",
        requestId: "opaque.running",
        pollAfterMs: 0,
      }, { status: 202 }));
    for (let index = 0; index < 20; index += 1) {
      fetchMock.mockResolvedValueOnce(Response.json({
        schemaVersion: 2,
        requestId: "opaque.running",
        status: "running",
        attemptCount: 1,
        createdAt: 1,
        startedAt: 2,
        completedAt: null,
        errorCode: null,
        hasResult: false,
      }));
    }
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentValidationActions agentId="45422" targets={[{
      endpointKey: "b".repeat(64),
      protocol: "a2a",
      endpoint: "https://seller.example/agent-card.json",
    }]} />);

    fireEvent.click(screen.getByRole("button", { name: /validate through marketplace/i }));
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(screen.getByText(/^marketplace check still running$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^validation stopped$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /validate through marketplace/i })).toBeEnabled();
  });

  it("does not claim shared evidence when a completed request has no result", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 2,
        status: "queued",
        requestId: "opaque.empty",
        pollAfterMs: 0,
      }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 2,
        requestId: "opaque.empty",
        status: "completed",
        attemptCount: 1,
        createdAt: 1,
        startedAt: 2,
        completedAt: 3,
        errorCode: null,
        hasResult: false,
      })));
    render(<AgentValidationActions agentId="45422" targets={[{
      endpointKey: "c".repeat(64),
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
    }]} />);

    fireEvent.click(screen.getByRole("button", { name: /validate through marketplace/i }));

    await screen.findByText(/^validation stopped$/i);
    expect(screen.getByText(/did not produce shared evidence/i)).toBeInTheDocument();
    expect(screen.queryByText(/shared evidence was updated/i)).not.toBeInTheDocument();
  });

  it("keeps a validation retryable when its status check is interrupted", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({
        schemaVersion: 2,
        status: "queued",
        requestId: "opaque.interrupted",
        pollAfterMs: 0,
      }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({
        error: { message: "Status service unavailable." },
      }, { status: 503 })));
    render(<AgentValidationActions agentId="45422" targets={[{
      endpointKey: "d".repeat(64),
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
    }]} />);

    fireEvent.click(screen.getByRole("button", { name: /validate through marketplace/i }));

    await screen.findByText(/^marketplace check still running$/i);
    expect(screen.getByText(/may still be running/i)).toBeInTheDocument();
    expect(screen.queryByText(/^validation stopped$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /validate through marketplace/i })).toBeEnabled();
  });

  it("uses five columns for the hiring readiness skeleton", () => {
    const { container } = render(<HireAgentLoading />);

    expect(container.querySelector('[class~="lg:grid-cols-5"]')).toBeInTheDocument();
    expect(container.querySelector('[class~="lg:grid-cols-4"]')).not.toBeInTheDocument();
  });

  it("marks the current wallet hiring step for assistive technology", () => {
    render(<Erc8183MainnetDemo embedded config={{
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
    }} />);

    const progress = screen.getByRole("list", { name: "Hiring progress" });
    const steps = screen.getAllByRole("listitem").filter((item) => progress.contains(item));
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(steps.slice(1).every((step) => !step.hasAttribute("aria-current"))).toBe(true);
  });

  it("renders only one Quote verified header badge", () => {
    const agent = {
      agentId: "303779",
      name: "Marketplace Grid Planner",
      services: [],
      endpoints: [],
    };
    const passport = {
      checks: {
        quote: { status: "verified" },
        hireActivity: { status: "missing" },
      },
      trackRecord: { provenJobs: 0 },
    };

    render(<AgentProfile agent={agent as never} passport={passport as never} />);

    expect(screen.getAllByText("Quote verified")).toHaveLength(1);
  });
});
