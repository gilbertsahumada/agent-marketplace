import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { measureD1Invocation } from '../../src/db/invocation-metrics';
import { readPublicCatalogAgentEvidence } from '../../src/db/orm';
import { catalogAgentsResponse, catalogFacetsResponse, catalogSummaryResponse } from '../../src/routes/catalog-agents';
import { catalogCombinedResponse } from '../../src/routes/catalog-combined';
import { NOW, seedPublicEnriched, completeProjectionFixture } from './public-enriched-fixture';
import { beginPublicCurrentBackfill, stepPublicCurrentBackfill } from '../../src/catalog/public-current-backfill';
import { commerceJobsListResponse, commerceJobResponse, commerceSummaryResponse, commerceActivityResponse } from '../../src/routes/commerce-jobs';
import { hireEventsListResponse } from '../../src/routes/hire-events';

it('measures every public detail query, including empty ORM selections', async () => {
  const reference = await readPublicCatalogAgentEvidence(env.DB, '99999999');
  const meter = measureD1Invocation(env.DB);
  expect(await readPublicCatalogAgentEvidence(meter.db, '99999999')).toEqual(reference);
  expect(meter.snapshot()).toMatchObject({ queries: 8, complete: true, unmeasuredQueries: 0, rowsWritten: 0 });
});

it('fully measures populated cards, facets, summary and details without replaying queries', async () => {
  await seedPublicEnriched(30);
  await completeProjectionFixture();
  await beginPublicCurrentBackfill(env.DB);
  for (let i=0;i<100;i++) {
    const state=await stepPublicCurrentBackfill(env.DB,100_000_000);
    if (state==='complete') break;
    expect(state).toBe('progress');
  }
  for (const [path, read] of [
    ['/catalog-agents?limit=3', catalogAgentsResponse],
    ['/catalog-combined?limit=3', catalogCombinedResponse],
    ['/catalog-facets', catalogFacetsResponse],
    ['/catalog-summary', catalogSummaryResponse],
  ] as const) {
    const meter = measureD1Invocation(env.DB);
    const request = new Request(`https://worker.test${path}`);
    const reference = await read(request, env.DB, NOW);
    const result = await read(request, meter.db, NOW);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(await reference.json());
    expect(meter.snapshot(), path).toMatchObject({ complete: true, unmeasuredQueries: 0, rowsWritten: 0 });
    console.log(JSON.stringify({ operation:path, ...meter.snapshot() }));
  }
  for (const chain of [56,97] as const) {
    const meter = measureD1Invocation(env.DB);
    expect(await readPublicCatalogAgentEvidence(meter.db,'100000',50,chain))
      .toEqual(await readPublicCatalogAgentEvidence(env.DB,'100000',50,chain));
    expect(meter.snapshot()).toMatchObject({ complete: true, unmeasuredQueries: 0, rowsWritten: 0 });
  }
  for (const [path,read] of [
    ['/commerce-jobs?chainId=56',commerceJobsListResponse],
    ['/commerce-jobs?chainId=56&agentId=100000',commerceJobsListResponse],
    ['/commerce-jobs/56/100000',commerceJobResponse],
    ['/commerce-summary?chainId=56',commerceSummaryResponse],
    ['/commerce-activity?chainId=56&days=7',commerceActivityResponse],
    ['/hire-events?chainId=56&agentId=100000',hireEventsListResponse],
  ] as const) {
    const meter=measureD1Invocation(env.DB);
    const request=new Request(`https://worker.test${path}`);
    const result=await read(request,meter.db,NOW);
    expect(result.status,path).toBe(200);
    expect(await result.json()).toEqual(await (await read(request,env.DB,NOW)).json());
    expect(meter.snapshot(),path).toMatchObject({complete:true,unmeasuredQueries:0,rowsWritten:0});
  }
}, 30_000);
