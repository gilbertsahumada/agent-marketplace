import { describe, expect, it, vi } from "vitest";
import {
  probeCatalogEndpoint,
  runCatalogProbePhase,
  type CatalogProbeTarget,
} from "../src/phases/catalog-probe";

const target: CatalogProbeTarget = {
  agentKey: "eip155:56:45422",
  endpointKey: "a".repeat(64),
  protocol: "mcp",
  endpoint: "https://seller.example.com/mcp",
  priority: 40,
  consecutiveFailures: 0,
};

describe("catalog probe phase", () => {
  it("does no egress when the prioritized queue is empty", async () => {
    const commit = vi.fn();
    const summary = await runCatalogProbePhase({ limit: 1, nowMs: 1_000, timeoutMs: 5_000 }, {
      selectTargets: vi.fn(async () => []),
      probe: vi.fn(),
      commit,
    });
    expect(summary).toMatchObject({ processedTargets: 0, outcomes: {} });
    expect(commit).not.toHaveBeenCalled();
  });

  it("validates MCP initialize and tools/list with bounded Streamable HTTP", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }, {
        headers: { "mcp-session-id": "session" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "quote" }] } }));

    const observation = await probeCatalogEndpoint(target, { fetchImpl, timeoutMs: 5_000, now: () => 1_000 });

    expect(observation).toMatchObject({ outcome: "protocol_valid", capabilityCount: 1, httpStatus: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("classifies network failures without calling them CORS or verified reachability", async () => {
    const observation = await probeCatalogEndpoint({ ...target, protocol: "a2a" }, {
      fetchImpl: vi.fn(async () => { throw new TypeError("failed"); }),
      timeoutMs: 5_000,
      now: () => 1_000,
    });
    expect(observation).toMatchObject({ outcome: "network_error", errorCode: "CATALOG_NETWORK_ERROR" });
  });

  it("processes only the configured batch and commits every attempt", async () => {
    const commit = vi.fn(async () => undefined);
    const targets = [target, { ...target, endpointKey: "b".repeat(64), agentKey: "eip155:56:45650" }];
    const summary = await runCatalogProbePhase({ limit: 1, nowMs: 1_000, timeoutMs: 5_000 }, {
      selectTargets: vi.fn(async ({ limit }) => targets.slice(0, limit)),
      probe: vi.fn(async () => ({
        outcome: "protocol_valid" as const,
        observedAt: 1_000,
        expiresAt: 901_000,
        httpStatus: 200,
        errorCode: null,
        durationMs: 5,
        capabilityCount: 1,
        method: "POST" as const,
      })),
      commit,
    });
    expect(summary).toMatchObject({ processedTargets: 1, outcomes: { protocol_valid: 1 } });
    expect(commit).toHaveBeenCalledOnce();
  });
});
