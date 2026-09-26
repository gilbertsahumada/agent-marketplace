import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { catalogAgentsResponse as referenceList, catalogFacetsResponse as referenceFacets, catalogSummaryResponse as referenceSummary } from "../fixtures/public-read-reference/catalog-agents";
import { catalogAgentResponse as referenceDetail } from "../fixtures/public-read-reference/catalog-agent";
import { catalogFacetsResponse, catalogSummaryResponse } from "../../src/routes/catalog-agents";
import { catalogAgentResponse } from "../../src/routes/catalog-agent";
import {catalogCombinedResponse} from '../../src/routes/catalog-combined';
import { metered, type ReadRecord } from "./d1-meter";
import { NOW, seedPublicEnriched, completeProjectionFixture } from "./public-enriched-fixture";

const request = (path: string) => new Request(`https://worker.test${path}`);
const metrics = (log: ReadRecord[]) => ({ queries: log.length,
  rowsRead: log.reduce((sum,row) => sum+row.rowsRead,0), rowsWritten: log.reduce((sum,row) => sum+row.rowsWritten,0),
  d1DurationMs: log.reduce((sum,row) => sum+row.durationMs,0) });

it.each([2_000,20_000])("compares compact readers with the enriched immutable reference at %i agents", async count => {
  await seedPublicEnriched(count);
  await completeProjectionFixture();
  const summaryLog: ReadRecord[] = [];
  const summary = await (await referenceSummary(request("/catalog-summary"),metered(env.DB,summaryLog),NOW)).json() as { counts: { hiring: number; evaluation: number } };
  expect(summary.counts.hiring).toBeGreaterThan(0);
  expect(summary.counts.evaluation).toBeGreaterThan(0);
  const facetLog: ReadRecord[] = [];
  const facets = await (await referenceFacets(request("/catalog-facets?status=declared"),metered(env.DB,facetLog),NOW)).json();
  const newFacetsLog: ReadRecord[] = [];
  const newSummaryLog: ReadRecord[] = [];
  expect(await (await catalogFacetsResponse(request("/catalog-facets?status=declared"),metered(env.DB,newFacetsLog),NOW)).json()).toEqual(facets);
  expect(await (await catalogSummaryResponse(request("/catalog-summary"),metered(env.DB,newSummaryLog),NOW)).json()).toEqual(summary);
  if (count === 2000) {
    const entry = newFacetsLog.find(row => row.sql.includes("endpoint_flags"))!;
    console.log(JSON.stringify({ operation: "compact-facet-plan", plan: (await env.DB.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).bind(...entry.values).all()).results }));
    const scopeEntry = newSummaryLog.find(row => row.sql.includes("endpoint_flags"))!;
    console.log(JSON.stringify({ operation: "compact-summary-plan", plan: (await env.DB.prepare(`EXPLAIN QUERY PLAN ${scopeEntry.sql}`).bind(...scopeEntry.values).all()).results }));
  }
  const comparisons: { query: string; before: number; after: number }[] = [];
  for (const query of ["scope=hiring", "scope=evaluation", "scope=evaluation&protocol=mcp&category=grid_trading&reachability=live"]) {
    const log: ReadRecord[] = [];
    const list = await (await referenceList(request(`/catalog-agents?status=declared&${query}&limit=24`),metered(env.DB,log),NOW)).json();
    await referenceFacets(request(`/catalog-facets?status=declared&${query}`),metered(env.DB,log),NOW);
    await referenceSummary(request("/catalog-summary"),metered(env.DB,log),NOW);
    const currentLog: ReadRecord[] = [];
    // Approved B design: one operation shares classification across all three resources.
    const combined=await(await catalogCombinedResponse(request(`/catalog-combined?status=declared&${query}&limit=24`),metered(env.DB,currentLog),NOW)).json() as {list:unknown;facets:unknown;summary:unknown};
    expect(combined.list).toEqual(list);
    expect(combined.facets).toEqual(await(await referenceFacets(request(`/catalog-facets?status=declared&${query}`),env.DB,NOW)).json());
    expect(combined.summary).toEqual(summary);
    console.log(JSON.stringify({ operation: "enriched-full-cold-comparison", count, query, before: metrics(log), after: metrics(currentLog),
      compactQueries: currentLog.map(row => ({ family: row.sql.includes("endpoint_flags") ? "public-facts" : row.sql.includes("scope_flags") ? "summary" : row.sql.includes("runtime_state") ? "coverage" : "page-enrichment", rowsRead: row.rowsRead, rowsWritten: row.rowsWritten, durationMs: row.durationMs })) }));
    comparisons.push({ query, before: metrics(log).rowsRead, after: metrics(currentLog).rowsRead });
    expect(metrics(log).rowsWritten).toBe(0);
    expect(metrics(currentLog).rowsWritten).toBe(0);
  }
  const detailLog: ReadRecord[] = [];
  const detail = await referenceDetail(request("/catalog-agent/100000"),metered(env.DB,detailLog),NOW);
  expect(detail.status).toBe(200);
  const newDetailLog: ReadRecord[] = [];
  expect(await (await catalogAgentResponse(request("/catalog-agent/100000"),metered(env.DB,newDetailLog),NOW)).json()).toEqual(await detail.json());
  expect(metrics(newDetailLog).rowsWritten).toBe(0);
  console.log(JSON.stringify({ operation: "enriched-aggregate-comparison", count, counts: summary.counts,
    before: { facets: metrics(facetLog), summary: metrics(summaryLog), detail: metrics(detailLog) },
    after: { facets: metrics(newFacetsLog), summary: metrics(newSummaryLog), detail: metrics(newDetailLog) } }));
  expect(metrics(newFacetsLog).rowsRead).toBeLessThanOrEqual(count === 2000 ? 44_737 : 218_208);
  if (count === 20_000) for (const comparison of comparisons) {
    expect(comparison.after,comparison.query).toBeLessThanOrEqual(Math.floor(comparison.before*0.1));
  }
}, 300_000);
