import { beforeEach, describe, expect, it, vi } from "vitest";

const executeList = vi.fn();
const executeMainnetProof = vi.fn();
const workerObservations = vi.fn();
const catalogCandidatePage = vi.fn();
const catalogFacetCounts = vi.fn();
const catalogSummary = vi.fn();
const catalogCombined = vi.fn();
const refreshCookie = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: refreshCookie }) }));
vi.mock("@/src/data/observation/catalog-candidate-feed", () => ({
  getCatalogCandidatePageResult: async (input: unknown) => {
    const data = await catalogCandidatePage(input);
    return data ? { ok: true, data } : { ok: false, error: { kind: "unavailable" } };
  },
  getCatalogFacetCountsResult: catalogFacetCounts,
  getCatalogSummaryResult: catalogSummary,
  getCatalogCombinedResult: catalogCombined,
}));

vi.mock("@/src/business/composition", () => ({
  listMarketplaceAgents: { execute: executeList },
  getMainnetJobProof: { execute: executeMainnetProof },
  getWorkerObservations: workerObservations,
  getCatalogCandidatePage: catalogCandidatePage,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: AgentsPage } = await import("../app/agents/page.tsx");

function emptyPage(view: "all" | "marketplace") {
  return {
    view,
    items: [],
    pagination: { page: 1, pageSize: 24, total: 0, totalPages: 0 },
    categories: [],
    catalogCoverage: "partial",
    fetchedAt: "2026-08-30T00:00:00.000Z",
  };
}

async function renderPage(params: Record<string, string>) {
  const el = await AgentsPage({ searchParams: Promise.resolve(params) });
  await Promise.all(Object.values(el.props.resources));
  return el;
}

describe("agents page category handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshCookie.mockReturnValue(undefined);
    executeList.mockImplementation(({ view }: { view: "all" | "marketplace" }) => Promise.resolve(emptyPage(view)));
    executeMainnetProof.mockReturnValue(null);
    catalogCandidatePage.mockResolvedValue(null);
    catalogCombined.mockResolvedValue({ ok: false, error: { kind: "unavailable" } });
    catalogFacetCounts.mockResolvedValue({ ok: false, error: { kind: "unavailable" } });
    catalogSummary.mockResolvedValue({ ok: false, error: { kind: "unavailable" } });
    workerObservations.mockResolvedValue({ status: "unavailable", feed: null });
  });

  // Directory and catalogue cards remain separate from aggregate-only reads.
  function listDataCalls() {
    return executeList.mock.calls.map((call) => call[0]).filter((input) => input.limit !== 1);
  }

  it("requests fresh catalog and metrics after a buyer mutation", async () => {
    refreshCookie.mockReturnValue({ value: "1" });
    await renderPage({});
    expect(catalogCombined).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chainId: 56, fresh: true, limit: 24 }));
    expect(catalogCandidatePage).not.toHaveBeenCalled();
    expect(catalogFacetCounts).not.toHaveBeenCalled();
    expect(catalogSummary).not.toHaveBeenCalled();
  });

  function catalogDataCalls() {
    return catalogCombined.mock.calls.map((call) => call[0]);
  }

  it("renders rows and counts from one validated snapshot", async () => {
    const catalog = { items: [], total: 33653 };
    catalogCombined.mockResolvedValue({ ok: true, data: { list: catalog, facets: {}, summary: { hiring: 2, evaluation: 3 } } });
    const el = await renderPage({});
    expect(await el.props.resources.results).toEqual({ ok: true, data: { catalog } });
    expect(await el.props.resources.facets).toEqual({ ok: true, data: {} });
    expect(catalogDataCalls()).toHaveLength(1);
    expect(catalogDataCalls()[0].includeFacets).not.toBe(true);
  });

  it("exposes a combined failure without silently falling back to independent scans", async () => {
    catalogCombined.mockResolvedValue({ ok: false, error: { kind: "timeout" } });
    const el = await renderPage({});
    expect(await el.props.resources.results).toEqual({ ok: false, error: { kind: "timeout" } });
    expect(await el.props.resources.facets).toMatchObject({ ok: false });
    expect(catalogCandidatePage).not.toHaveBeenCalled();expect(catalogFacetCounts).not.toHaveBeenCalled();expect(catalogSummary).not.toHaveBeenCalled();
  });

  it("returns available counts in the canonical combined request and retains filters", async () => {
    const facets = { statuses: { requestable: 0 } };
    catalogCombined.mockResolvedValue({ ok: true, data: { list: { items: [], total: 1 }, facets, summary: { hiring: 0, evaluation: 1 } } });
    const el = await renderPage({ network: "testnet", scope: "evaluation", page: "3", category: "grid_trading", protocol: "mcp", q: "seller" });
    expect(await el.props.resources.facets).toEqual({ ok: true, data: facets });
    expect(catalogCombined).toHaveBeenCalledWith(expect.objectContaining({
      chainId: 97, scope: "evaluation",
      categories: ["grid_trading"], protocols: ["mcp"], q: "seller",
    }));
    expect(catalogFacetCounts).not.toHaveBeenCalled();
    expect(catalogDataCalls()[0]).toMatchObject({ page: 3, limit: 24 });
    expect(catalogDataCalls()[0].includeFacets).not.toBe(true);
  });

  it("does not silently select a status after clearing filters", async () => {
    await renderPage({ view: "marketplace" });
    expect(catalogDataCalls()[0]).toMatchObject({ statuses: [] });
    expect(catalogDataCalls()[0]).not.toHaveProperty("scope");
  });

  it("shows listed agents by default on both networks, without changing explicit hiring", async () => {
    for (const network of ["mainnet", "testnet"]) {
      for (const scope of [undefined, "all", "hiring", "evaluation"]) {
        catalogCombined.mockClear();
        await renderPage({ network, ...(scope ? { scope } : {}) });
        const input = catalogDataCalls()[0];
        expect(input.chainId).toBe(network === "testnet" ? 97 : 56);
        if (!scope || scope === "all") expect(input).not.toHaveProperty("scope");
        else expect(input.scope).toBe(scope);
      }
    }
  });

  it("counts both scopes without silently filtering them to requestable agents", async () => {
    catalogCombined.mockResolvedValue({ ok: true, data: { list: { items: [], total: 66 }, facets: {}, summary: { hiring: 0, evaluation: 66 } } });
    const el = await renderPage({ network: "testnet", scope: "evaluation" });
    expect(catalogCombined).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chainId: 97, fresh: false }));
    expect(catalogSummary).not.toHaveBeenCalled();
    expect(await el.props.resources.scopes).toEqual({ ok: true, data: { hiring: 0, evaluation: 66 } });
  });

  function queryCategories(query: Record<string, unknown>): string[] {
    if (Array.isArray(query.categories)) return query.categories as string[];
    return typeof query.category === "string" ? [query.category] : [];
  }

  function catalogFilter(input: Record<string, unknown>): { categories: string[]; statuses: string[] } {
    return {
      categories: Array.isArray(input.categories)
        ? input.categories as string[]
        : typeof input.category === "string" ? [input.category] : [],
      statuses: Array.isArray(input.statuses)
        ? input.statuses as string[]
        : typeof input.status === "string" ? [input.status] : [],
    };
  }

  it("R1: drops the category in the registered view and paginates by 24", async () => {
    const el = await renderPage({ view: "all", category: "grid_trading" });
    expect(queryCategories(el.props.query)).toEqual([]);
    const dataCalls = listDataCalls();
    expect(dataCalls).toHaveLength(1);
    const input = dataCalls[0];
    expect(input).not.toHaveProperty("category");
    expect(input).toMatchObject({ view: "all", page: 1, limit: 24 });
  });

  it("R2: an unknown category in the registered view still resolves (no 404)", async () => {
    await expect(renderPage({ view: "all", category: "bogus" })).resolves.toBeDefined();
    expect(listDataCalls()).toHaveLength(1);
  });

  it("R3: an unknown category in the marketplace view is a 404", async () => {
    await expect(renderPage({ view: "marketplace", category: "bogus" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(executeList).not.toHaveBeenCalled();
  });

  it("R4: scoped inventory never falls back to unchecked declarations", async () => {
    const el = await renderPage({ view: "marketplace", scope: "hiring", status: "declared", category: "grid_trading" });
    expect(el.props.query.scope).toBe("hiring");
    expect(await el.props.resources.results).toMatchObject({ ok: false });
    const catalogCalls = catalogDataCalls();
    expect(catalogCalls).toHaveLength(1);
    expect(catalogFilter(catalogCalls[0]!)).toEqual({ categories: ["grid_trading"], statuses: ["declared"] });
    expect(catalogCalls[0]).toMatchObject({ scope: "hiring" });
    expect(listDataCalls()).toEqual([]);
  });

  it("R5: forwards live reachability to the catalog feed", async () => {
    await renderPage({ view: "marketplace", reachability: "live" });
    expect(catalogDataCalls()).toEqual([
      expect.objectContaining({ reachability: ["live"], page: 1, limit: 24 }),
    ]);
  });
});
