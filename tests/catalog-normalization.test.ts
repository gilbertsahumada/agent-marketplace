import { describe, expect, it } from "vitest";
import {
  normalizeCatalogAgent,
  type CatalogAgentInput,
} from "../src/trust8004/catalog-normalization.ts";

function agent(overrides: Partial<CatalogAgentInput> = {}): CatalogAgentInput {
  return {
    chainId: 56,
    agentId: "42",
    metadataReasonCode: "ok",
    services: [],
    endpoints: [],
    ...overrides,
  };
}

describe("catalog normalization", () => {
  it("keeps transport and commerce declarations as independent dimensions", () => {
    const normalized = normalizeCatalogAgent(agent({
      owner: "0x1111111111111111111111111111111111111111",
      agentURI: "ipfs://bafybeigdyrzt5-example",
      name: "  Grid planner  ",
      description: "Keeps a target allocation.",
      imageUrl: "ipfs://bafy-agent/avatar.png",
      a2aEndpoint: "https://SELLER.example:443/a2a",
      mcpEndpoint: "https://seller.example/mcp",
      services: [{ name: "ERC-8183", endpoint: "https://seller.example/jobs" }],
    }));

    expect(normalized.agentKey).toBe("eip155:56:42");
    expect(normalized).toMatchObject({
      owner: "0x1111111111111111111111111111111111111111",
      metadataUri: "ipfs://bafybeigdyrzt5-example",
      name: "Grid planner",
      description: "Keeps a target allocation.",
      imageUrl: "https://ipfs.io/ipfs/bafy-agent/avatar.png",
    });
    expect(normalized.transportProtocols).toEqual(["a2a", "mcp"]);
    expect(normalized.commerceProtocols).toEqual(["erc8183"]);
    expect(normalized.declarations.map((declaration) => ({
      protocol: declaration.protocol,
      url: declaration.url,
      safety: declaration.safety,
    }))).toEqual([
      { protocol: "a2a", url: "https://seller.example/a2a", safety: "safe" },
      { protocol: "erc8183_http", url: "https://seller.example/jobs", safety: "safe" },
      { protocol: "mcp", url: "https://seller.example/mcp", safety: "safe" },
    ]);
  });

  it("bounds display metadata and drops unsafe image URLs", () => {
    const normalized = normalizeCatalogAgent(agent({
      name: `name-${"x".repeat(400)}`,
      description: "y".repeat(3_000),
      imageUrl: "javascript:alert(1)",
      a2aEndpoint: "https://seller.example/a2a",
    }));

    expect(normalized.name?.length).toBe(256);
    expect(normalized.description?.length).toBe(2_048);
    expect(normalized.imageUrl).toBeNull();
  });

  it.each([
    "https://127.0.0.1/avatar.png",
    "https://user:pass@cdn.example.com/avatar.png",
    "https://cdn.example.com/avatar.png?token=secret",
  ])("drops image URL that is not safe to render: %s", (imageUrl) => {
    const normalized = normalizeCatalogAgent(agent({ imageUrl }));

    expect(normalized.imageUrl).toBeNull();
  });

  it("deduplicates equivalent declarations without collapsing different protocols", () => {
    const normalized = normalizeCatalogAgent(agent({
      a2aEndpoint: "https://seller.example/a2a",
      services: [
        { name: "A2A", endpoint: "https://seller.example:443/a2a" },
        { name: "MCP", endpoint: "https://seller.example/a2a" },
      ],
    }));

    expect(normalized.declarations).toHaveLength(2);
    expect(new Set(normalized.declarations.map((entry) => entry.endpointKey)).size).toBe(2);
    expect(new Set(normalized.declarations.map((entry) => entry.originKey)).size).toBe(1);
  });

  it("never persists query credentials and excludes unsafe declarations from candidates", () => {
    const normalized = normalizeCatalogAgent(agent({
      services: [{ name: "A2A", endpoint: "https://seller.example/a2a?token=secret" }],
    }));

    expect(normalized.declarations).toEqual([
      expect.objectContaining({
        protocol: "a2a",
        url: null,
        safety: "unsafe",
        safetyReason: "query_not_allowed",
      }),
    ]);
    expect(JSON.stringify(normalized)).not.toContain("secret");
    expect(normalized.candidate).toBe(false);
  });

  it.each([
    ["http://seller.example/a2a", "https_required"],
    ["https://user:pass@seller.example/a2a", "credentials_not_allowed"],
    ["https://127.0.0.1/a2a", "non_public_host"],
    ["https://seller.local/a2a", "non_public_host"],
    ["not-a-url", "invalid_url"],
  ] as const)("classifies unsafe endpoint %s", (endpoint, reason) => {
    const normalized = normalizeCatalogAgent(agent({ a2aEndpoint: endpoint }));
    expect(normalized.declarations[0]).toMatchObject({
      url: null,
      safety: "unsafe",
      safetyReason: reason,
    });
  });

  it("preserves identities with no declaration and does not hardcode a candidate count", () => {
    const normalized = normalizeCatalogAgent(agent({
      agentId: "999999999999999999",
      metadataReasonCode: "http_unreachable",
    }));

    expect(normalized).toMatchObject({
      agentId: "999999999999999999",
      metadataState: "http_unreachable",
      candidate: false,
      declarations: [],
    });
  });

  it("normalizes generic HTTPS declarations as web transport", () => {
    const normalized = normalizeCatalogAgent(agent({
      endpoints: [{ type: "https", url: "https://seller.example/api" }],
    }));

    expect(normalized.transportProtocols).toEqual(["web"]);
    expect(normalized.declarations[0]).toMatchObject({ protocol: "web", safety: "safe" });
  });

  it("retains x402 and unknown declarations without treating them as probe transports", () => {
    const normalized = normalizeCatalogAgent(agent({
      services: [
        { name: "x402", endpoint: "https://seller.example/pay" },
        { name: "Custom settlement", endpoint: "https://seller.example/settle" },
        { endpoint: "https://seller.example/unknown" },
      ],
    }));

    expect(normalized.transportProtocols).toEqual([]);
    expect(normalized.declarations.map(({ protocol, url }) => ({ protocol, url }))).toEqual([
      { protocol: "unknown", url: "https://seller.example/settle" },
      { protocol: "unknown", url: "https://seller.example/unknown" },
      { protocol: "x402", url: "https://seller.example/pay" },
    ]);
    expect(normalized.candidate).toBe(true);
  });

  it("keeps declaration provenance for snapshot-to-D1 backfills", () => {
    const normalized = normalizeCatalogAgent(agent({
      a2aEndpoint: "https://seller.example/a2a",
      services: [{ name: "MCP", endpoint: "https://seller.example/mcp" }],
    }));

    expect(normalized.declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        protocol: "a2a",
        rawProtocol: "a2a",
        rawSource: "shortcut",
        rawSourceIndex: 0,
      }),
      expect.objectContaining({
        protocol: "mcp",
        rawProtocol: "MCP",
        rawSource: "services",
        rawSourceIndex: 0,
      }),
    ]));
  });
});
