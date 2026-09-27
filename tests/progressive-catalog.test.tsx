// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeCatalogQuery } from "../src/presentation/catalog-query";
import type { CatalogResources } from "../src/business/entities/catalog-resource";
import { createCatalogResources } from "../src/presentation/catalog-resources";
import type { CatalogReadResult } from "../src/business/entities/catalog-resource";
import type { CatalogCombinedData } from "../src/data/observation/catalog-candidate-feed";
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../components/marketplace/catalog-page", () => ({ CatalogPage: ({ catalog }: { catalog: { total: number } }) => <div>Cards: {catalog.total}</div> }));
import { ProgressiveCatalog } from "../components/marketplace/progressive-catalog";
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const rows = deferred<Awaited<CatalogResources["results"]>>();
  const facets = deferred<Awaited<CatalogResources["facets"]>>();
  const scopes = deferred<Awaited<CatalogResources["scopes"]>>();
  return { rows, facets, scopes, resources: { results: rows.promise, facets: facets.promise, scopes: scopes.promise } };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("progressive catalogue sections", () => {
  it("shows the shell before data, then cards and enabled controls without counts or hydration requests", async () => {
    const f = fixture(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await act(async () => { render(<ProgressiveCatalog query={normalizeCatalogQuery({})} resources={f.resources} />); });
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search agents" })).toBeDisabled();
    expect(screen.getByTestId("agents-loading-results")).toBeTruthy();
    await act(async () => f.rows.resolve({ ok: true, data: { catalog: { total: 24 } as never } }));
    expect(await screen.findByText("Cards: 24")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Search agents" })).toBeEnabled());
    expect(screen.getAllByLabelText("Loading count").length).toBeGreaterThan(0);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Under evaluation", { selector: "input" }));
    expect(screen.queryByText("Cards: 24")).toBeNull();
    expect(screen.getByTestId("agents-loading-results")).toBeTruthy();
    expect(router.push).toHaveBeenCalledOnce();
  });
  it("keeps controls on failure and retries only results once", async () => {
    const f = fixture(); const response = deferred<Response>(); const fetcher = vi.fn((_url: string) => response.promise); vi.stubGlobal("fetch", fetcher);
    await act(async () => { render(<ProgressiveCatalog query={normalizeCatalogQuery({ network: "testnet" })} resources={f.resources} />); });
    await act(async () => f.rows.resolve({ ok: false, error: { kind: "timeout" } }));
    expect(await screen.findByText("This is taking longer than expected.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry results" })); });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toContain("resource=results");
    expect(fetcher.mock.calls[0]?.[0]).toContain("network=testnet");
    expect(screen.queryByRole("button", { name: "Retry results" })).toBeNull();
    await act(async () => response.resolve(Response.json({ ok: true, data: { catalog: { total: 2 } } })));
    expect(await screen.findByText("Cards: 2")).toBeTruthy();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("retrying counts never re-fetches cards and old-network results cannot replace the new query", async () => {
    const old = fixture(); const next = fixture(); const response = deferred<Response>();
    const fetcher = vi.fn((_url: string) => response.promise); vi.stubGlobal("fetch", fetcher);
    let rerender!: ReturnType<typeof render>["rerender"];
    await act(async () => { ({ rerender } = render(<ProgressiveCatalog key="mainnet" query={normalizeCatalogQuery({})} resources={old.resources} />)); });
    await act(async () => { old.rows.resolve({ ok: true, data: { catalog: { total: 3 } as never } }); old.facets.resolve({ ok: false, error: { kind: "network" } }); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Retry filter counts" })); });
    expect(fetcher.mock.calls[0]?.[0]).toContain("resource=facets");
    expect(screen.getByText("Cards: 3")).toBeTruthy();
    await act(async () => { rerender(<ProgressiveCatalog key="testnet" query={normalizeCatalogQuery({ network: "testnet" })} resources={next.resources} />); });
    await act(async () => { response.resolve(Response.json({ ok: true, data: { statuses: { requestable: 99 } } })); next.rows.resolve({ ok: true, data: { catalog: { total: 7 } as never } }); });
    expect(await screen.findByText("Cards: 7")).toBeTruthy();
    expect(screen.queryByText("Cards: 3")).toBeNull();
    expect(screen.queryByText("99")).toBeNull();
  });
  it("resolves the actual shared coordinator into cards and all counts without browser requests",async()=>{
    const pending=deferred<CatalogReadResult<CatalogCombinedData>>();
    const readers={combined:vi.fn(()=>pending.promise),read:vi.fn(),facets:vi.fn(),summary:vi.fn(),directory:vi.fn()};
    const query=normalizeCatalogQuery({});const resources=createCatalogResources(query,false,readers);
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    await act(async()=>{render(<ProgressiveCatalog query={query} resources={resources}/>);});
    expect(screen.getByTestId("agents-loading-results")).toBeTruthy();
    expect(screen.getAllByLabelText("Loading count").length).toBeGreaterThan(0);
    await act(async()=>pending.resolve({ok:true,data:{list:{total:3} as never,facets:{statuses:{},categories:{},protocols:{},reachability:{}} as never,summary:{hiring:3,evaluation:8}}}));
    expect(await screen.findByText("Cards: 3")).toBeTruthy();
    await waitFor(()=>expect(screen.queryAllByLabelText("Loading count")).toHaveLength(0));
    expect(screen.getByRole("textbox",{name:"Search agents"})).toBeEnabled();
    expect(readers.combined).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled();
    expect(readers.read).not.toHaveBeenCalled();expect(readers.facets).not.toHaveBeenCalled();expect(readers.summary).not.toHaveBeenCalled();
  });
  it("keeps combined old-network success from restoring cards after navigation",async()=>{
    const old=deferred<CatalogReadResult<CatalogCombinedData>>(),next=deferred<CatalogReadResult<CatalogCombinedData>>();
    const readers={combined:vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise),read:vi.fn(),facets:vi.fn(),summary:vi.fn(),directory:vi.fn()};
    const firstQuery=normalizeCatalogQuery({}),nextQuery=normalizeCatalogQuery({network:"testnet"});
    const first=createCatalogResources(firstQuery,false,readers),second=createCatalogResources(nextQuery,false,readers);
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    let rerender!:ReturnType<typeof render>["rerender"];
    await act(async()=>{({rerender}=render(<ProgressiveCatalog key="mainnet" query={firstQuery} resources={first}/>));});
    await act(async()=>{rerender(<ProgressiveCatalog key="testnet" query={nextQuery} resources={second}/>);});
    const data=(total:number):CatalogReadResult<CatalogCombinedData>=>({ok:true,data:{list:{total} as never,facets:{statuses:{},categories:{},protocols:{},reachability:{}} as never,summary:{hiring:total,evaluation:0}}});
    await act(async()=>old.resolve(data(99)));
    expect(screen.queryByText("Cards: 99")).toBeNull();expect(screen.getByTestId("agents-loading-results")).toBeTruthy();
    await act(async()=>next.resolve(data(7)));
    expect(await screen.findByText("Cards: 7")).toBeTruthy();expect(screen.queryByText("99")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();expect(readers.combined).toHaveBeenCalledTimes(2);
  });
});
