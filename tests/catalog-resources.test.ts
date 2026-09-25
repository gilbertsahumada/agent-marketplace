import { describe, expect, it, vi } from "vitest";
import { normalizeCatalogQuery } from "../src/presentation/catalog-query";
import { createCatalogResources, readCatalogResource } from "../src/presentation/catalog-resources";

const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
describe("progressive catalogue coordination", () => {
  it("returns promises immediately and starts secondary reads only after results", async () => {
    const rows = deferred<any>();
    const read = vi.fn().mockImplementationOnce(() => rows.promise);
    const facets = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const summary = vi.fn().mockResolvedValue({ ok: true, data: { hiring: 0, evaluation: 2 } });
    const resources = createCatalogResources(normalizeCatalogQuery({}), false, { read, facets, summary, directory: vi.fn() });
    expect(read).toHaveBeenCalledTimes(1);
    expect(facets).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
    rows.resolve({ ok: true, data: { total: 2, items: [] } });
    expect(await resources.results).toMatchObject({ ok: true, data: { catalog: { total: 2 } } });
    await Promise.all([resources.facets, resources.scopes]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(facets).toHaveBeenCalledTimes(1);
    expect(summary).toHaveBeenCalledExactlyOnceWith({ chainId: 56, fresh: false });
    expect(facets.mock.calls[0]?.[0]).not.toHaveProperty("page");
  });
  it("retries only the selected resource and preserves network/filter scope", async () => {
    const read = vi.fn();
    const facets = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const summary = vi.fn();
    await readCatalogResource("facets", normalizeCatalogQuery({ network: "testnet", page: "3", protocol: "mcp", q: "seller" }), true, { read, facets, summary, directory: vi.fn() });
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
