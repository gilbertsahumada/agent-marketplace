import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  classifyProtocolBucket,
  computeSourceSha256,
  isPublicHttpsEndpoint,
  runFunnelSnapshot,
  validateFunnelSnapshot,
  type FunnelAgentInput,
  type FunnelSnapshot,
} from "../src/trust8004/funnel-snapshot.ts";

function agent(overrides: Partial<FunnelAgentInput> = {}): FunnelAgentInput {
  return {
    chainId: 56,
    agentId: "1",
    registeredAt: 1,
    blockNumber: "100",
    metadataReasonCode: "ok",
    services: [],
    endpoints: [],
    a2aEndpoint: null,
    mcpEndpoint: null,
    ...overrides,
  };
}

describe("WP0 protocol classification", () => {
  it.each([
    [agent({ metadataReasonCode: "http_unreachable", services: [{ name: "A2A", endpoint: "https://a.test" }] }), "protocolUnknown"],
    [agent({ services: [{ name: "A2A" }, { name: "erc-8183" }] }), "both"],
    [agent({ services: [{ name: "ERC_8183" }] }), "erc8183Only"],
    [agent({ a2aEndpoint: "https://a.test" }), "a2aOnly"],
    [agent({ mcpEndpoint: "https://m.test" }), "mcpOnly"],
    [agent(), "otherOrNone"],
  ] as const)("assigns one exclusive bucket", (input, expected) => {
    expect(classifyProtocolBucket(input)).toBe(expected);
  });

  it("treats malformed metadata as unknown even when protocol fields are present", () => {
    expect(classifyProtocolBucket(agent({
      services: "not-json",
      a2aEndpoint: "https://a.test",
    }))).toBe("protocolUnknown");
  });

  it.each([
    ["services", agent({ services: [{ name: "A2A" }, "not-an-object"] })],
    ["endpoints", agent({ endpoints: [{ protocol: "mcp" }, null] })],
  ])("treats invalid entries inside %s as unknown", (_field, input) => {
    expect(classifyProtocolBucket(input)).toBe("protocolUnknown");
  });
});

describe("WP0 endpoint safety", () => {
  it.each([
    ["https://seller.example/a2a?token=secret", true],
    ["https://8.8.8.8/a2a", true],
    ["http://seller.example/a2a", false],
    ["https://user:pass@seller.example/a2a", false],
    ["https://localhost/a2a", false],
    ["https://seller.local/a2a", false],
    ["https://127.0.0.1/a2a", false],
    ["https://10.0.0.1/a2a", false],
    ["https://[::1]/a2a", false],
  ])("classifies public HTTPS without contacting the seller", (endpoint, expected) => {
    expect(isPublicHttpsEndpoint(endpoint)).toBe(expected);
  });
});

describe("WP0 canonical evidence", () => {
  it("sorts object keys recursively and hashes without the hash field", () => {
    const left = { z: [{ b: 2, a: 1 }], a: "x", sourceSha256: "old" };
    const right = { sourceSha256: "different", a: "x", z: [{ a: 1, b: 2 }] };
    expect(canonicalJson(left)).toBe("{\"a\":\"x\",\"sourceSha256\":\"old\",\"z\":[{\"a\":1,\"b\":2}]}");
    expect(computeSourceSha256(left)).toBe(computeSourceSha256(right));
    expect(computeSourceSha256(left)).toBe(
      createHash("sha256").update("{\"a\":\"x\",\"z\":[{\"a\":1,\"b\":2}]}").digest("hex"),
    );
  });
});

describe("WP0 full snapshot", () => {
  it("scans, re-reads deterministic samples, sanitizes evidence and passes every gate", async () => {
    const items = [
      agent({
        agentId: "10",
        registeredAt: 10,
        services: JSON.stringify([{ name: "A2A", endpoint: "https://Seller.Example/a2a?token=do-not-store" }]),
      }),
      agent({
        agentId: "9",
        registeredAt: 10,
        services: [{ name: "erc8183", endpoint: "https://seller.example/jobs" }],
      }),
      agent({
        agentId: "11",
        registeredAt: null,
        metadataReasonCode: "http_unreachable",
        services: [{ name: "A2A", endpoint: "https://ignored.example/a2a" }],
      }),
    ];
    const requestedUrls: URL[] = [];
    let elapsed = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requestedUrls.push(url);
      const headers = { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "59" };
      if (url.pathname === "/api/app/agents/56:10") {
        return Response.json({
          ...items[0],
          rawMetadata: "SECRET_FULL_PAYLOAD",
          agentWallet: "not-an-address",
        }, { headers });
      }
      if (url.searchParams.get("countOnly") === "true") {
        return Response.json({ items: [], total: 3, limit: 1, offset: 0 }, { headers });
      }
      const offset = Number(url.searchParams.get("offset"));
      const pageItems = offset === 0 ? items.slice(0, 2) : offset === 2 ? items.slice(1) : [];
      return Response.json({ items: pageItems, total: 3, limit: 2, offset }, { headers });
    }) as typeof fetch;

    const snapshot = await runFunnelSnapshot({
      baseUrl: "https://trust8004.xyz",
      pageSize: 2,
      minimumRequestIntervalMs: 1_100,
      fetch: fetchImpl,
      now: () => elapsed,
      wait: async (milliseconds) => { elapsed += milliseconds; },
      generatedAt: "2026-08-27T18:00:00.000Z",
      identityReader: {
        registryAddress: "0x1111111111111111111111111111111111111111",
        assertChain: async () => undefined,
        getBlockNumber: async () => 123n,
        readIdentity: async () => ({
          owner: "0x2222222222222222222222222222222222222222",
          agentWallet: "0x0000000000000000000000000000000000000000",
          metadataUri: "ipfs://not-persisted",
        }),
      },
    });

    expect(snapshot.registeredTotal).toBe(3);
    expect(snapshot.metadata).toEqual({ ok: 2, httpUnreachable: 1, other: 0 });
    expect(snapshot.protocols).toEqual({
      a2aOnly: 1,
      erc8183Only: 1,
      both: 0,
      mcpOnly: 0,
      otherOrNone: 0,
      protocolUnknown: 1,
    });
    expect(snapshot.candidates).toEqual({
      declaringAgents: 2,
      declaredEndpoints: 2,
      publicHttpsEndpoints: 2,
      topDomains: [{ hostname: "seller.example", count: 2 }],
    });
    expect(snapshot.scan).toMatchObject({
      pages: 2,
      requestedPageSize: 2,
      observedPageSize: 2,
      firstAgentId: "10",
      lastAgentId: "11",
      requests: 7,
      retries: 0,
      http429Responses: 0,
      maximumRequestsPerRollingMinute: 7,
      missingRegisteredAt: 1,
      duplicateAgentIds: 1,
    });
    expect(snapshot.apiValidation).toMatchObject({
      listRoute: true,
      detailRoute: true,
      rateLimitAdvertised: 60,
      requestedLimitAccepted: true,
      ascendingSampleConfirmed: true,
      detailFieldsObserved: true,
      onchainWalletSource: "ownerOf",
      onchainWalletBlockNumber: "123",
    });
    expect(snapshot.source.rateLimitHeaders).toEqual({
      "x-ratelimit-limit": ["60"],
      "x-ratelimit-remaining": ["59"],
    });
    expect(validateFunnelSnapshot(snapshot).every((gate) => gate.passed)).toBe(true);
    expect(snapshot.sourceSha256).toBe(computeSourceSha256(snapshot));

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("SECRET_FULL_PAYLOAD");
    expect(serialized).not.toContain("do-not-store");
    expect(serialized).not.toContain("/a2a");
    expect(serialized).not.toContain("ipfs://");
    expect(requestedUrls.every((url) => url.searchParams.get("sortBy") === "registered" || url.pathname.includes("56:"))).toBe(true);
  });

  it("fails the drift gate at exactly one percent and blocks WP1 above the sizing threshold", () => {
    const snapshot: FunnelSnapshot = {
      schemaVersion: 1 as const,
      generatedAt: "2026-08-27T18:00:00.000Z",
      chainId: 56 as const,
      cutoff: { blockNumber: "123", observedAt: "2026-08-27T18:00:00.000Z" },
      source: {
        baseUrl: "https://trust8004.xyz",
        listPath: "/api/app/agents",
        detailPathTemplate: "/api/app/agents/56:AGENT_ID",
        params: { chainId: "56", limit: "2000", sortBy: "registered", sortOrder: "asc" },
        rateLimitHeaders: { "x-ratelimit-limit": ["60"] },
      },
      registeredTotal: 99,
      countOnlyTotal: 100,
      metadata: { ok: 99, httpUnreachable: 0, other: 0 },
      protocols: { a2aOnly: 99, erc8183Only: 0, both: 0, mcpOnly: 0, otherOrNone: 0, protocolUnknown: 0 },
      candidates: { declaringAgents: 5_001, declaredEndpoints: 5_001, publicHttpsEndpoints: 0, topDomains: [] },
      scan: {
        pages: 1,
        requestedPageSize: 2_000,
        observedPageSize: 99,
        firstAgentId: "0",
        lastAgentId: "98",
        requests: 1,
        retries: 0,
        http429Responses: 0,
        maximumRequestsPerRollingMinute: 1,
        maxPageBytes: 1,
        missingRegisteredAt: 0,
        duplicateAgentIds: 0,
        durationMs: 1,
        errors: [],
      },
      apiValidation: {
        listRoute: true,
        detailRoute: true,
        rateLimitAdvertised: 60,
        requestedLimitAccepted: true,
        ascendingSampleConfirmed: true,
        detailFieldsObserved: true,
        onchainWalletSource: "getAgentWallet" as const,
        onchainWalletBlockNumber: "123",
      },
      wp1Blocked: true,
      gates: [],
      sourceSha256: "",
    };
    const gates = validateFunnelSnapshot(snapshot);
    expect(gates.find((gate) => gate.name === "countOnlyDriftBelowOnePercent")?.passed).toBe(false);
    expect(gates.find((gate) => gate.name === "wp1SizingWithinBudget")?.passed).toBe(false);
  });

  it.each([null, 59])(
    "fails API contract revalidation when the advertised rate limit is %s",
    (rateLimitAdvertised) => {
      const snapshot: FunnelSnapshot = {
        schemaVersion: 1,
        generatedAt: "2026-08-27T18:00:00.000Z",
        chainId: 56,
        cutoff: { blockNumber: "123", observedAt: "2026-08-27T18:00:00.000Z" },
        source: {
          baseUrl: "https://trust8004.xyz",
          listPath: "/api/app/agents",
          detailPathTemplate: "/api/app/agents/56:AGENT_ID",
          params: { chainId: "56", limit: "2000", sortBy: "registered", sortOrder: "asc" },
          rateLimitHeaders: rateLimitAdvertised === null
            ? {}
            : { "x-ratelimit-limit": [String(rateLimitAdvertised)] },
        },
        registeredTotal: 1,
        countOnlyTotal: 1,
        metadata: { ok: 1, httpUnreachable: 0, other: 0 },
        protocols: { a2aOnly: 1, erc8183Only: 0, both: 0, mcpOnly: 0, otherOrNone: 0, protocolUnknown: 0 },
        candidates: { declaringAgents: 1, declaredEndpoints: 1, publicHttpsEndpoints: 1, topDomains: [] },
        scan: {
          pages: 1,
          requestedPageSize: 2_000,
          observedPageSize: 2_000,
          firstAgentId: "1",
          lastAgentId: "1",
          requests: 1,
          retries: 0,
          http429Responses: 0,
          maximumRequestsPerRollingMinute: 1,
          maxPageBytes: 1,
          missingRegisteredAt: 0,
          duplicateAgentIds: 0,
          durationMs: 1,
          errors: [],
        },
        apiValidation: {
          listRoute: true,
          detailRoute: true,
          rateLimitAdvertised,
          requestedLimitAccepted: true,
          ascendingSampleConfirmed: true,
          detailFieldsObserved: true,
          onchainWalletSource: "getAgentWallet",
          onchainWalletBlockNumber: "123",
        },
        wp1Blocked: false,
        gates: [],
        sourceSha256: "",
      };

      const gate = validateFunnelSnapshot(snapshot)
        .find((candidate) => candidate.name === "apiContractRevalidated");
      expect(gate?.passed).toBe(false);
    },
  );
});
