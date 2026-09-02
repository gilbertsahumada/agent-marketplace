import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCatalogCandidate,
  getCatalogCandidatePage,
  parseCatalogCandidateDetail,
  parseCatalogCandidatePage,
} from "../src/data/observation/catalog-candidate-feed.ts";

afterEach(() => vi.restoreAllMocks());

describe("catalog candidate feed", () => {
  it("accepts the shared v2 list and detail contract fixtures", () => {
    const fixtures = JSON.parse(readFileSync(new URL("../contracts/catalog-api-v2.fixtures.json", import.meta.url), "utf8"));
    expect(parseCatalogCandidatePage(fixtures.list)).toMatchObject({
      total: 1,
      items: [{
        agentId: "42",
        owner: "0x1111111111111111111111111111111111111111",
        metadataUri: "ipfs://bafybeigdyrzt5-example",
        state: { buyerAction: "request_quote" },
      }],
    });
    expect(parseCatalogCandidateDetail(fixtures.detail, "42")).toMatchObject({
      agentId: "42",
      owner: "0x1111111111111111111111111111111111111111",
      metadataUri: "ipfs://bafybeigdyrzt5-example",
      admission: { state: "candidate" },
      state: { canRequestQuote: true },
    });
  });

  it("preserves normalized declaration classification from the v2 feed", () => {
    const fixtures = JSON.parse(readFileSync(
      new URL("../contracts/catalog-api-v2.fixtures.json", import.meta.url), "utf8",
    )) as { list: Record<string, unknown> };
    const list = structuredClone(fixtures.list) as Record<string, unknown>;
    const item = (list.items as Array<Record<string, unknown>>)[0]!;
    const declarations = item.declarations as Array<Record<string, unknown>>;
    declarations[0] = {
      ...declarations[0],
      declaredProtocol: "mcp",
      role: "external",
      validationProtocol: null,
      externalKind: "social",
      eligibility: "unsupported",
    };

    expect(parseCatalogCandidatePage(list).items[0]?.declarations[0]).toMatchObject({
      declaredProtocol: "mcp",
      role: "external",
      validationProtocol: null,
      externalKind: "social",
      eligibility: "unsupported",
    });
  });

  it("preserves normalized metadata provenance from the v2 feed", () => {
    const fixtures = JSON.parse(readFileSync(
      new URL("../contracts/catalog-api-v2.fixtures.json", import.meta.url), "utf8",
    )) as { list: Record<string, unknown> };
    const list = structuredClone(fixtures.list) as Record<string, unknown>;
    const item = (list.items as Array<Record<string, unknown>>)[0]!;
    item.metadataVersion = "sha256:catalog-metadata-42";
    item.metadataObservedAt = 1_788_000_000_000;

    expect(parseCatalogCandidatePage(list).items[0]).toMatchObject({
      metadataVersion: "sha256:catalog-metadata-42",
      metadataObservedAt: 1_788_000_000_000,
    });
  });

  it("parses complete non-negative filter facet counts", () => {
    const fixtures = JSON.parse(readFileSync(
      new URL("../contracts/catalog-api-v2.fixtures.json", import.meta.url), "utf8",
    )) as { list: Record<string, unknown> };
    const list = structuredClone(fixtures.list) as Record<string, unknown>;
    list.facets = {
      statuses: {
        declared: 30, pending: 20, a2a: 4, mcp: 3, mcp_only: 2,
        erc8183: 1, quote_capable: 1, hireable: 1, failed: 5,
      },
      categories: {
        rebalancing: 7, grid_trading: 6, yield_optimisation: 5, health_factor_monitoring: 4,
      },
    };

    expect(parseCatalogCandidatePage(list).facets).toMatchObject({
      statuses: { declared: 30, hireable: 1 },
      categories: { grid_trading: 6 },
    });
    ((list.facets as { statuses: Record<string, number> }).statuses).declared = -1;
    expect(() => parseCatalogCandidatePage(list)).toThrow("CATALOG_FEED_INVALID");
  });

  it("does not expose unsafe image targets from a catalog response", () => {
    const fixtures = JSON.parse(readFileSync(
      new URL("../contracts/catalog-api-v2.fixtures.json", import.meta.url), "utf8"),
    ) as { list: Record<string, unknown> };
    const list = structuredClone(fixtures.list) as Record<string, unknown>;
    const item = (list.items as Array<Record<string, unknown>>)[0]!;

    item.imageUrl = "https://user:secret@cdn.example.net/avatar.png";
    expect(parseCatalogCandidatePage(list).items[0]?.imageUrl).toBeNull();

    item.imageUrl = "https://cdn.example.net/avatar.png?token=secret";
    expect(parseCatalogCandidatePage(list).items[0]?.imageUrl).toBeNull();

    item.imageUrl = "https://cdn.example.net/avatar.png";
    expect(parseCatalogCandidatePage(list).items[0]?.imageUrl).toBe("https://cdn.example.net/avatar.png");
  });

  it("rejects legacy provenance in v2 while retaining schema v1 compatibility", () => {
    const fixtures = JSON.parse(readFileSync(
      new URL("../contracts/catalog-api-v2.fixtures.json", import.meta.url), "utf8",
    ));
    fixtures.list.items[0].observations[0].source = "marketplace_probe";
    expect(() => parseCatalogCandidatePage(fixtures.list)).toThrow("CATALOG_FEED_INVALID");
    fixtures.list.schemaVersion = 1;
    expect(parseCatalogCandidatePage(fixtures.list)).toMatchObject({
      items: [{ observations: [{ source: "marketplace_probe" }] }],
    });
  });

  it("requires normalized derived state on v2 responses", () => {
    const fixtures = JSON.parse(readFileSync(
      new URL("../contracts/catalog-api-v2.fixtures.json", import.meta.url), "utf8",
    )) as { list: Record<string, unknown>; detail: Record<string, unknown> };
    const list = structuredClone(fixtures.list) as Record<string, unknown>;
    delete (list.items as Array<Record<string, unknown>>)[0]!.state;
    expect(() => parseCatalogCandidatePage(list)).toThrow("CATALOG_FEED_INVALID");

    const detail = structuredClone(fixtures.detail) as Record<string, unknown>;
    delete detail.state;
    expect(() => parseCatalogCandidateDetail(detail, "42")).toThrow("CATALOG_FEED_INVALID");
  });

  it("reads the public catalog from the configured observation Worker origin", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      schemaVersion: 1,
      chainId: 56,
      status: "pending",
      query: "grid",
      category: null,
      generatedAt: 1_788_000_000_000,
      page: 1,
      limit: 24,
      total: 1,
      items: [{
        agentKey: "eip155:56:42",
        agentId: "42",
        chainId: 56,
        owner: null,
        metadataUri: null,
        name: "Grid",
        description: null,
        imageUrl: null,
        categoriesJson: "[]",
        marketplaceConfigured: 0,
        metadataState: "ok",
        registeredAt: null,
        blockNumber: null,
        priority: 60,
        declarations: [{
          endpointKey: "a".repeat(64), protocol: "a2a", endpoint: "https://agent.example/a2a",
          originKey: "b".repeat(64), safety: "safe", safetyReason: null,
          representativeAgentKey: "eip155:56:42", lastProbedAt: null, nextProbeAt: 0,
          consecutiveFailures: 0, priority: 60,
        }],
        observations: [],
      }],
    }));

    const result = await getCatalogCandidatePage({
      status: "pending", page: 1, limit: 24, q: "grid",
      env: { OBSERVATIONS_URL: "https://worker.example/observations" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://worker.example/catalog-agents?status=pending&page=1&limit=24&q=grid"),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result).toMatchObject({ statuses: ["pending"], categories: [], total: 1, items: [{ agentId: "42", marketplaceConfigured: false }] });
  });

  it("preserves combined evidence and outcome filters in the Worker request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      schemaVersion: 1,
      chainId: 56,
      status: "declared",
      query: "",
      category: "grid_trading",
      generatedAt: 1_788_000_000_000,
      page: 1,
      limit: 24,
      total: 0,
      items: [],
    }));

    await getCatalogCandidatePage({
      statuses: ["declared", "a2a"],
      categories: ["grid_trading", "rebalancing"],
      page: 1,
      limit: 24,
      env: { OBSERVATIONS_URL: "https://worker.example/observations" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://worker.example/catalog-agents?status=declared&status=a2a&page=1&limit=24&category=grid_trading&category=rebalancing"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("fails closed when the configured observation URL is not the public Worker route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(getCatalogCandidatePage({
      status: "declared", page: 1, limit: 24,
      env: { OBSERVATIONS_URL: "https://worker.example/private?token=secret" },
    })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a loopback Worker only in local development", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      schemaVersion: 1, chainId: 56, status: "declared", query: "", category: null,
      generatedAt: 1, page: 1, limit: 1, total: 0, items: [],
    }));
    await getCatalogCandidatePage({
      status: "declared", page: 1, limit: 1,
      env: { NODE_ENV: "development", OBSERVATIONS_URL: "http://127.0.0.1:8787/observations" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/catalog-agents?status=declared&page=1&limit=1"),
      expect.any(Object),
    );
  });

  it("reads exact platform attempt totals from the per-agent evidence route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      schemaVersion: 1,
      chainId: 56,
      agentId: "42",
      platformAttemptCount: 73,
      agent: {
        agentKey: "eip155:56:42", agentId: "42", chainId: 56, name: "Grid",
        owner: null, metadataUri: null,
        description: null, imageUrl: null, categoriesJson: "[]", marketplaceConfigured: 0,
        metadataState: "ok", registeredAt: null, blockNumber: null, priority: 60,
      },
      declarations: [],
      observations: [],
    }));

    const result = await getCatalogCandidate({
      agentId: "42",
      env: { OBSERVATIONS_URL: "https://worker.example/observations" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://worker.example/catalog-agent?agentId=42"),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result).toMatchObject({ agentId: "42", platformAttemptCount: 73 });
  });
});
