import { beforeEach, describe, expect, it, vi } from "vitest";

const executeList = vi.fn();
const executeMainnetProof = vi.fn();
const workerObservations = vi.fn();
const catalogCandidatePage = vi.fn();
const refreshCookie = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: refreshCookie }) }));

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

function renderPage(params: Record<string, string>) {
  return AgentsPage({ searchParams: Promise.resolve(params) });
}

describe("agents page category handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshCookie.mockReturnValue(undefined);
    executeList.mockImplementation(({ view }: { view: "all" | "marketplace" }) => Promise.resolve(emptyPage(view)));
    executeMainnetProof.mockReturnValue(null);
    catalogCandidatePage.mockResolvedValue(null);
    workerObservations.mockResolvedValue({ status: "unavailable", feed: null });
  });

  // The page always issues one extra metrics call (limit: 1) for the catalog
  // totals; these tests assert only on the data calls.
  function listDataCalls() {
    return executeList.mock.calls.map((call) => call[0]).filter((input) => input.limit !== 1);
  }

  it("requests fresh catalog and metrics after a buyer mutation", async () => {
    refreshCookie.mockReturnValue({ value: "1" });
    await renderPage({});
    expect(catalogCandidatePage).toHaveBeenCalledWith(expect.objectContaining({ fresh: true, limit: 24 }));
    expect(catalogCandidatePage).toHaveBeenCalledWith(expect.objectContaining({ fresh: true, limit: 1 }));
  });

  function catalogDataCalls() {
    return catalogCandidatePage.mock.calls.map((call) => call[0]).filter((input) => input.limit !== 1);
  }

  it("does not silently select a status after clearing filters", async () => {
    await renderPage({ view: "marketplace" });
    expect(catalogDataCalls()[0]).toMatchObject({ statuses: [] });
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
    const el = await renderPage({ view: "marketplace", status: "declared", category: "grid_trading" });
    expect(el.props.retryHref).toContain("scope=hiring");
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
