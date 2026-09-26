import { env } from 'cloudflare:workers';
import { expect, it, vi } from 'vitest';
import { createWorker } from '../../src/index';
import { beginPublicCurrentBackfill, stepPublicCurrentBackfill } from '../../src/catalog/public-current-backfill';
import { clearCatalogFixtures } from './catalog-fixtures';

it('serves combined cache hits with zero D1 and preserves authenticated refresh', async () => {
  await clearCatalogFixtures();
  await beginPublicCurrentBackfill(env.DB);
  expect(await stepPublicCurrentBackfill(env.DB,10_000_000)).toBe('progress');
  expect(await stepPublicCurrentBackfill(env.DB,10_000_000)).toBe('complete');
  const logger={info:vi.fn(),error:vi.fn()};
  const worker=createWorker({logger,now:()=>1_800_000_000_000});
  const bindings={...env,CATALOG_RESPONSE_CACHE_SECONDS:'300',BUYER_OBSERVATION_SECRET:'local-only-secret',CF_VERSION_METADATA:{id:'combined-fixture'}};
  const url='https://combined-cache.test/catalog-combined?chain=97';
  expect((await worker.fetch(new Request(url),bindings)).status).toBe(200);
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({operation:'catalog.combined',chainId:97,cache:'miss',rowsWritten:0});
  expect((await worker.fetch(new Request(url),bindings)).status).toBe(200);
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({cache:'hit',queries:0,rowsRead:0,rowsWritten:0});
  await worker.fetch(new Request(url,{headers:{'x-marketplace-refresh':'1',authorization:'Bearer wrong'}}),bindings);
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({cache:'hit',queries:0});
  const fresh=await worker.fetch(new Request(url,{headers:{'x-marketplace-refresh':'1',authorization:'Bearer local-only-secret'}}),bindings);
  expect(fresh.status).toBe(200);
  expect(fresh.headers.get('cache-control')).toBe('no-store');
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({cache:'bypass',rowsWritten:0});
  expect(JSON.stringify(logger.info.mock.calls)).not.toContain('local-only-secret');
});

it('retains a warm response for its cache lifetime while a building checkpoint rejects cold and refreshed reads', async () => {
  await clearCatalogFixtures();
  await beginPublicCurrentBackfill(env.DB);
  expect(await stepPublicCurrentBackfill(env.DB,10_000_000)).toBe('progress');
  expect(await stepPublicCurrentBackfill(env.DB,10_000_000)).toBe('complete');
  const logger={info:vi.fn(),error:vi.fn()};
  const worker=createWorker({logger,now:()=>1_800_000_000_000});
  const bindings={...env,CATALOG_RESPONSE_CACHE_SECONDS:'300',BUYER_OBSERVATION_SECRET:'local-only-secret',CF_VERSION_METADATA:{id:'combined-checkpoint-fixture'}};
  const url='https://combined-checkpoint-cache.test/catalog-combined?chain=97';
  const cache=(caches as unknown as {default:Cache}).default;
  const warm=await worker.fetch(new Request(url),bindings);
  expect(warm.status).toBe(200);
  expect(warm.headers.get('cache-control')).toBe('public, max-age=300, stale-while-revalidate=300');
  const expectedBody=await warm.json();

  await beginPublicCurrentBackfill(env.DB);
  // Coverage invalidation is not cache invalidation. Until expiry or an explicit
  // purge, a hit must stay zero-D1 rather than checking the checkpoint each time.
  const hit=await worker.fetch(new Request(url),bindings);
  expect(hit.status).toBe(200);
  expect(await hit.json()).toEqual(expectedBody);
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({cache:'hit',queries:0,rowsRead:0,rowsWritten:0});

  const cold=await worker.fetch(new Request('https://combined-checkpoint-cache.test/catalog-combined?chain=56'),bindings);
  expect(cold.status).toBe(503);
  expect(cold.headers.get('cache-control')).toBe('no-store');
  expect(await cold.json()).toEqual({error:'catalog_projection_unavailable'});
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({cache:'miss',rowsWritten:0});

  const fresh=await worker.fetch(new Request(url,{headers:{'x-marketplace-refresh':'1',authorization:'Bearer local-only-secret'}}),bindings);
  expect(fresh.status).toBe(503);
  expect(fresh.headers.get('cache-control')).toBe('no-store');
  expect(await fresh.json()).toEqual({error:'catalog_projection_unavailable'});
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({cache:'bypass',rowsWritten:0});
  expect((await worker.fetch(new Request(url),bindings)).status).toBe(200);
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({cache:'hit',queries:0,rowsRead:0,rowsWritten:0});

  // Explicit purge models removal, not passage of Cache API wall time. The
  // injected Worker clock does not control platform cache expiry; the TTL above
  // is asserted without falsely claiming this test waits out its 300 seconds.
  expect(await cache.delete(new Request(url))).toBe(true);
  const purged=await worker.fetch(new Request(url),bindings);
  expect(purged.status).toBe(503);
  expect(purged.headers.get('cache-control')).toBe('no-store');
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({cache:'miss',rowsWritten:0});
});
