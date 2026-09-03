// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validateEndpointInBrowser = vi.fn();
const refresh = vi.fn();
vi.mock("@/src/verification/browser-endpoint-validation", () => ({ validateEndpointInBrowser }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { AgentValidationActions } = await import("../components/marketplace/agent-validation-actions.tsx");

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
});
