import Link from "next/link";
import type { MarketplaceAgentPage, MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import type { CatalogCandidatePage, CatalogFacetCounts, CatalogStatus } from "@/src/business/entities/catalog-candidate";
import {
  DEFAULT_REGISTERED_AGENT_SORT,
  type MarketplaceReachability,
  type MarketplaceProtocol,
  type MarketplaceSort,
} from "@/src/business/use-cases/list-marketplace-agents";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ServiceCatalogControls, ServiceCatalogSidebar } from "./service-catalog-controls";
import { CatalogResults } from "./catalog-results";
import { PaginationLinks } from "./page-primitives";
import { agentCardWithObservations } from "./view-models";
import { observationTargetsByAgentId, type ObservationFeedResult } from "@/src/business/entities/worker-observations";
import { catalogCandidateCard } from "./catalog-candidate-view-model";
import { CatalogNavigationProvider } from "./catalog-navigation";
import { CatalogSearch } from "./catalog-search";
import { CatalogReturnRefresh } from "./catalog-return-refresh";


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
  filterCounts,
  scopeCounts,
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
  scopeCounts?: { hiring?: number; evaluation?: number };
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
    <form action="/agents" className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" key="catalog-search">
      <input name="view" type="hidden" value={query.view} />
      <input name="network" type="hidden" value={network} />
      {query.scope && <input name="scope" type="hidden" value={query.scope} />}
      {!allView && selectedStatuses.map((status) => <input key={status} name="status" type="hidden" value={status} />)}
      {selectedCategories.map((category) => <input key={category} name="category" type="hidden" value={category} />)}
      {!allView && selectedReachability.map((value) => <input key={value} name="reachability" type="hidden" value={value} />)}
      {!allView && selectedProtocols.map((value) => <input key={value} name="protocol" type="hidden" value={value} />)}
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
    <main id="main-content" className="agents-catalog mx-auto w-full max-w-[96rem] flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{allView ? "Agent directory" : "Find an agent for your next job"}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Explore services, define your requirements and get a quote.</p>
      </header>
      <CatalogReturnRefresh />
      <CatalogNavigationProvider network={network} navigationKey={JSON.stringify(query)} {...(query.scope ? { scope: query.scope } : {})}>
        <div className={allView ? "" : "grid items-start gap-6 lg:grid-cols-[250px_minmax(0,1fr)]"}>
        {!allView && <ServiceCatalogSidebar href={hrefForPage(currentPage)} {...(filterCounts ? { counts: filterCounts } : {})} {...(scopeCounts ? { scopeCounts } : {})} />}
        <section aria-label="Agent results" className="flex min-w-0 flex-col gap-6">
          <CatalogResults agents={cards} emptyContent={emptyContent} registry={allView}
            toolbar={<ServiceCatalogControls key="service-controls" href={hrefForPage(currentPage)} search={searchForm} total={total} {...(filterCounts ? { counts: filterCounts } : {})} registry={allView} />}
          />
          <PaginationLinks hrefFor={hrefForPage} page={currentPage} totalPages={totalPages} total={total} pageSize={catalog?.limit ?? data!.pagination.pageSize} shown={cards.length} />
          <p className="text-xs text-muted-foreground">Catalogue: Trust8004 · Marketplace observations · Captured {dataCapturedAt(data, catalog)}. Recorded activity is not a quality rating.</p>
        </section>
        </div>
      </CatalogNavigationProvider>
    </main>
  );
}
