import Link from "next/link";
import { Database, ListFilter, RadioTower, UsersRound } from "lucide-react";
import type { MarketplaceAgentPage, MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import type { CatalogCandidatePage, CatalogFacetCounts, CatalogStatus } from "@/src/business/entities/catalog-candidate";
import {
  DEFAULT_REGISTERED_AGENT_SORT,
  type MarketplaceReachability,
  type MarketplaceSort,
} from "@/src/business/use-cases/list-marketplace-agents";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { CatalogFilters } from "./catalog-filters";
import { CatalogResults } from "./catalog-results";
import { PaginationLinks } from "./page-primitives";
import { agentCardWithObservations } from "./view-models";
import { observationTargetsByAgentId, type ObservationFeedResult } from "@/src/business/entities/worker-observations";
import { catalogCandidateCard } from "./catalog-candidate-view-model";
import { CatalogNavigationProvider } from "./catalog-navigation";
import { CatalogQuickFilters } from "./catalog-quick-filters";
import { CatalogSearch } from "./catalog-search";
import { CatalogReturnRefresh } from "./catalog-return-refresh";

function CatalogMetric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="min-w-32">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="font-stat mt-1 text-xl font-medium tracking-tight text-white">
        {typeof value === "number" ? value.toLocaleString("en-US") : "—"}
      </p>
    </div>
  );
}

function dataCapturedAt(data: MarketplaceAgentPage | undefined, catalog: CatalogCandidatePage | undefined) {
  const value = catalog ? new Date(catalog.generatedAt) : data?.fetchedAt ? new Date(data.fetchedAt) : null;
  if (!value || Number.isNaN(value.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(value).replace(",", "") + " UTC";
}

export function CatalogPage({
  data,
  catalog,
  observations = { status: "unavailable", feed: null },
  query,
  provenAgentId,
  registryTotal: providedRegistryTotal,
  operationalTotal: providedOperationalTotal,
  filterCounts,
}: {
  data?: MarketplaceAgentPage;
  catalog?: CatalogCandidatePage;
  observations?: ObservationFeedResult;
  query: {
    view: "all" | "marketplace";
    status?: CatalogStatus;
    category?: MarketplaceCategory;
    statuses?: CatalogStatus[];
    categories?: MarketplaceCategory[];
    reachability?: MarketplaceReachability[];
    q?: string;
    sort?: MarketplaceSort;
  };
  provenAgentId?: string;
  registryTotal?: number;
  operationalTotal?: number;
  filterCounts?: CatalogFacetCounts;
}) {
  if (!data && !catalog) throw new Error("CATALOG_PAGE_DATA_REQUIRED");
  const allView = query.view === "all";
  const selectedStatuses = query.statuses ?? (query.status ? [query.status] : []);
  const selectedCategories = query.categories ?? (query.category ? [query.category] : []);
  const selectedReachability = query.reachability ?? [];
  const targets = observationTargetsByAgentId(observations.feed);
  const now = Date.now();
  const cards = catalog
    ? catalog.items.map((candidate) => catalogCandidateCard(candidate, now))
    : data!.items.map((agent) => agentCardWithObservations(
      agent,
      targets.get(agent.agentId) ?? [],
      observations.status === "available",
      now,
      provenAgentId,
      query.category,
    ));
  const total = catalog?.total ?? data!.pagination.total;
  const registryTotal = providedRegistryTotal ?? (allView ? total : undefined);
  const operationalTotal = providedOperationalTotal
    ?? (!allView
      && (selectedStatuses.length === 0 || (selectedStatuses.length === 1 && selectedStatuses[0] === "declared"))
      && selectedCategories.length === 0 && !query.q ? total : undefined);
  const currentPage = catalog?.page ?? data!.pagination.page;
  const totalPages = total === 0 ? 0 : Math.ceil(total / (catalog?.limit ?? data!.pagination.pageSize));
  const hrefForPage = (page: number) => {
    const params = new URLSearchParams({ view: query.view, page: String(page), limit: "24" });
    if (!allView) for (const status of selectedStatuses) params.append("status", status);
    for (const category of selectedCategories) params.append("category", category);
    if (!allView) for (const value of selectedReachability) params.append("reachability", value);
    if (query.q) params.set("q", query.q);
    if (query.sort) params.set("sort", query.sort);
    return `/agents?${params}`;
  };
  const searchForm = (
    <form action="/agents" className={allView ? "grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" : "relative grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 lg:block"} key="catalog-search">
      <input name="view" type="hidden" value={query.view} />
      {!allView && selectedStatuses.map((status) => <input key={status} name="status" type="hidden" value={status} />)}
      {selectedCategories.map((category) => <input key={category} name="category" type="hidden" value={category} />)}
      {!allView && selectedReachability.map((value) => <input key={value} name="reachability" type="hidden" value={value} />)}
      {!allView && (
        <details className="lg:hidden">
          <summary
            aria-label="Filters"
            className={buttonVariants({ variant: "outline", size: "icon-lg", className: "list-none [&::-webkit-details-marker]:hidden" })}
            role="button"
          >
            <ListFilter aria-hidden="true" data-icon="inline-start" />
            <span className="sr-only">Filters</span>
          </summary>
          <div className="absolute inset-x-0 top-12 z-20 max-h-[min(70vh,32rem)] overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-xl">
            <CatalogFilters
              idPrefix="catalog-mobile"
              categories={selectedCategories}
              reachability={selectedReachability}
              {...(filterCounts ? { counts: filterCounts } : {})}
              statuses={selectedStatuses}
              {...(query.q ? { q: query.q } : {})}
            />
          </div>
        </details>
      )}
      <CatalogSearch
        categories={selectedCategories}
        reachability={selectedReachability}
        statuses={selectedStatuses}
        {...(query.q ? { q: query.q } : {})}
        {...(query.sort ? { sort: query.sort } : {})}
        view={query.view}
      />
      {allView && (
        <label>
          <span className="sr-only">Sort agents</span>
          <select
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
            defaultValue={query.sort ?? DEFAULT_REGISTERED_AGENT_SORT}
            name="sort"
          >
            <option value="newest">Newest</option>
            <option value="trust_score">Trust score</option>
            <option value="reputation">Reputation</option>
            <option value="agent_id">Agent ID</option>
          </select>
        </label>
      )}
    </form>
  );

  const emptyContent = selectedCategories.length === 1 && selectedCategories[0] === "grid_trading" ? (
    <Alert className="border-zinc-800 bg-zinc-950">
      <AlertTitle>No verified Grid Trading agent yet</AlertTitle>
      <AlertDescription>
        <span>We have not found a seller with sufficient operational evidence.</span>{" "}
        <Link href="/jobs/testnet/551">Inspect the verified ERC-8183 demonstration</Link>{" "}
        without treating it as a Grid seller.
      </AlertDescription>
    </Alert>
  ) : (
    <Alert className="border-zinc-800 bg-zinc-950">
      <AlertTitle>No agents found</AlertTitle>
      <AlertDescription>Try a different search or clear the outcome filter.</AlertDescription>
    </Alert>
  );

  return (
    <main id="main-content" className="mx-auto w-full max-w-[96rem] flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="sr-only">Agents</h1>
      <CatalogReturnRefresh />
      <CatalogNavigationProvider navigationKey={JSON.stringify(query)}>
        <div className={allView ? "" : "grid gap-6 lg:h-[calc(100dvh-7rem)] lg:min-h-[30rem] lg:grid-cols-[17rem_minmax(0,1fr)]"}>
          {!allView && (
            <aside aria-label="Catalog filters" className="marketplace-surface hidden rounded-xl lg:sticky lg:top-0 lg:block lg:max-h-full lg:self-start lg:overflow-y-auto">
              <CatalogFilters idPrefix="catalog-desktop" categories={selectedCategories} reachability={selectedReachability} {...(filterCounts ? { counts: filterCounts } : {})} statuses={selectedStatuses} {...(query.q ? { q: query.q } : {})} />
              <div className="m-4 rounded-lg border border-white/8 bg-black/20 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-white"><Database aria-hidden="true" className="size-4 text-primary" />Catalog data</div>
                <p className="mt-3 text-xs leading-5 text-zinc-400">trust8004 catalog + marketplace observation Worker</p>
                <p className="mt-2 font-stat text-[10px] text-zinc-600">Captured {dataCapturedAt(data, catalog)}</p>
              </div>
            </aside>
          )}

          <section aria-label="Agent results" className="min-w-0 space-y-4 lg:h-full lg:overflow-y-auto lg:pr-2">
            <div className="marketplace-surface grid items-center gap-4 rounded-xl p-3 xl:grid-cols-[auto_minmax(0,1fr)]" data-testid="catalog-summary">
              <div aria-label="Catalog totals" className="flex items-center gap-5 px-1 sm:gap-7">
                <div className="flex items-center gap-2.5"><UsersRound aria-hidden="true" className="size-4 text-zinc-600" /><CatalogMetric label="ERC-8004 registered" value={registryTotal} /></div>
                <div aria-hidden="true" className="h-10 w-px bg-white/10" />
                <div className="flex items-center gap-2.5"><RadioTower aria-hidden="true" className="size-4 text-primary" /><CatalogMetric label="Operational candidates" value={operationalTotal} /></div>
              </div>
            </div>
            <CatalogResults
              agents={cards}
              emptyContent={emptyContent}
              filters={!allView ? (
                <CatalogQuickFilters key="catalog-quick-filters" categories={selectedCategories} {...(filterCounts ? { counts: filterCounts } : {})} {...(query.q ? { q: query.q } : {})} reachability={selectedReachability} statuses={selectedStatuses} />
              ) : undefined}
              registry={allView}
              toolbar={searchForm}
            />
            <PaginationLinks hrefFor={hrefForPage} page={currentPage} totalPages={totalPages} />
          </section>
        </div>
      </CatalogNavigationProvider>
    </main>
  );
}
