// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validateEndpointInBrowser = vi.fn();
vi.mock("@/src/verification/browser-endpoint-validation", () => ({ validateEndpointInBrowser }));

const { AgentValidationActions } = await import("../components/marketplace/agent-validation-actions.tsx");

describe("AgentValidationActions", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

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

  it("offers the marketplace fallback and reports quote evidence separately", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      evidence: { endpointChecks: [{ status: "verified" }], quote: { status: "verified" } },
      qualification: { note: "Fresh quote candidate; manual admission remains required." },
    })));
    render(<AgentValidationActions agentId="45422" targets={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /validate through marketplace/i }));

    await waitFor(() => expect(screen.getByText(/marketplace check completed/i)).toBeInTheDocument());
    expect(screen.getByText(/ERC-8183 quote: verified/i)).toBeInTheDocument();
  });
});
