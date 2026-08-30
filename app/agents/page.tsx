import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { CatalogPage } from "@/components/marketplace/catalog-page";
import { getMainnetJobProof, getWorkerObservations, listMarketplaceAgents } from "@/src/business/composition";
import { MARKETPLACE_CATEGORIES, type MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import { MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";
import {
  DEFAULT_REGISTERED_AGENT_SORT,
  MARKETPLACE_DATA_SORTS,
  type MarketplaceSort,
} from "@/src/business/use-cases/list-marketplace-agents";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "BSC agents" };
const SUPPORTED_SORTS = new Set<MarketplaceSort>(MARKETPLACE_DATA_SORTS);

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const view = params.view === "all" ? "all" : "marketplace";
  // Categories only exist for curated marketplace candidates; in the registered
  // view the parameter is dropped so URLs never claim a filter that is not applied.
  const rawCategory = view === "marketplace" && typeof params.category === "string" ? params.category : undefined;
  const category = rawCategory && MARKETPLACE_CATEGORIES.includes(rawCategory as MarketplaceCategory)
    ? rawCategory as MarketplaceCategory
    : undefined;
  if (rawCategory && !category && rawCategory !== "all") notFound();
  const q = typeof params.q === "string" ? params.q : undefined;
  const sort = typeof params.sort === "string" && SUPPORTED_SORTS.has(params.sort as MarketplaceSort)
    ? params.sort as MarketplaceSort
    : view === "all" ? DEFAULT_REGISTERED_AGENT_SORT : undefined;
  const page = typeof params.page === "string" && /^\d+$/.test(params.page) ? Number(params.page) : 1;
  const optional = { ...(q ? { q } : {}), ...(sort ? { sort } : {}) };
  const retryParams = new URLSearchParams({ view, page: String(page) });
  if (q) retryParams.set("q", q);
  if (sort) retryParams.set("sort", sort);
  if (category) retryParams.set("category", category);
  let data;
  try {
    data = view === "all"
      ? await listMarketplaceAgents.execute({ view, page, limit: 24, ...optional })
      : await listMarketplaceAgents.execute({ view, page, limit: 12, ...optional, ...(category ? { category } : {}) });
  } catch (error) {
    if (!(error instanceof MarketplaceDataUnavailableError)) throw error;
    return <CatalogUnavailable retryHref={`/agents?${retryParams.toString()}`} />;
  }
  const mainnetProof = getMainnetJobProof.execute();
  const observations = view === "marketplace"
    ? await getWorkerObservations()
    : { status: "unavailable" as const, feed: null };
  return <CatalogPage data={data} observations={observations} query={{ view, ...optional, ...(category ? { category } : {}) }} {...(mainnetProof ? { provenAgentId: mainnetProof.agentId } : {})} />;
}
