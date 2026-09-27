import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { catalogCombinedResponse, catalogCurrentFacetsResponse, catalogCurrentSummaryResponse } from '../../src/routes/catalog-combined';
import { beginPublicCurrentBackfill, stepPublicCurrentBackfill, publicCurrentProjectionReady } from '../../src/catalog/public-current-backfill';
import { catalogAgentsResponse as oldList, catalogFacetsResponse as oldFacets, catalogSummaryResponse as oldSummary } from '../fixtures/public-read-reference/catalog-agents';
import { seedPublicEnriched, completeProjectionFixture, NOW } from './public-enriched-fixture';
import { metered, type ReadRecord } from './d1-meter';

const request = (path:string) => new Request(`https://worker.test${path}`);
const metrics = (log:ReadRecord[]) => ({queries:log.length,rowsRead:log.reduce((sum,row)=>sum+row.rowsRead,0),rowsWritten:log.reduce((sum,row)=>sum+row.rowsWritten,0),d1DurationMs:log.reduce((sum,row)=>sum+row.durationMs,0)});
const gates:Record<string,{before:number;max:number}> = {
  'scope=hiring':{before:1221818,max:122181},
  'scope=evaluation':{before:1631632,max:163163},
  'scope=evaluation&protocol=mcp&category=grid_trading&reachability=live':{before:1869721,max:186972},
};

for (const count of [2000,20000]) it(`validates the production combined endpoint cold-read gates at ${count} agents`,async context => {
  await seedPublicEnriched(count);
  await completeProjectionFixture();
  const construction:ReadRecord[]=[];
  const constructionDb=metered(env.DB,construction);
  await beginPublicCurrentBackfill(constructionDb);
  let complete=false;
  // Isolated fixture admission only, not deployment authorization. Existing
  // release-level admission and its US$0.25 limit are tested separately.
  for(let page=0;page<Math.ceil(count*3/40)+10;page++) {
    const outcome=await stepPublicCurrentBackfill(constructionDb,200_000_000,`cost-${count}-${page}`);
    if(outcome==='complete'){complete=true;break;}
    expect(outcome).toBe('progress');
  }
  expect(complete).toBe(true); expect(await publicCurrentProjectionReady(env.DB)).toBe(true);
  const comparisons=[];
  for(const query of Object.keys(gates)) {
    const before:ReadRecord[]=[],after:ReadRecord[]=[];
    const oldDb=metered(env.DB,before);
    const expected={
      list:await(await oldList(request(`/catalog-agents?status=declared&${query}&limit=24`),oldDb,NOW)).json(),
      facets:await(await oldFacets(request(`/catalog-facets?status=declared&${query}`),oldDb,NOW)).json(),
      summary:await(await oldSummary(request('/catalog-summary'),oldDb,NOW)).json(),
    };
    const response=await catalogCombinedResponse(request(`/catalog-combined?status=declared&${query}&limit=24`),metered(env.DB,after),NOW);
    expect(response.status).toBe(200);
    const actual=await response.json();
    expect(actual).toEqual(expected); expect(Object.keys(actual as object).sort()).toEqual(['facets','list','summary']);
    const oldMetrics=metrics(before),newMetrics=metrics(after);
    expect(newMetrics.rowsWritten).toBe(0);
    expect(newMetrics.queries).toBeLessThanOrEqual(13);
    if(count===20000){
      expect(oldMetrics.rowsRead,'frozen source reads').toBe(gates[query]!.before);
      expect(newMetrics.rowsRead,query).toBeLessThanOrEqual(gates[query]!.max);
      expect(newMetrics.rowsRead).toBeLessThanOrEqual(oldMetrics.rowsRead*0.1);
    } else expect(newMetrics.rowsRead).toBeLessThanOrEqual(oldMetrics.rowsRead*0.2);
    const classifier=after.find(row=>row.sql.includes('WITH endpoint_flags'))!;
    expect(classifier).toBeDefined();
    const plan=(await env.DB.prepare(`EXPLAIN QUERY PLAN ${classifier.sql}`).bind(...classifier.values).all()).results;
    comparisons.push({query,before:oldMetrics,after:newMetrics,reductionFraction:1-newMetrics.rowsRead/oldMetrics.rowsRead,queryReads:after.map(row=>row.rowsRead),plan});
  }
  const secondary=[];
  const secondaryExpected=new Map<string,unknown>();
  for(const chain of [56,97]) for(const resource of ['facets','summary'] as const) {
    const url=resource==='facets'?`/catalog-facets?chain=${chain}&status=declared`:`/catalog-summary?chain=${chain}`;
    const req=request(url),log:ReadRecord[]=[];
    const expected=await(await (resource==='facets'?oldFacets:oldSummary)(req,env.DB,NOW,true)).json();
    secondaryExpected.set(`${chain}:${resource}`,expected);
    const response=await(resource==='facets'?catalogCurrentFacetsResponse:catalogCurrentSummaryResponse)(req,metered(env.DB,log),NOW,true);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(expected);
    expect(metrics(log).rowsWritten).toBe(0); expect(log.length).toBe(3);
    expect(metrics(log).rowsRead).toBeLessThanOrEqual(count===2000?44737:218208);
    // The only data relation is classification: no page/card enrichment query.
    expect(log.filter(row=>row.sql.includes('WITH endpoint_flags'))).toHaveLength(1);
    secondary.push({chain,resource,statistics:'default',...metrics(log)});
  }
  // Do not mutate planner state before capturing the larger fixture's frozen
  // baseline. The adversarial absent-statistics pass runs after that baseline.
  if(count===20000) {
  await env.DB.prepare('ANALYZE').run();
  await env.DB.prepare('DELETE FROM sqlite_stat1').run();
  await env.DB.prepare('ANALYZE sqlite_schema').run();
  for(const chain of [56,97]) for(const resource of ['facets','summary'] as const) {
    const req=request(resource==='facets'?`/catalog-facets?chain=${chain}&status=declared`:`/catalog-summary?chain=${chain}`);
    const log:ReadRecord[]=[];
    const response=await(resource==='facets'?catalogCurrentFacetsResponse:catalogCurrentSummaryResponse)(req,metered(env.DB,log),NOW,true);
    expect(response.status).toBe(200);expect(await response.json()).toEqual(secondaryExpected.get(`${chain}:${resource}`));
    expect(metrics(log).rowsWritten).toBe(0);expect(log.length).toBe(3);
    expect(metrics(log).rowsRead).toBeLessThanOrEqual(218208);
    secondary.push({chain,resource,statistics:'absent',...metrics(log)});
  }
  }
  const evidence={kind:'production-catalog-combined-cold',count,construction:metrics(construction),comparisons,secondary};
  (context.task.meta as Record<string,unknown>).d1Cost=evidence;
  console.log(JSON.stringify(evidence));
  await context.annotate(JSON.stringify(evidence),'d1-cost-evidence');
},300_000);
