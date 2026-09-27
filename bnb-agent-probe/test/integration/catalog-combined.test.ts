import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { catalogCombinedResponse, catalogCurrentFacetsResponse, catalogCurrentSummaryResponse } from '../../src/routes/catalog-combined';
import { beginPublicCurrentBackfill, stepPublicCurrentBackfill } from '../../src/catalog/public-current-backfill';
import { catalogAgentsResponse as oldList, catalogFacetsResponse as oldFacets, catalogSummaryResponse as oldSummary } from '../fixtures/public-read-reference/catalog-agents';
import { seedPublicEnriched, completeProjectionFixture, NOW } from './public-enriched-fixture';
import { metered, type ReadRecord } from './d1-meter';

const req = (query: string) => new Request(`https://worker.test/catalog-combined?${query}`);
async function prepare() {
  await seedPublicEnriched(30);
  await completeProjectionFixture();
  await beginPublicCurrentBackfill(env.DB);
  for (let index = 0; index < 10; index++) {
    const result = await stepPublicCurrentBackfill(env.DB, 10_000_000);
    if (result === 'complete') return;
    expect(result).toBe('progress');
  }
  throw new Error('COMBINED_FIXTURE_NOT_READY');
}

it('preserves list, facets and summary contracts with no diagnostics or read writes', async () => {
  await prepare();
  const log: ReadRecord[] = [];
  for (const now of [NOW, NOW + 3_600_000]) for (const chain of [56,97]) for (const query of [
    'scope=hiring', 'scope=evaluation', 'status=completed_jobs', 'protocol=mcp&category=grid_trading',
    'quote=missing', 'commerce=candidate', 'latestFailure=true', 'q=%25', 'page=999',
  ]) {
    const params = `chain=${chain}&status=declared&${query}`;
    const response = await catalogCombinedResponse(req(`${params}&limit=3`), metered(env.DB,log),now,true);
    expect(response.status).toBe(200);
    const actual = await response.json();
    const facetParams = new URLSearchParams(params); facetParams.delete('page');
    expect(actual).toEqual({
      list: await (await oldList(req(`${params}&limit=3`),env.DB,now,2,true)).json(),
      facets: await (await oldFacets(req(facetParams.toString()),env.DB,now,true)).json(),
      summary: await (await oldSummary(req(`chain=${chain}`),env.DB,now,true)).json(),
    });
  }
  expect(log.reduce((sum,row)=>sum+row.rowsWritten,0)).toBe(0);
},120_000);

it('fails closed before coverage and rejects directory materialization', async () => {
  await prepare();
  await beginPublicCurrentBackfill(env.DB);
  const response = await catalogCombinedResponse(req('scope=hiring'),env.DB,NOW);
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const log: ReadRecord[]=[];
  expect((await catalogCombinedResponse(req('inventory=registry'),metered(env.DB,log),NOW)).status).toBe(400);
  expect(log).toHaveLength(0);
});

it('retries one counter resource without enriching cards', async () => {
  await prepare();
  for (const chain of [56,97]) {
    const log:ReadRecord[]=[];
    expect(await (await catalogCurrentFacetsResponse(req(`chain=${chain}&scope=evaluation`),metered(env.DB,log),NOW,true)).json())
      .toEqual(await (await oldFacets(req(`chain=${chain}&scope=evaluation`),env.DB,NOW,true)).json());
    expect(await (await catalogCurrentSummaryResponse(req(`chain=${chain}`),metered(env.DB,log),NOW,true)).json())
      .toEqual(await (await oldSummary(req(`chain=${chain}`),env.DB,NOW,true)).json());
    expect(log).toHaveLength(6);
    expect(log.every(row=>row.rowsWritten===0)).toBe(true);
    expect(log.some(row=>row.sql.includes('catalog_observations'))).toBe(false);
  }
});
