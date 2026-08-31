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
      items: [{ agentId: "42", state: { buyerAction: "request_quote" } }],
    });
    expect(parseCatalogCandidateDetail(fixtures.detail, "42")).toMatchObject({
      agentId: "42",
      admission: { state: "candidate" },
      state: { canRequestQuote: true },
    });
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
