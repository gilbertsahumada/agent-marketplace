import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { CatalogPage } from "@/components/marketplace/catalog-page";
import { getCatalogCandidatePage, getMainnetJobProof, getWorkerObservations, listMarketplaceAgents } from "@/src/business/composition";
import { MARKETPLACE_CATEGORIES, type MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import { MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";
import {
  DEFAULT_REGISTERED_AGENT_SORT,
  MARKETPLACE_DATA_SORTS,
  type MarketplaceSort,
} from "@/src/business/use-cases/list-marketplace-agents";
import { CATALOG_STATUSES, type CatalogStatus } from "@/src/business/entities/catalog-candidate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "BSC agents" };
const SUPPORTED_SORTS = new Set<MarketplaceSort>(MARKETPLACE_DATA_SORTS);

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const view = params.view === "all" ? "all" : "marketplace";
  // Categories only exist for curated marketplace candidates; in the registered
  // view the parameter is dropped so URLs never claim a filter that is not applied.
  const rawCategories = view === "marketplace"
    ? Array.isArray(params.category) ? params.category : typeof params.category === "string" ? [params.category] : []
    : [];
  const categories = [...new Set(rawCategories.filter((category): category is MarketplaceCategory => MARKETPLACE_CATEGORIES.includes(category as MarketplaceCategory)))];
  if (categories.length !== rawCategories.length) notFound();
  const q = typeof params.q === "string" ? params.q : undefined;
  const rawStatuses = Array.isArray(params.status) ? params.status : typeof params.status === "string" ? [params.status] : [];
  const validStatuses = rawStatuses.filter((status): status is CatalogStatus => CATALOG_STATUSES.includes(status as CatalogStatus));
  if (validStatuses.length !== rawStatuses.length) notFound();
  const statuses: CatalogStatus[] = rawStatuses.length === 0 ? ["declared"] : [...new Set(validStatuses)];
  const sort = typeof params.sort === "string" && SUPPORTED_SORTS.has(params.sort as MarketplaceSort)
    ? params.sort as MarketplaceSort
    : view === "all" ? DEFAULT_REGISTERED_AGENT_SORT : undefined;
  const page = typeof params.page === "string" && /^\d+$/.test(params.page) ? Number(params.page) : 1;
  const optional = { ...(q ? { q } : {}), ...(sort ? { sort } : {}) };
  const retryParams = new URLSearchParams({ view, page: String(page) });
  if (q) retryParams.set("q", q);
  if (sort) retryParams.set("sort", sort);
  for (const category of categories) retryParams.append("category", category);
  for (const status of statuses) retryParams.append("status", status);
  const metricsPromise = Promise.all([
    listMarketplaceAgents.execute({
      view: "all",
      page: 1,
      limit: 1,
      sort: DEFAULT_REGISTERED_AGENT_SORT,
    }).catch(() => null),
    getCatalogCandidatePage({ status: "declared", page: 1, limit: 1 }).catch(() => null),
  ]);
  const catalog = view === "marketplace" ? await getCatalogCandidatePage({
    statuses, categories, page, limit: 24, ...optional,
  }) : null;
  let data;
  if (!catalog) {
    if (view === "marketplace" && (statuses.length !== 1 || statuses[0] !== "declared" || categories.length > 1)) {
      return <CatalogUnavailable retryHref={`/agents?${retryParams.toString()}`} />;
    }
    try {
      data = view === "all"
        ? await listMarketplaceAgents.execute({ view, page, limit: 24, ...optional })
        : await listMarketplaceAgents.execute({ view, page, limit: 12, ...optional, ...(categories[0] ? { category: categories[0] } : {}) });
    } catch (error) {
      if (!(error instanceof MarketplaceDataUnavailableError)) throw error;
      return <CatalogUnavailable retryHref={`/agents?${retryParams.toString()}`} />;
    }
  }
  const mainnetProof = getMainnetJobProof.execute();
  const observations = view === "marketplace"
    ? await getWorkerObservations()
    : { status: "unavailable" as const, feed: null };
  const [registryMetric, operationalMetric] = await metricsPromise;
  const registryTotal = registryMetric?.pagination.total
    ?? (view === "all" && !q ? data?.pagination.total : undefined);
  const operationalTotal = operationalMetric?.total
    ?? (statuses.length === 1 && statuses[0] === "declared" && !q && categories.length === 0 ? catalog?.total : undefined);
  return <CatalogPage
    {...(data ? { data } : {})}
    {...(catalog ? { catalog } : {})}
    observations={observations}
    query={{ view, statuses, categories, ...optional }}
    {...(mainnetProof ? { provenAgentId: mainnetProof.agentId } : {})}
    {...(typeof registryTotal === "number" ? { registryTotal } : {})}
    {...(typeof operationalTotal === "number" ? { operationalTotal } : {})}
  />;
}
