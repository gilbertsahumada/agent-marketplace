import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { normalizeCatalogQuery } from "../src/presentation/catalog-query";
import type { CatalogResources } from "../src/business/entities/catalog-resource";
import { createCatalogResources } from "../src/presentation/catalog-resources";
import type { CatalogCombinedData } from "../src/data/observation/catalog-candidate-feed";
import type { CatalogReadResult } from "../src/business/entities/catalog-resource";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
vi.mock("../components/marketplace/catalog-page", () => ({ CatalogPage: () => <div>STREAMED_CARDS</div> }));
import { ProgressiveCatalog } from "../components/marketplace/progressive-catalog";
it("streams shell, then results, while aggregates remain unresolved", async () => {
  let resolve!: (data: Awaited<CatalogResources["results"]>) => void;
  let finish!: (data: Awaited<CatalogResources["facets"]>) => void;
  let scopes!: (data: Awaited<CatalogResources["scopes"]>) => void;
  const resources: CatalogResources = { results: new Promise(r => { resolve = r; }), facets: new Promise(r => { finish = r; }), scopes: new Promise(r => { scopes = r; }) };
  const output = new PassThrough(); let html = ""; output.on("data", chunk => { html += chunk.toString(); });
  const ended = new Promise<void>(r => output.on("end", r));
  const stream = renderToPipeableStream(<ProgressiveCatalog query={normalizeCatalogQuery({})} resources={resources} />, { onShellReady() { stream.pipe(output); } });
  await vi.waitFor(() => expect(html).toContain("Find an agent for your next job"));
  expect(html).toContain("Loading services"); expect(html).not.toContain("STREAMED_CARDS");
  resolve({ ok: true, data: { catalog: { total: 1 } as never } });
  await vi.waitFor(() => expect(html).toContain("STREAMED_CARDS"));
  expect(html).toContain("Loading count");
  finish({ ok: false, error: { kind: "timeout" } }); scopes({ ok: true, data: { hiring: 0, evaluation: 8 } });
  await ended;
  expect(html.replaceAll("<!-- -->", "")).toContain("Retry filter counts");
});

it.each([true,false])("streams the real combined coordinator shell before its shared %s result", async success => {
  let resolve!: (value: CatalogReadResult<CatalogCombinedData>) => void;
  const combined=vi.fn(() => new Promise<CatalogReadResult<CatalogCombinedData>>(r => {resolve=r;}));
  const readers={combined,read:vi.fn(),facets:vi.fn(),summary:vi.fn(),directory:vi.fn()};
  const query=normalizeCatalogQuery({});
  const resources=createCatalogResources(query,false,readers);
  const output=new PassThrough(); let html="";
  output.on("data",chunk=>{html+=chunk.toString();});
  const ended=new Promise<void>(r=>output.on("end",r));
  const stream=renderToPipeableStream(<ProgressiveCatalog query={query} resources={resources} />, {onShellReady(){stream.pipe(output);}});
  try {
    await vi.waitFor(()=>expect(html).toContain("Find an agent for your next job"));
    expect(html).toContain("Loading services");expect(html).toContain("Loading count");
    expect(html).not.toContain("STREAMED_CARDS");expect(combined).toHaveBeenCalledOnce();
    if(success) resolve({ok:true,data:{list:{total:3} as never,facets:{statuses:{},categories:{},protocols:{},reachability:{}} as never,summary:{hiring:3,evaluation:8}}});
    else resolve({ok:false,error:{kind:"timeout"}});
    await ended;
    const plain=html.replaceAll("<!-- -->","");
    if(success) {expect(plain).toContain("STREAMED_CARDS");expect(plain).not.toContain("Retry filter counts");}
    else {expect(plain).toContain("Retry results");expect(plain).toContain("Retry filter counts");expect(plain).toContain("Retry availability counts");expect(plain).not.toContain("STREAMED_CARDS");}
    expect(combined).toHaveBeenCalledOnce();
    expect(readers.read).not.toHaveBeenCalled();expect(readers.facets).not.toHaveBeenCalled();expect(readers.summary).not.toHaveBeenCalled();
  } finally {stream.abort();output.destroy();}
});
