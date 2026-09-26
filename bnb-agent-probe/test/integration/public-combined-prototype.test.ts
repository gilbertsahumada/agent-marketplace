import { env } from "cloudflare:workers";
import { expect,it } from "vitest";
import { constructDensePrototype } from "../prototypes/dense-public-classification";
import { prototypeCombinedResponse,prototypeFacetsResponse } from "../prototypes/public-combined-prototype";
import { catalogAgentsResponse as oldList,catalogFacetsResponse as oldFacets,catalogSummaryResponse as oldSummary } from "../fixtures/public-read-reference/catalog-agents";
import { completeProjectionFixture,NOW,seedPublicEnriched } from "./public-enriched-fixture";
import { metered,type ReadRecord } from "./d1-meter";

const req = (path:string) => new Request(`https://worker.test${path}`);
const frozenSourceResponses = new Map<number,{list:unknown;facets:unknown;summary:unknown}>();
const metrics = (log:ReadRecord[]) => ({ queries:log.length,rowsRead:log.reduce((n,r)=>n+r.rowsRead,0),
  rowsWritten:log.reduce((n,r)=>n+r.rowsWritten,0),d1DurationMs:log.reduce((n,r)=>n+r.durationMs,0) });

it("matches the three source contracts before benchmarking the dense prototype",async()=>{
  await seedPublicEnriched(30);
  // Registry agents without declarations must survive the dense left join.
  await env.DB.prepare("DELETE FROM catalog_agent_endpoints WHERE agentKey='eip155:56:100002'").run();
  await env.DB.prepare("UPDATE catalog_agents SET registeredAt=NULL,categoriesJson='[\"grid_trading\",\"grid_trading\",\"rebalancing\"]' WHERE agentId='100010'").run();
  await completeProjectionFixture();
  await constructDensePrototype(env.DB);
  for (const now of [NOW,NOW+1000,NOW+3600000]) for (const query of ["status=declared","scope=hiring","scope=evaluation",
    "inventory=registry","protocol=mcp&category=grid_trading&reachability=live","q=Agent%201","status=quote_failed",
    "quote=verified","quote=expired","quote=missing","commerce=suspended","commerce=candidate","commerce=none",
    "latestFailure=true","latestFailure=false","chain=97","page=999","page=2","status=completed_jobs",
    "status=requestable&status=pending","protocol=a2a&protocol=mcp","category=grid_trading&category=rebalancing",
    "reachability=historical","reachability=never","reachability=browser_observed","q=%25","q=%5F"]) {
    const current = await (await prototypeCombinedResponse(req(`/catalog-agents?${query}&limit=3`),env.DB,now)).json() as {list:unknown;facets:unknown;summary:unknown};
    expect(current.list,query).toEqual(await (await oldList(req(`/catalog-agents?${query}&limit=3`),env.DB,now)).json());
    const facetParams=new URLSearchParams(query);
    facetParams.delete("page");
    expect(current.facets,query).toEqual(await (await oldFacets(req(`/catalog-facets?${facetParams}`),env.DB,now)).json());
    expect(current.summary,query).toEqual(await (await oldSummary(req(query.includes("chain=97")?"/catalog-summary?chain=97":"/catalog-summary"),env.DB,now)).json());
  }
  // No dense-row refresh: global blocks must affect the very next read.
  await env.DB.prepare("UPDATE catalog_endpoints SET eligibility='unsafe',safety='unsafe' WHERE representativeAgentKey='eip155:56:100000'").run();
  const current = await (await prototypeCombinedResponse(req("/catalog-agents?scope=hiring&limit=3"),env.DB,NOW)).json() as {list:unknown;facets:unknown;summary:unknown};
  expect(current.list).toEqual(await (await oldList(req("/catalog-agents?scope=hiring&limit=3"),env.DB,NOW)).json());
  expect(current.facets).toEqual(await (await oldFacets(req("/catalog-facets?scope=hiring"),env.DB,NOW)).json());
  expect(current.summary).toEqual(await (await oldSummary(req("/catalog-summary"),env.DB,NOW)).json());
  const first = await (await oldList(req("/catalog-agents?inventory=registry&limit=3"),env.DB,NOW)).json() as {nextCursor?:string|null};
  expect(first.nextCursor).toBeTruthy();
  if (first.nextCursor) {
    const query=`inventory=registry&limit=3&cursor=${encodeURIComponent(first.nextCursor)}`;
    const next=await(await prototypeCombinedResponse(req(`/catalog-agents?${query}`),env.DB,NOW)).json() as {list:unknown};
    expect(next.list).toEqual(await(await oldList(req(`/catalog-agents?${query}`),env.DB,NOW)).json());
  }
},120_000);

it("preserves enabled Testnet, v1, non-array category JSON and literal search characters",async()=>{
  await seedPublicEnriched(30);
  await env.DB.prepare("UPDATE catalog_agents SET categoriesJson=?,name=? WHERE agentId='100010'")
    .bind(JSON.stringify({primary:"grid_trading",secondary:"rebalancing"}),"Agent O'Reilly\\demo").run();
  await env.DB.prepare("UPDATE catalog_agents SET categoriesJson=? WHERE agentId='100012'")
    .bind(JSON.stringify("grid_trading")).run();
  await completeProjectionFixture();
  await constructDensePrototype(env.DB);
  for(const version of [1,2] as const) for(const query of ["chain=97","chain=97&scope=hiring","category=grid_trading","q=O%27Reilly","q=%5C"]) {
    const actual=await(await prototypeCombinedResponse(req(`/catalog-agents?${query}&limit=3`),env.DB,NOW,version,true)).json() as {list:unknown;facets:unknown;summary:unknown};
    expect(actual.list,`${version}:${query}`).toEqual(await(await oldList(req(`/catalog-agents?${query}&limit=3`),env.DB,NOW,version,true)).json());
    expect(actual.facets,`${version}:${query}`).toEqual(await(await oldFacets(req(`/catalog-facets?${query}`),env.DB,NOW,true)).json());
    expect(actual.summary,`${version}:${query}`).toEqual(await(await oldSummary(req(query.includes("chain=97")?"/catalog-summary?chain=97":"/catalog-summary"),env.DB,NOW,true)).json());
  }
},120_000);

it.each([2_000,20_000])("measures the dense combined prototype at %i agents",async count=>{
  await seedPublicEnriched(count);
  await completeProjectionFixture();
  const construction:ReadRecord[]=[];
  await constructDensePrototype(metered(env.DB,construction));
  console.log(JSON.stringify({operation:"dense-prototype-construction",count,...metrics(construction)}));
  const comparisons:{query:string;before:number;after:number}[]=[];
  for (const query of ["scope=hiring","scope=evaluation","scope=evaluation&protocol=mcp&category=grid_trading&reachability=live"]) {
    const oldLog:ReadRecord[]=[];
    const oldDb=metered(env.DB,oldLog);
    const expected={list:await(await oldList(req(`/catalog-agents?status=declared&${query}&limit=24`),oldDb,NOW)).json(),
      facets:await(await oldFacets(req(`/catalog-facets?status=declared&${query}`),oldDb,NOW)).json(),
      summary:await(await oldSummary(req("/catalog-summary"),oldDb,NOW)).json()};
    const log:ReadRecord[]=[];
    const actual=await(await prototypeCombinedResponse(req(`/catalog-agents?status=declared&${query}&limit=24`),metered(env.DB,log),NOW)).json() as typeof expected & {prototypeDiagnostics:unknown};
    expect({list:actual.list,facets:actual.facets,summary:actual.summary}).toEqual(expected);
    expect(metrics(log).rowsWritten).toBe(0);
    console.log(JSON.stringify({operation:"dense-prototype-cold",count,query,before:metrics(oldLog),after:metrics(log),diagnostics:actual.prototypeDiagnostics,
      queryReads:log.map(row=>row.rowsRead)}));
    comparisons.push({query,before:metrics(oldLog).rowsRead,after:metrics(log).rowsRead});
    if(query==="scope=hiring"){
      frozenSourceResponses.set(count,expected);
      const classified=log.find(row=>row.sql.includes("prototype_public_current_endpoints"))!;
      console.log(JSON.stringify({operation:"dense-prototype-plan",count,plan:(await env.DB.prepare(`EXPLAIN QUERY PLAN ${classified.sql}`).bind(...classified.values).all()).results}));
    }
  }
  const facetLog:ReadRecord[]=[];
  expect(await(await prototypeFacetsResponse(req("/catalog-facets?status=declared"),metered(env.DB,facetLog),NOW)).json())
    .toEqual(await(await oldFacets(req("/catalog-facets?status=declared"),env.DB,NOW)).json());
  console.log(JSON.stringify({operation:"dense-prototype-standalone-facets",count,...metrics(facetLog)}));
  expect(metrics(facetLog).rowsWritten).toBe(0);
  expect(metrics(facetLog).rowsRead).toBeLessThanOrEqual(count===2000?44737:218208);
  if(count===20000) {
    const frozenGates: Record<string,{before:number;maximum:number}> = {
      "scope=hiring":{before:1221818,maximum:122181},
      "scope=evaluation":{before:1631632,maximum:163163},
      "scope=evaluation&protocol=mcp&category=grid_trading&reachability=live":{before:1869721,maximum:186972},
    };
    for(const result of comparisons) {
      const gate=frozenGates[result.query]!;
      expect(result.before,`Frozen source changed: ${result.query}`).toBe(gate.before);
      expect(result.after,result.query).toBeLessThanOrEqual(gate.maximum);
    }
  }
},300_000);

it("retains source output and fixed cost gates with complete, partial and absent planner statistics",async()=>{
  for(const count of [2000,20000]) {
  await seedPublicEnriched(count);
  await completeProjectionFixture();
  await constructDensePrototype(env.DB);
  const expected=frozenSourceResponses.get(count);
  expect(expected,"Source contracts must have been frozen before changing planner statistics").toBeDefined();
  // No dependence on fresh ANALYZE statistics: fixed cold gates apply to every
  // planner state, while output is compared to the original source contracts.
  for (const statistics of ["complete","partial","absent"] as const) {
    await env.DB.prepare("ANALYZE").run();
    if(statistics!=="complete") await env.DB.prepare(statistics==="absent"
      ? "DELETE FROM sqlite_stat1"
      : "DELETE FROM sqlite_stat1 WHERE tbl IN ('catalog_endpoints','catalog_quote_attempts','catalog_public_agent_metrics')").run();
    await env.DB.prepare("ANALYZE sqlite_schema").run();
    const log:ReadRecord[]=[];
    const actual=await(await prototypeCombinedResponse(req("/catalog-agents?status=declared&scope=hiring&limit=24"),metered(env.DB,log),NOW)).json() as {list:unknown;facets:unknown;summary:unknown;prototypeDiagnostics:unknown};
    expect({list:actual.list,facets:actual.facets,summary:actual.summary}).toEqual(expected);
    expect(metrics(log).rowsWritten).toBe(0);
    if(count===20000) expect(metrics(log).rowsRead,statistics).toBeLessThanOrEqual(122181);
    console.log(JSON.stringify({operation:"dense-prototype-planner",count,statistics,...metrics(log),diagnostics:actual.prototypeDiagnostics}));
  }
  }
},300_000);
