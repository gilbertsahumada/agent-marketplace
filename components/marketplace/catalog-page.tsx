import Link from "next/link";
import { ListFilter } from "lucide-react";
import type { MarketplaceAgentPage, MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import type { CatalogCandidatePage, CatalogFacetCounts, CatalogStatus } from "@/src/business/entities/catalog-candidate";
import {
  DEFAULT_REGISTERED_AGENT_SORT,
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
import { CatalogSearch } from "./catalog-search";

function CatalogMetric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="min-w-40">
      <p className="font-eyebrow text-zinc-500">{label}</p>
      <p className="font-stat mt-2 text-3xl font-light tracking-tight text-white">
        {typeof value === "number" ? value.toLocaleString("en-US") : "—"}
      </p>
    </div>
  );
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
    if (query.q) params.set("q", query.q);
    if (query.sort) params.set("sort", query.sort);
    return `/agents?${params}`;
  };

  const searchForm = (
    <form action="/agents" className={allView ? "grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" : "relative grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 lg:block"} key="catalog-search">
      <input name="view" type="hidden" value={query.view} />
      {!allView && selectedStatuses.map((status) => <input key={status} name="status" type="hidden" value={status} />)}
      {selectedCategories.map((category) => <input key={category} name="category" type="hidden" value={category} />)}
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
              {...(filterCounts ? { counts: filterCounts } : {})}
              statuses={selectedStatuses}
              {...(query.q ? { q: query.q } : {})}
            />
          </div>
        </details>
      )}
      <CatalogSearch
        categories={selectedCategories}
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
    <main id="main-content" className="mx-auto w-full max-w-[96rem] flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-7 border-b border-white/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
        <h1 className="text-3xl font-light tracking-tight text-white sm:text-4xl">Hire an agent</h1>
        <div aria-label="Catalog totals" className="flex flex-wrap items-end gap-8 sm:gap-10">
          <CatalogMetric label="ERC-8004 registered" value={registryTotal} />
          <div aria-hidden="true" className="hidden h-14 w-px bg-white/15 sm:block" />
          <CatalogMetric label="Operational candidates" value={operationalTotal} />
        </div>
      </header>

      <CatalogNavigationProvider navigationKey={JSON.stringify(query)}>
        <div className={allView ? "mt-7" : "mt-7 grid gap-6 lg:h-[calc(100dvh-15rem)] lg:min-h-[28rem] lg:grid-cols-[15rem_minmax(0,1fr)]"}>
          {!allView && (
            <aside aria-label="Catalog filters" className="hidden border-r border-white/10 pr-6 lg:sticky lg:top-0 lg:block lg:max-h-full lg:self-start lg:overflow-y-auto">
              <CatalogFilters
                idPrefix="catalog-desktop"
                categories={selectedCategories}
                {...(filterCounts ? { counts: filterCounts } : {})}
                statuses={selectedStatuses}
                {...(query.q ? { q: query.q } : {})}
              />
            </aside>
          )}

          <section aria-label="Agent results" className="min-w-0 lg:h-full lg:overflow-y-auto lg:pr-2">
            <CatalogResults agents={cards} emptyContent={emptyContent} registry={allView} toolbar={searchForm} />
            <PaginationLinks hrefFor={hrefForPage} page={currentPage} totalPages={totalPages} />
          </section>
        </div>
      </CatalogNavigationProvider>
    </main>
  );
}
