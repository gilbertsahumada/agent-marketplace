import "server-only";
import { getCatalogCandidatePageResult, getCatalogFacetCountsResult, getCatalogSummaryResult, getCatalogCombinedResult, type CatalogCombinedData } from "../data/observation/catalog-candidate-feed";
import { listMarketplaceAgents, getMainnetJobProof } from "../business/composition";
import type { CatalogReadResult, CatalogResourceMap, CatalogResourceName, CatalogResources } from "../business/entities/catalog-resource";
import type { CatalogQuery } from "./catalog-query";

type Readers = { read: typeof getCatalogCandidatePageResult; facets: typeof getCatalogFacetCountsResult; summary: typeof getCatalogSummaryResult; combined?: typeof getCatalogCombinedResult; directory: typeof listMarketplaceAgents.execute };
const defaults: Readers = { read: getCatalogCandidatePageResult, facets: getCatalogFacetCountsResult, summary: getCatalogSummaryResult, combined: getCatalogCombinedResult, directory: input => listMarketplaceAgents.execute(input) };

function catalogInput(query: CatalogQuery, fresh: boolean) {
  return { chainId: (query.network === "testnet" ? 97 : 56) as 56 | 97, statuses: query.statuses, categories: query.categories, protocols: query.protocols, reachability: query.reachability, ...(query.q ? { q: query.q } : {}), ...(query.sort ? { sort: query.sort } : {}), ...(query.view === "all" ? { inventory: "registry" as const } : query.scope === "all" ? {} : { scope: query.scope }), fresh };
}

export async function readCatalogResource<K extends CatalogResourceName>(resource: K, query: CatalogQuery, fresh: boolean, readers: Readers = defaults): Promise<CatalogReadResult<CatalogResourceMap[K]>> {
  const started = Date.now();
  const chainId = query.network === "testnet" ? 97 : 56;
  const base = catalogInput(query, fresh);
  let result: CatalogReadResult<unknown>;
  try {
    if (resource === "results") {
      if (query.view === "all" && chainId === 56) {
        const data = await readers.directory({ view: "all", page: query.page, limit: 24, ...(query.q ? { q: query.q } : {}), ...(query.sort ? { sort: query.sort } : {}) });
        const proof = getMainnetJobProof.execute();
        result = { ok: true, data: { data, ...(proof ? { provenAgentId: proof.agentId } : {}) } };
      } else {
        const read = await readers.read({ ...base, page: query.page, limit: 24 });
        result = read.ok ? { ok: true, data: { catalog: read.data } } : read;
      }
    } else if (query.view === "all") result = { ok: false, error: { kind: "unavailable" } };
    else if (resource === "facets") {
      result = await readers.facets(base);
    } else {
      result = await readers.summary({ chainId, fresh });
    }
  } catch { result = { ok: false, error: { kind: "unavailable" } }; }
  console.info("catalog_read", { resource, chainId, durationMs: Date.now() - started, kind: result.ok ? "success" : result.error.kind, ...(!result.ok && result.error.status ? { status: result.error.status } : {}) });
  return result as CatalogReadResult<CatalogResourceMap[K]>;
}
export function createCatalogResources(query: CatalogQuery, fresh: boolean, readers: Readers = defaults): CatalogResources {
  if (query.view !== "all") {
    const input = { ...catalogInput(query, fresh), page: query.page, limit: 24 };
    const started = Date.now();
    const combined: Promise<CatalogReadResult<CatalogCombinedData>> = (async () => {
      let result: CatalogReadResult<CatalogCombinedData>;
      try { result = await (readers.combined ?? getCatalogCombinedResult)(input); }
      catch { result = { ok: false, error: { kind: "unavailable" } }; }
      console.info("catalog_read", { resource: "combined", chainId: input.chainId, durationMs: Date.now() - started, kind: result.ok ? "success" : result.error.kind, ...(!result.ok && result.error.status ? { status: result.error.status } : {}) });
      return result;
    })();
    return {
      results: combined.then(result => result.ok ? { ok: true, data: { catalog: result.data.list } } : result),
      facets: combined.then(result => result.ok ? { ok: true, data: result.data.facets } : result),
      scopes: combined.then(result => result.ok ? { ok: true, data: result.data.summary } : result),
    };
  }
  const results = readCatalogResource("results", query, fresh, readers);
  return { results, facets: results.then(() => readCatalogResource("facets", query, fresh, readers)), scopes: results.then(() => readCatalogResource("scopes", query, fresh, readers)) };
}
