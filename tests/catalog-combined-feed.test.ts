import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CATALOG_STATUSES} from '../src/business/entities/catalog-candidate';
import {MARKETPLACE_CATEGORIES} from '../src/business/entities/marketplace-agent';
import {getCatalogCombinedResult,invalidateCatalogCandidateCache} from '../src/data/observation/catalog-candidate-feed';
import {createCatalogResources} from '../src/presentation/catalog-resources';
import {normalizeCatalogQuery} from '../src/presentation/catalog-query';
const env={OBSERVATIONS_URL:'https://combined-worker.example/observations',BUYER_OBSERVATION_SECRET:'test-secret'};
const counts={hiring:2,evaluation:8};
const facetCounts={statuses:Object.fromEntries(CATALOG_STATUSES.map(key=>[key,0])),categories:Object.fromEntries(MARKETPLACE_CATEGORIES.map(key=>[key,0])),protocols:{a2a:0,mcp:0,erc8183_http:0},reachability:{live:0,historical:0,never:0,browser_observed:0}};
function body(chainId:56|97=56){const fixture=JSON.parse(readFileSync(new URL('../contracts/catalog-api-v2.fixtures.json',import.meta.url),'utf8'));return{list:{...fixture.list,chainId,items:fixture.list.items.map((item:any)=>({...item,chainId,agentKey:`eip155:${chainId}:${item.agentId}`}))},facets:{schemaVersion:2,chainId,generatedAt:1,facets:facetCounts},summary:{schemaVersion:2,chainId,generatedAt:1,counts}};}
beforeEach(invalidateCatalogCandidateCache);
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
it('the default marketplace coordinator performs one actual fetch for all three sections',async()=>{
 vi.stubEnv('OBSERVATIONS_URL',env.OBSERVATIONS_URL);const fetcher=vi.fn<typeof fetch>(async()=>Response.json(body()));vi.stubGlobal('fetch',fetcher);
 const resources=createCatalogResources(normalizeCatalogQuery({}),false);
 const sections=await Promise.all([resources.results,resources.facets,resources.scopes]);expect(sections.every(section=>section.ok)).toBe(true);
 expect(fetcher).toHaveBeenCalledTimes(1);expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe('/catalog-combined');
});
it('uses one combined URL, deduplicates concurrent reads and preserves the complete filter key',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json(body(97)));vi.stubGlobal('fetch',fetcher);
 const input={chainId:97 as const,page:3,limit:24,statuses:[] as [],protocols:['mcp' as const],scope:'evaluation' as const,q:'seller',env};
 const results=await Promise.all([getCatalogCombinedResult(input),getCatalogCombinedResult(input)]);
 expect(results[0]).toMatchObject({ok:true,data:{list:{chainId:97},facets:facetCounts,summary:counts}});expect(results[1]).toEqual(results[0]);expect(fetcher).toHaveBeenCalledTimes(1);
 expect(Object.fromEntries(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams)).toEqual({chain:'97',status:'declared',page:'3',limit:'24',protocol:'mcp',scope:'evaluation',q:'seller'});
 expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe('/catalog-combined');
 await getCatalogCombinedResult(input);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('isolates network caches and bypasses caches for authenticated buyer refresh',async()=>{
 const fetcher=vi.fn<typeof fetch>(async url=>Response.json(body(new URL(String(url)).searchParams.get('chain')==='97'?97:56)));vi.stubGlobal('fetch',fetcher);
 for(const chainId of [56,97] as const)await getCatalogCombinedResult({chainId,page:1,limit:24,env});
 await getCatalogCombinedResult({chainId:56,page:1,limit:24,fresh:true,env});expect(fetcher).toHaveBeenCalledTimes(3);
 expect(fetcher.mock.calls[2]?.[1]).toMatchObject({cache:'no-store',headers:{authorization:'Bearer test-secret','x-marketplace-refresh':'1'}});expect(String(fetcher.mock.calls[2]?.[0])).not.toContain('secret');
});
it.each(['list','facets','summary'] as const)('rejects cross-network %s with no fallback',async(section)=>{
 const invalid=body();invalid[section].chainId=97;const fetcher=vi.fn(async()=>Response.json(invalid));vi.stubGlobal('fetch',fetcher);
 expect(await getCatalogCombinedResult({page:1,limit:24,env})).toMatchObject({ok:false,error:{kind:'invalid_response'}});expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([{}, {...body(),facets:null},{...body(),summary:{...body().summary,counts:{hiring:-1,evaluation:0}}}])('rejects incomplete combined payloads',async invalid=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json(invalid)));expect(await getCatalogCombinedResult({page:1,limit:24,env})).toMatchObject({ok:false,error:{kind:'invalid_response'}});});
it.each([6000,15000])('preserves the 15-second deadline (response delay %i)',async delay=>{
 vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const c=new AbortController();setTimeout(()=>c.abort(),ms);return c.signal;});
 const fetcher=vi.fn((_url:unknown,init?:RequestInit)=>new Promise<Response>((resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('timeout')));if(delay===6000)setTimeout(()=>resolve(Response.json(body())),delay);}));vi.stubGlobal('fetch',fetcher);
 const result=getCatalogCombinedResult({page:1,limit:24,fresh:true,env});await vi.advanceTimersByTimeAsync(delay);
 expect(await result).toMatchObject(delay===6000?{ok:true}:{ok:false,error:{kind:'timeout'}});expect(fetcher).toHaveBeenCalledTimes(1);vi.clearAllTimers();
});
it('propagates upstream failure without calling expensive old routes',async()=>{const fetcher=vi.fn(async()=>new Response(null,{status:503}));vi.stubGlobal('fetch',fetcher);expect(await getCatalogCombinedResult({page:1,limit:24,env})).toEqual({ok:false,error:{kind:'upstream',status:503}});expect(fetcher).toHaveBeenCalledTimes(1);});
it('does not cache a network failure or start an automatic retry',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(Response.json(body()));vi.stubGlobal('fetch',fetcher);
 const input={page:1,limit:24,env};expect(await getCatalogCombinedResult(input)).toEqual({ok:false,error:{kind:'network'}});expect(fetcher).toHaveBeenCalledTimes(1);
 expect(await getCatalogCombinedResult(input)).toMatchObject({ok:true});expect(fetcher).toHaveBeenCalledTimes(2);
});
