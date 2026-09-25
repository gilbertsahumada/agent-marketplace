import { describe, expect, it, vi } from "vitest";
import { normalizeCatalogQuery } from "../src/presentation/catalog-query";
import { createCatalogResources, readCatalogResource } from "../src/presentation/catalog-resources";

const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
describe("progressive catalogue coordination", () => {
  it("returns promises immediately and starts secondary reads only after results", async () => {
    const rows = deferred<any>();
    const read = vi.fn().mockImplementationOnce(() => rows.promise).mockResolvedValue({ ok: true, data: { total: 0, facets: {} } });
    const resources = createCatalogResources(normalizeCatalogQuery({}), false, { read, directory: vi.fn() });
    expect(read).toHaveBeenCalledTimes(1);
    rows.resolve({ ok: true, data: { total: 2, items: [] } });
    expect(await resources.results).toMatchObject({ ok: true, data: { catalog: { total: 2 } } });
    await Promise.all([resources.facets, resources.scopes]);
    expect(read).toHaveBeenCalledTimes(4);
    expect(read.mock.calls[1]?.[0]).toMatchObject({ page: 1, limit: 1, includeFacets: true });
  });
  it("retries only the selected resource and preserves network/filter scope", async () => {
    const read = vi.fn().mockResolvedValue({ ok: true, data: { facets: {} } });
    await readCatalogResource("facets", normalizeCatalogQuery({ network: "testnet", page: "3", protocol: "mcp", q: "seller" }), true, { read, directory: vi.fn() });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toMatchObject({ chainId: 97, page: 1, limit: 1, protocols: ["mcp"], q: "seller", fresh: true });
  });
  it("does not turn absent facets into zero counts", async () => {
    const read = vi.fn().mockResolvedValue({ ok: true, data: { total: 0 } });
    expect(await readCatalogResource("facets", normalizeCatalogQuery({}), false, { read, directory: vi.fn() })).toEqual({ ok: false, error: { kind: "invalid_response" } });
  });
  it("canonicalizes query values, includes page in identity and rejects bad inputs", () => {
    expect(normalizeCatalogQuery({ protocol: ["mcp", "a2a", "mcp"] }).protocols).toEqual(["a2a", "mcp"]);
    expect(normalizeCatalogQuery({ page: "3" }).page).toBe(3);
    expect(() => normalizeCatalogQuery({ network: "other" })).toThrow();
    expect(() => normalizeCatalogQuery({ page: "0" })).toThrow();
    expect(normalizeCatalogQuery({ view: "all", category: "bogus" }).categories).toEqual([]);
  });
});
