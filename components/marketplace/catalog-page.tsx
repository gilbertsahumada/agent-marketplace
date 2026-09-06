import Link from "next/link";
import { Database, ListFilter, RadioTower, UsersRound } from "lucide-react";
import type { MarketplaceAgentPage, MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import type { CatalogCandidatePage, CatalogFacetCounts, CatalogStatus } from "@/src/business/entities/catalog-candidate";
import {
  DEFAULT_REGISTERED_AGENT_SORT,
  type MarketplaceReachability,
  type MarketplaceProtocol,
  type MarketplaceSort,
} from "@/src/business/use-cases/list-marketplace-agents";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

import { CatalogMetric } from "./catalog-metric";
import { CatalogNetworkTabs } from "./catalog-network-tabs";

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
  conciergeEnabled = false,
}: {
  data?: MarketplaceAgentPage;
  catalog?: CatalogCandidatePage;
  observations?: ObservationFeedResult;
  query: {
    network?: "mainnet" | "testnet";
    view: "all" | "marketplace";
    scope?: "hiring" | "evaluation";
    status?: CatalogStatus;
    category?: MarketplaceCategory;
    statuses?: CatalogStatus[];
    categories?: MarketplaceCategory[];
    reachability?: MarketplaceReachability[];
    protocols?: MarketplaceProtocol[];
    q?: string;
    sort?: MarketplaceSort;
  };
  provenAgentId?: string;
  registryTotal?: number;
  operationalTotal?: number;
  filterCounts?: CatalogFacetCounts;
  conciergeEnabled?: boolean;
}) {
  if (!data && !catalog) throw new Error("CATALOG_PAGE_DATA_REQUIRED");
  const allView = query.view === "all";
  const network = query.network ?? "mainnet";
  const selectedStatuses = query.statuses ?? (query.status ? [query.status] : []);
  const selectedCategories = query.categories ?? (query.category ? [query.category] : []);
  const selectedReachability = query.reachability ?? [];
  const selectedProtocols = query.protocols ?? [];
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
      && query.scope !== "evaluation"
      && (selectedStatuses.length === 0 || (selectedStatuses.length === 1 && selectedStatuses[0] === "declared"))
      && selectedCategories.length === 0 && !query.q ? total : undefined);
  const currentPage = catalog?.page ?? data!.pagination.page;
  const totalPages = total === 0 ? 0 : Math.ceil(total / (catalog?.limit ?? data!.pagination.pageSize));
  const hrefForPage = (page: number) => {
    const params = new URLSearchParams({ view: query.view, page: String(page), limit: "24" });
    params.set("network", network);
    if (query.scope) params.set("scope", query.scope);
    if (!allView) for (const status of selectedStatuses) params.append("status", status);
    for (const category of selectedCategories) params.append("category", category);
    if (!allView) for (const value of selectedReachability) params.append("reachability", value);
    if (!allView) for (const value of selectedProtocols) params.append("protocol", value);
    if (query.q) params.set("q", query.q);
    if (query.sort) params.set("sort", query.sort);
    return `/agents?${params}`;
  };
  const searchForm = (
    <form action="/agents" className={allView ? "grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" : "relative grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 lg:block"} key="catalog-search">
      <input name="view" type="hidden" value={query.view} />
      <input name="network" type="hidden" value={network} />
      {query.scope && <input name="scope" type="hidden" value={query.scope} />}
      {!allView && selectedStatuses.map((status) => <input key={status} name="status" type="hidden" value={status} />)}
      {selectedCategories.map((category) => <input key={category} name="category" type="hidden" value={category} />)}
      {!allView && selectedReachability.map((value) => <input key={value} name="reachability" type="hidden" value={value} />)}
      {!allView && selectedProtocols.map((value) => <input key={value} name="protocol" type="hidden" value={value} />)}
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
              protocols={selectedProtocols}
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
        protocols={selectedProtocols}
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

  const emptyContent = catalog?.coverage?.catalogDiscovery === "not_configured" ? (
    <Alert>
      <AlertTitle>Testnet agent discovery is not configured yet</AlertTitle>
      <AlertDescription>Testnet jobs are indexed separately. They do not establish that a Testnet agent can accept quotes here.</AlertDescription>
    </Alert>
  ) : selectedCategories.length === 1 && selectedCategories[0] === "grid_trading" ? (
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
      {conciergeEnabled && (
        <form action="/ask" aria-label="Ask the concierge" className="marketplace-surface mb-6 flex items-center gap-2 rounded-xl p-3" method="get">
          <label className="sr-only" htmlFor="concierge-entry-q">What do you need?</label>
          <Input
            id="concierge-entry-q"
            maxLength={1200}
            name="q"
            placeholder="What do you need? e.g. a grid on BNB/USDT between 500 and 700"
          />
          <Button type="submit">Ask</Button>
        </form>
      )}
      <CatalogNavigationProvider {...(query.network ? { network: query.network } : {})} navigationKey={JSON.stringify(query)} {...(query.scope ? { scope: query.scope } : {})}>
      <CatalogNetworkTabs network={network} href={hrefForPage(currentPage)}>
        <div className={allView ? "" : "grid gap-6 lg:h-[calc(100dvh-7rem)] lg:min-h-[30rem] lg:grid-cols-[17rem_minmax(0,1fr)]"}>
          {!allView && (
            <aside aria-label="Catalog filters" className="marketplace-surface hidden rounded-xl lg:sticky lg:top-0 lg:block lg:max-h-full lg:self-start lg:overflow-y-auto">
              <CatalogFilters protocols={selectedProtocols} idPrefix="catalog-desktop" categories={selectedCategories} reachability={selectedReachability} {...(filterCounts ? { counts: filterCounts } : {})} statuses={selectedStatuses} {...(query.q ? { q: query.q } : {})} />
              <div className="m-4 rounded-lg border border-white/8 bg-black/20 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-white"><Database aria-hidden="true" className="size-4 text-primary" />Catalog data</div>
                <p className="mt-3 text-xs leading-5 text-zinc-400">trust8004 catalog + marketplace observation Worker</p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">Compatibility checks are in progress. Pending does not mean incompatible.</p>
                <p className="mt-2 font-stat text-[10px] text-zinc-600">Captured {dataCapturedAt(data, catalog)}</p>
              </div>
            </aside>
          )}

          <section aria-label="Agent results" className="min-w-0 space-y-4 lg:h-full lg:overflow-y-auto lg:pr-2">
            {!allView && <nav aria-label="Agent inventory" className="flex flex-wrap items-center gap-2">
              <Link aria-current={query.scope !== "evaluation" ? "page" : undefined} className={buttonVariants({ variant: query.scope !== "evaluation" ? "default" : "outline", size: "sm" })} href={`/agents?scope=hiring&network=${network}`}>For hiring</Link>
              <Link aria-current={query.scope === "evaluation" ? "page" : undefined} className={buttonVariants({ variant: query.scope === "evaluation" ? "default" : "outline", size: "sm" })} href={`/agents?scope=evaluation&network=${network}`}>Under evaluation</Link>
              <p className="text-xs text-muted-foreground">{query.scope === "evaluation" ? "Not currently requestable. Pending does not mean incompatible." : "Checked quote forms. No previous quote or job required."}</p>
            </nav>}
            <div className="marketplace-surface grid items-center gap-4 rounded-xl p-3 xl:grid-cols-[auto_minmax(0,1fr)]" data-testid="catalog-summary">
              <div aria-label="Catalog totals" className="flex items-center gap-5 px-1 sm:gap-7">
                <div className="flex items-center gap-2.5"><UsersRound aria-hidden="true" className="size-4 text-zinc-600" /><CatalogMetric label={network === "testnet" ? "Testnet agents indexed" : "ERC-8004 registered"} value={registryTotal} /></div>
                <div aria-hidden="true" className="h-10 w-px bg-white/10" />
                <div className="flex items-center gap-2.5"><RadioTower aria-hidden="true" className="size-4 text-primary" /><CatalogMetric label="Can request quote" value={operationalTotal} /></div>
              </div>
            </div>
            <CatalogResults
              agents={cards}
              emptyContent={emptyContent}
              filters={!allView ? (
                <CatalogQuickFilters protocols={selectedProtocols} key="catalog-quick-filters" categories={selectedCategories} {...(filterCounts ? { counts: filterCounts } : {})} {...(query.q ? { q: query.q } : {})} reachability={selectedReachability} statuses={selectedStatuses} />
              ) : undefined}
              registry={allView}
              toolbar={searchForm}
            />
            <PaginationLinks hrefFor={hrefForPage} page={currentPage} totalPages={totalPages} />
          </section>
        </div>
      </CatalogNetworkTabs>
      </CatalogNavigationProvider>
    </main>
  );
}
