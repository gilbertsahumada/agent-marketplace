import { env } from 'cloudflare:workers';
import { expect, it, vi } from 'vitest';
import { createWorker } from '../../src/index';
import { clearCatalogFixtures } from './catalog-fixtures';

it.each(['/catalog-summary', '/catalog-facets'])('caches %s with zero D1 work on a hit and supports authenticated refresh', async path => {
  await clearCatalogFixtures();
  const logger = { info: vi.fn(), error: vi.fn() };
  const worker = createWorker({ logger, now: () => 1_800_000_000_000 });
  const bindings = { ...env, CATALOG_RESPONSE_CACHE_SECONDS: '300', BUYER_OBSERVATION_SECRET: 'private-test-secret',
    CF_VERSION_METADATA: { id: 'fixture-version' } };
  const url = `https://counter-route.test${path}?chain=56`;
  expect((await worker.fetch(new Request(url), bindings)).status).toBe(200);
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({ cache: 'miss', version: 'fixture-version', complete: true });
  expect((await worker.fetch(new Request(url), bindings)).status).toBe(200);
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({ cache: 'hit', queries: 0, rowsRead: 0, rowsWritten: 0 });
  await worker.fetch(new Request(url, { headers: { 'x-marketplace-refresh': '1', authorization: 'Bearer wrong' } }), bindings);
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({ cache: 'hit', queries: 0 });
  const fresh = await worker.fetch(new Request(url, { headers: {
    'x-marketplace-refresh': '1', authorization: 'Bearer private-test-secret',
  } }), bindings);
  expect(fresh.headers.get('cache-control')).toBe('no-store');
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({ cache: 'bypass', rowsWritten: 0, queries: 1 });
  expect(JSON.stringify(logger.info.mock.calls)).not.toContain('private-test-secret');
});

it('logs neither user search text nor raw paths when a public request fails validation', async () => {
  const logger = { info: vi.fn(), error: vi.fn() };
  const response = await createWorker({ logger }).fetch(new Request('https://counter-route.test/catalog-summary?chain=wrong&q=private-wallet'), env);
  expect(response.status).toBe(400);
  expect(logger.info.mock.calls.at(-1)?.[1]).toMatchObject({ operation: 'catalog.summary', chainId: null, result: 'rejected' });
  expect(JSON.stringify(logger.info.mock.calls)).not.toContain('private-wallet');
});
