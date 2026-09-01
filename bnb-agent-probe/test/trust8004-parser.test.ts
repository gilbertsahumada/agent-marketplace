import { describe, expect, it } from "vitest";

import {
  CatalogSchemaError,
  parseCatalogAgent,
  parseCatalogPage,
} from "../src/trust8004/parser.ts";

describe("trust8004 catalog parser", () => {
  it("parses the real list envelope and normalizes JSON-array metadata", () => {
    const page = parseCatalogPage({
      items: [
        {
          chainId: "56",
          agentId: "42",
          owner: "0x1111111111111111111111111111111111111111",
          agentURI: "ipfs://bafybeigdyrzt5-example",
          blockNumber: "12345678",
          name: " Seller ",
          registeredAt: 1_770_000_000_000,
          metadataUpdatedAt: "1770000000001",
          metadataReasonCode: "ok",
          mcpEndpoint: "https://seller.example/mcp",
          services: JSON.stringify([
            { name: "ERC-8183", endpoint: "https://seller.example/jobs" },
          ]),
          endpoints: [{ type: "A2A", url: "https://seller.example/a2a" }],
        },
      ],
      total: 309_897,
      limit: 25,
      offset: 50,
    });

    expect(page).toMatchObject({ total: 309_897, limit: 25, offset: 50 });
    expect(page.invalidItems).toEqual([]);
    expect(page.items[0]).toMatchObject({
      chainId: 56,
      agentId: "42",
      name: "Seller",
      registeredAt: 1_770_000_000_000,
      metadataUpdatedAt: 1_770_000_000_001,
      metadataAvailable: true,
      owner: "0x1111111111111111111111111111111111111111",
      metadataUri: "ipfs://bafybeigdyrzt5-example",
      blockNumber: "12345678",
      declarations: { a2a: true, erc8183: true },
    });
    expect(page.items[0]?.declaredEndpoints.map(({ transport, endpoint }) => ({
      transport,
      endpoint,
    }))).toEqual([
      { transport: "erc8183_http", endpoint: "https://seller.example/jobs" },
      { transport: "a2a", endpoint: "https://seller.example/a2a" },
    ]);
    expect(page.items[0]?.indexEndpoints).toEqual([
      { protocol: "erc8183_http", endpoint: "https://seller.example/jobs", rawProtocol: "ERC-8183", source: "services", sourceIndex: 0 },
      { protocol: "a2a", endpoint: "https://seller.example/a2a", rawProtocol: "A2A", source: "endpoints", sourceIndex: 0 },
      { protocol: "mcp", endpoint: "https://seller.example/mcp", rawProtocol: "mcp", source: "shortcut", sourceIndex: 0 },
    ]);
  });

  it("parses the live Grid declaration when trust8004 returns null endpoints", () => {
    const page = parseCatalogPage({
      items: [{
        chainId: 56,
        agentId: "303779",
        metadataReasonCode: "ok",
        services: [{
          name: "A2A",
          endpoint: "https://bnb-agent-marketplace-ruby.vercel.app/grid",
        }],
        endpoints: null,
      }],
      total: 1,
      limit: 1,
      offset: 0,
    });

    expect(page.invalidItems).toEqual([]);
    expect(page.items[0]).toMatchObject({
      agentId: "303779",
      metadataAvailable: true,
      declarations: { a2a: true, erc8183: false },
      declaredEndpoints: [{
        transport: "a2a",
        endpoint: "https://bnb-agent-marketplace-ruby.vercel.app/grid",
        source: "services",
        sourceIndex: 0,
      }],
    });
  });

  it("normalizes website labels as external web declarations", () => {
    const page = parseCatalogPage({
      items: [{
        chainId: 56,
        agentId: "7",
        metadataReasonCode: "ok",
        services: [{ name: "website", endpoint: "https://agent.example.com" }],
        endpoints: [],
      }],
      total: 1,
      limit: 1,
      offset: 0,
    });
    expect(page.items[0]?.indexEndpoints).toEqual([expect.objectContaining({
      protocol: "web",
      rawProtocol: "website",
    })]);
  });

  it.each([
    "https://127.0.0.1/avatar.png",
    "https://user:pass@cdn.example.com/avatar.png",
    "https://cdn.example.com/avatar.png?token=secret",
  ])("drops image URL that is not safe to render: %s", (imageUrl) => {
    const parsed = parseCatalogAgent({
      chainId: 56,
      agentId: "42",
      metadataReasonCode: "ok",
      imageUrl,
      services: [],
      endpoints: [],
    });

    expect(parsed.imageUrl).toBeNull();
  });

  it("treats null metadata collections as empty when metadata is available", () => {
    const page = parseCatalogPage({
      items: [{
        chainId: 56,
        agentId: "303779",
        metadataReasonCode: "available",
        services: null,
        endpoints: null,
      }],
      total: 1,
      limit: 1,
      offset: 0,
    });

    expect(page.invalidItems).toEqual([]);
    expect(page.items[0]).toMatchObject({
      metadataAvailable: true,
      declarations: { a2a: false, erc8183: false },
      declaredEndpoints: [],
    });
  });

  it("does not make malformed non-null metadata available", () => {
    const page = parseCatalogPage({
      items: [{
        chainId: 56,
        agentId: "303779",
        metadataReasonCode: "ok",
        services: { name: "A2A", endpoint: "https://seller.example/a2a" },
        endpoints: null,
      }],
      total: 1,
      limit: 1,
      offset: 0,
    });

    expect(page.invalidItems).toEqual([]);
    expect(page.items[0]).toMatchObject({
      metadataAvailable: false,
      declarations: { a2a: false, erc8183: false },
      declaredEndpoints: [],
    });
  });

  it("keeps valid items and reports malformed elements by index", () => {
    const page = parseCatalogPage({
      items: [
        {
          chainId: 56,
          agentId: "1",
          metadataReason: "resolved",
          services: [],
          endpoints: [],
        },
        { chainId: 1, agentId: "2", services: [], endpoints: [] },
      ],
      total: 2,
      limit: 2,
      offset: 0,
    });

    expect(page.items.map((item) => item.agentId)).toEqual(["1"]);
    expect(page.invalidItems).toEqual([
      expect.objectContaining({ index: 1, message: expect.stringContaining("chainId") }),
    ]);
  });

  it("retains identity and high-water data when metadata cannot be parsed", () => {
    const page = parseCatalogPage({
      items: [{
        chainId: 56,
        agentId: "9",
        registeredAt: "2026-08-28T12:00:00.000Z",
        metadataReasonCode: "ok",
        services: "not-json",
        endpoints: null,
      }],
      total: 1,
      limit: 1,
      offset: 0,
    });

    expect(page.invalidItems).toEqual([]);
    expect(page.items[0]).toMatchObject({
      agentId: "9",
      name: null,
      registeredAt: Date.parse("2026-08-28T12:00:00.000Z"),
      metadataUpdatedAt: null,
      metadataAvailable: false,
      declaredEndpoints: [],
    });
  });

  it.each([
    [{ items: [], total: -1, limit: 1, offset: 0 }, "total"],
    [{ items: [], total: 0, limit: 0, offset: 0 }, "limit"],
    [{ items: [], total: 0, limit: 1, offset: -1 }, "offset"],
    [{ items: {}, total: 0, limit: 1, offset: 0 }, "items"],
  ])("rejects an invalid page envelope", (payload, path) => {
    expect(() => parseCatalogPage(payload)).toThrowError(CatalogSchemaError);
    expect(() => parseCatalogPage(payload)).toThrowError(String(path));
  });
});
