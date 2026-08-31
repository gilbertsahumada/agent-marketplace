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
    expect(observation.stageDurationsMs).toMatchObject({ initialize: 0, initialized: 0, toolsList: 0 });
  });

  it("uses the configured protocol freshness window", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 2, result: { tools: [] } }));

    const observation = await probeCatalogEndpoint(target, {
      fetchImpl,
      timeoutMs: 4_000,
      freshnessMs: 90_000,
      now: () => 1_000,
    });

    expect(observation.expiresAt).toBe(91_000);
  });

  it("uses the declared ERC-8183 HTTP health convention for scheduled reachability", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: "ok" }));
    const observation = await probeCatalogEndpoint({ ...target, protocol: "erc8183_http" }, {
      fetchImpl,
      timeoutMs: 5_000,
      now: () => 1_000,
      clock: () => 10,
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://seller.example.com/mcp/health", expect.objectContaining({ method: "GET" }));
    expect(observation).toMatchObject({ outcome: "protocol_valid", stageDurationsMs: { health: 0 } });
  });

  it("recognizes an ERC-8183 commerce path only from the complete A2A skill pair", async () => {
    const endpoint = "https://seller.example.com/a2a";
    const observation = await probeCatalogEndpoint({ ...target, protocol: "a2a", endpoint }, {
      fetchImpl: vi.fn(async () => Response.json({
        name: "Seller",
        url: endpoint,
        skills: [{ id: "negotiate-erc8183-job" }, { id: "notify_funded" }],
      })),
      timeoutMs: 5_000,
      now: () => 1_000,
    });
    expect(observation).toMatchObject({
      outcome: "protocol_valid",
      capabilityCount: 2,
      commerceCapability: "erc8183_a2a",
    });
  });

  it("rejects an Agent Card that points at another path on the same origin", async () => {
    const endpoint = "https://seller.example.com/a2a";
    const observation = await probeCatalogEndpoint({ ...target, protocol: "a2a", endpoint }, {
      fetchImpl: vi.fn(async () => Response.json({
        name: "Seller",
        url: "https://seller.example.com/another-agent",
        skills: [],
      })),
      timeoutMs: 5_000,
      now: () => 1_000,
    });
    expect(observation).toMatchObject({ outcome: "invalid_response", errorCode: "CATALOG_INVALID_RESPONSE" });
  });

  it("classifies network failures without calling them CORS or verified reachability", async () => {
    const observation = await probeCatalogEndpoint({ ...target, protocol: "a2a" }, {
      fetchImpl: vi.fn(async () => { throw new TypeError("failed"); }),
      timeoutMs: 5_000,
      now: () => 1_000,
    });
    expect(observation).toMatchObject({ outcome: "network_error", errorCode: "CATALOG_NETWORK_ERROR" });
  });

  it("classifies a shared-deadline timeout without overstating reachability", async () => {
    const observation = await probeCatalogEndpoint(target, {
      fetchImpl: vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }),
      timeoutMs: 5_000,
      now: () => 1_000,
    });
    expect(observation).toMatchObject({ outcome: "timeout", errorCode: "CATALOG_TIMEOUT", expiresAt: null });
  });

  it("blocks redirects and rejects malformed protocol payloads", async () => {
    const redirectedFetch = vi.fn(async () => new Response(null, { status: 302 }));
    const redirected = await probeCatalogEndpoint({ ...target, protocol: "a2a" }, {
      fetchImpl: redirectedFetch,
      timeoutMs: 5_000,
      now: () => 1_000,
    });
    expect(redirectedFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: "error" }));
    expect(redirected).toMatchObject({ outcome: "http_error", httpStatus: 302, expiresAt: null });

    const malformed = await probeCatalogEndpoint({ ...target, protocol: "a2a" }, {
      fetchImpl: vi.fn(async () => Response.json({ name: "missing URL and skills" })),
      timeoutMs: 5_000,
      now: () => 1_000,
    });
    expect(malformed).toMatchObject({ outcome: "invalid_response", errorCode: "CATALOG_INVALID_RESPONSE" });
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

  it("bounds parallel network work while keeping commits ordered", async () => {
    let active = 0;
    let maximumActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const targets = ["a", "b", "c"].map((prefix) => ({
      ...target,
      endpointKey: prefix.repeat(64),
    }));
    const committed: string[] = [];
    await runCatalogProbePhase({ limit: 3, concurrency: 2, nowMs: 1_000, timeoutMs: 5_000 }, {
      selectTargets: vi.fn(async () => targets),
      probe: vi.fn(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (active === 2) release();
        await gate;
        active -= 1;
        return {
          outcome: "protocol_valid" as const, observedAt: 1_000, expiresAt: 2_000,
          httpStatus: 200, errorCode: null, durationMs: 1, capabilityCount: 1, method: "POST" as const,
        };
      }),
      commit: vi.fn(async (current) => { committed.push(current.endpointKey); }),
    });
    expect(maximumActive).toBe(2);
    expect(committed).toEqual(targets.map(({ endpointKey }) => endpointKey));
  });
});
