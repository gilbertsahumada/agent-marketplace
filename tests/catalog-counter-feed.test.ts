import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CATALOG_STATUSES } from "../src/business/entities/catalog-candidate";
import { MARKETPLACE_CATEGORIES } from "../src/business/entities/marketplace-agent";
import { getCatalogFacetCountsResult, getCatalogSummaryResult, invalidateCatalogCandidateCache } from "../src/data/observation/catalog-candidate-feed";

const env = { OBSERVATIONS_URL: "https://counter-worker.example/observations", BUYER_OBSERVATION_SECRET: "test-secret" };
const counts = { hiring: 2, evaluation: 8 };
const facets = { statuses: Object.fromEntries(CATALOG_STATUSES.map(key => [key, 0])), categories: Object.fromEntries(MARKETPLACE_CATEGORIES.map(key => [key, 0])), protocols: { a2a: 0, mcp: 0, erc8183_http: 0 }, reachability: { live: 0, historical: 0, never: 0, browser_observed: 0 } };
const body = (chainId: 56 | 97 = 56) => ({ schemaVersion: 2, apiVersion: "2.0", chainId, generatedAt: 1_788_000_000_000, counts, facets });
beforeEach(invalidateCatalogCandidateCache);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("fetches only network totals and shares the 30-second process cache", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(body()));
  vi.stubGlobal("fetch", fetcher);
  expect(await getCatalogSummaryResult({ chainId: 56, env })).toEqual({ ok: true, data: counts });
  expect(await getCatalogSummaryResult({ chainId: 56, env })).toEqual({ ok: true, data: counts });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const url = new URL(String(fetcher.mock.calls[0]?.[0]));
  expect(url.pathname).toBe("/catalog-summary");
  expect([...url.searchParams]).toEqual([["chain", "56"]]);
});

it("uses a facets-only URL with all selected filters and no pagination", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(body(97)));
  vi.stubGlobal("fetch", fetcher);
  expect(await getCatalogFacetCountsResult({ chainId: 97, statuses: ["requestable"], categories: ["grid_trading"], protocols: ["mcp"], reachability: ["live"], scope: "evaluation", q: "seller", env })).toEqual({ ok: true, data: facets });
  const url = new URL(String(fetcher.mock.calls[0]?.[0]));
  expect(url.pathname).toBe("/catalog-facets");
  expect(Object.fromEntries(url.searchParams)).toEqual({ chain: "97", status: "requestable", category: "grid_trading", protocol: "mcp", reachability: "live", scope: "evaluation", q: "seller" });
});

it("keeps authenticated refreshes and network keys independent", async () => {
  const fetcher = vi.fn<typeof fetch>(async url => Response.json(body(new URL(String(url)).searchParams.get("chain") === "97" ? 97 : 56)));
  vi.stubGlobal("fetch", fetcher);
  await getCatalogSummaryResult({ chainId: 56, env });
  await getCatalogSummaryResult({ chainId: 97, env });
  await getCatalogSummaryResult({ chainId: 56, fresh: true, env });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ cache: "no-store", headers: { authorization: "Bearer test-secret", "x-marketplace-refresh": "1" } });
});

it.each([{ ...body(), chainId: 97 }, { ...body(), counts: { hiring: 1 } }, { ...body(), counts: { hiring: -1, evaluation: 0 } }, { ...body(), schemaVersion: 1 }])("rejects malformed or cross-network summaries without inventing zeroes", async invalid => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(invalid)));
  expect(await getCatalogSummaryResult({ chainId: 56, env })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});

it("classifies optional failures without fallback catalogue scans or automatic retries", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await getCatalogFacetCountsResult({ statuses: [], env })).toEqual({ ok: false, error: { kind: "upstream", status: 503 } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
