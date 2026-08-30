import { describe, expect, it, vi } from "vitest";
import {
  validateEndpointInBrowser,
  type BrowserValidationTarget,
} from "../src/verification/browser-endpoint-validation.ts";

const now = () => 1_788_000_000_000;

function target(overrides: Partial<BrowserValidationTarget> = {}): BrowserValidationTarget {
  return {
    protocol: "a2a",
    endpoint: "https://seller.example/grid",
    ...overrides,
  };
}

describe("browser endpoint validation", () => {
  it("validates an A2A Agent Card without sending a task or quote", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      name: "Seller",
      url: "https://seller.example/grid",
      skills: [{ id: "rebalance" }, { id: "quote" }],
    }));

    const result = await validateEndpointInBrowser(target(), { fetchImpl, now, monotonicNow: () => 10 });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://seller.example/grid/.well-known/agent-card.json",
      expect.objectContaining({ method: "GET", credentials: "omit" }),
    );
    expect(result).toMatchObject({
      source: "browser_reported",
      protocol: "a2a",
      outcome: "protocol_valid",
      capabilityCount: 2,
      httpStatus: 200,
      method: "GET",
    });
  });

  it("completes MCP initialize and tools/list over Streamable HTTP", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "mcp", version: "1" } },
      }, { headers: { "mcp-session-id": "session-1" } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [{ name: "quote" }, { name: "execute" }] },
      }));

    const result = await validateEndpointInBrowser(target({
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
    }), { fetchImpl, now, monotonicNow: () => 10 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2]?.[1]?.headers).toMatchObject({ "mcp-session-id": "session-1" });
    expect(result).toMatchObject({
      protocol: "mcp",
      outcome: "protocol_valid",
      capabilityCount: 2,
      method: "POST",
    });
  });

  it("checks HTTP/ERC-8183 status without requesting a quote", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: "ok" }));
    const result = await validateEndpointInBrowser(target({
      protocol: "erc8183_http",
      endpoint: "https://seller.example/jobs",
    }), { fetchImpl, now, monotonicNow: () => 10 });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://seller.example/jobs/status",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toMatchObject({ outcome: "protocol_valid", method: "GET" });
  });

  it("reports browser policy/network failures as browser-blocked, never unreachable", async () => {
    const result = await validateEndpointInBrowser(target(), {
      fetchImpl: vi.fn(async () => { throw new TypeError("Failed to fetch"); }),
      now,
      monotonicNow: () => 10,
    });

    expect(result).toMatchObject({
      outcome: "cors_blocked",
      errorCode: "BROWSER_FETCH_BLOCKED",
      cors: false,
    });
    expect(result.message).toMatch(/browser could not read/i);
  });

  it("fails closed before fetch for unsafe declarations", async () => {
    const fetchImpl = vi.fn();
    const result = await validateEndpointInBrowser(target({ endpoint: "http://127.0.0.1/admin" }), {
      fetchImpl,
      now,
      monotonicNow: () => 10,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ outcome: "unsafe_url", errorCode: "BROWSER_UNSAFE_URL" });
  });
});
