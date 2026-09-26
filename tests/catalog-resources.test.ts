import { describe, expect, it, vi } from "vitest";
import { normalizeCatalogQuery } from "../src/presentation/catalog-query";
import { createCatalogResources, readCatalogResource } from "../src/presentation/catalog-resources";

const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
describe("progressive catalogue coordination", () => {
  it("returns immediately and maps one combined promise without secondary reads", async () => {
    const rows = deferred<any>();
    const combined = vi.fn().mockImplementationOnce(() => rows.promise);
    const read = vi.fn();
    const facets = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const summary = vi.fn().mockResolvedValue({ ok: true, data: { hiring: 0, evaluation: 2 } });
    const resources = createCatalogResources(normalizeCatalogQuery({ network: "testnet", page: "3", protocol: "mcp" }), true, { read, facets, summary, combined, directory: vi.fn() });
    expect(combined).toHaveBeenCalledTimes(1);
    expect(combined.mock.calls[0]?.[0]).toMatchObject({ chainId: 97, page: 3, limit: 24, protocols: ["mcp"], fresh: true });
    expect(read).not.toHaveBeenCalled();
    expect(facets).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
    rows.resolve({ ok: true, data: { list: { total: 2, items: [] }, facets: { statuses: {} }, summary: { hiring: 0, evaluation: 2 } } });
    expect(await resources.results).toMatchObject({ ok: true, data: { catalog: { total: 2 } } });
    expect(await resources.facets).toEqual({ ok: true, data: { statuses: {} } });
    expect(await resources.scopes).toEqual({ ok: true, data: { hiring: 0, evaluation: 2 } });
    await resources.results;
    expect(combined).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();expect(facets).not.toHaveBeenCalled();expect(summary).not.toHaveBeenCalled();
  });
  it("shares a combined failure without fallback and keeps directory on its existing path", async () => {
    const failed = { ok: false, error: { kind: "timeout" } };
    const readers = { combined: vi.fn().mockResolvedValue(failed), read: vi.fn(), facets: vi.fn(), summary: vi.fn(), directory: vi.fn().mockResolvedValue({ total: 0, items: [] }) };
    const resources = createCatalogResources(normalizeCatalogQuery({}), false, readers);
    expect(await Promise.all([resources.results, resources.facets, resources.scopes])).toEqual([failed, failed, failed]);
    expect(readers.read).not.toHaveBeenCalled();expect(readers.facets).not.toHaveBeenCalled();expect(readers.summary).not.toHaveBeenCalled();
    const directory = createCatalogResources(normalizeCatalogQuery({ view: "all" }), false, readers);
    expect(await directory.results).toMatchObject({ ok: true, data: { data: { total: 0 } } });
    await Promise.all([directory.facets,directory.scopes]);
    expect(readers.combined).toHaveBeenCalledTimes(1);expect(readers.directory).toHaveBeenCalledTimes(1);
  });
  it("retries only the selected resource and preserves network/filter scope", async () => {
    const read = vi.fn();
    const facets = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const summary = vi.fn(), combined = vi.fn();
    await readCatalogResource("facets", normalizeCatalogQuery({ network: "testnet", page: "3", protocol: "mcp", q: "seller" }), true, { read, facets, summary, combined, directory: vi.fn() });
    expect(combined).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
    expect(facets).toHaveBeenCalledTimes(1);
    expect(facets.mock.calls[0]?.[0]).toMatchObject({ chainId: 97, protocols: ["mcp"], q: "seller", fresh: true });
    expect(facets.mock.calls[0]?.[0]).not.toHaveProperty("limit");
  });
  it("does not turn absent facets into zero counts", async () => {
    const facets = vi.fn().mockResolvedValue({ ok: false, error: { kind: "invalid_response" } });
    expect(await readCatalogResource("facets", normalizeCatalogQuery({}), false, { read: vi.fn(), facets, summary: vi.fn(), directory: vi.fn() })).toEqual({ ok: false, error: { kind: "invalid_response" } });
  });
  it("retries cards without calling combined or counters", async () => {
    const readers = { read: vi.fn().mockResolvedValue({ ok: true, data: { items: [], total: 0 } }), combined: vi.fn(), facets: vi.fn(), summary: vi.fn(), directory: vi.fn() };
    expect(await readCatalogResource("results", normalizeCatalogQuery({ page: "2" }), true, readers)).toMatchObject({ ok: true, data: { catalog: { total: 0 } } });
    expect(readers.read).toHaveBeenCalledTimes(1);expect(readers.read.mock.calls[0]?.[0]).toMatchObject({ page: 2, fresh: true });
    expect(readers.combined).not.toHaveBeenCalled();expect(readers.facets).not.toHaveBeenCalled();expect(readers.summary).not.toHaveBeenCalled();
  });
  it("retries availability once and excludes page, search and selected filters", async () => {
    const summary = vi.fn().mockResolvedValue({ ok: true, data: { hiring: 2, evaluation: 3 } });
    const readers = { read: vi.fn(), facets: vi.fn(), summary, directory: vi.fn() };
    expect(await readCatalogResource("scopes", normalizeCatalogQuery({ network: "testnet", page: "3", scope: "hiring", q: "seller", protocol: "mcp" }), true, readers)).toEqual({ ok: true, data: { hiring: 2, evaluation: 3 } });
    expect(summary).toHaveBeenCalledExactlyOnceWith({ chainId: 97, fresh: true });
    expect(readers.read).not.toHaveBeenCalled();
    expect(readers.facets).not.toHaveBeenCalled();
  });
  it("canonicalizes query values, includes page in identity and rejects bad inputs", () => {
    expect(normalizeCatalogQuery({ protocol: ["mcp", "a2a", "mcp"] }).protocols).toEqual(["a2a", "mcp"]);
    expect(normalizeCatalogQuery({ page: "3" }).page).toBe(3);
    expect(() => normalizeCatalogQuery({ network: "other" })).toThrow();
    expect(() => normalizeCatalogQuery({ page: "0" })).toThrow();
    expect(normalizeCatalogQuery({ view: "all", category: "bogus" }).categories).toEqual([]);
  });
});
