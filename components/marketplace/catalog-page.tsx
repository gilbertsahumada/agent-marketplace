import Link from "next/link";
import { Search } from "lucide-react";
import type { MarketplaceAgentPage, MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import {
  DEFAULT_REGISTERED_AGENT_SORT,
  type MarketplaceSort,
} from "@/src/business/use-cases/list-marketplace-agents";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CatalogResults } from "./catalog-results";
import { CoverageBadge, PageIntro, PaginationLinks } from "./page-primitives";
import { agentCardWithObservations } from "./view-models";
import { observationTargetsByAgentId, type ObservationFeedResult } from "@/src/business/entities/worker-observations";

const categoryLabels: Record<MarketplaceCategory, string> = {
  rebalancing: "Rebalancing",
  grid_trading: "Grid Trading",
  yield_optimisation: "Yield Optimisation",
  health_factor_monitoring: "Health Factor Monitoring",
};

export function CatalogPage({ data, observations = { status: "unavailable", feed: null }, query, provenAgentId }: { data: MarketplaceAgentPage; observations?: ObservationFeedResult; query: { view: "all" | "marketplace"; category?: MarketplaceCategory; q?: string; sort?: MarketplaceSort }; provenAgentId?: string }) {
  const allView = query.view === "all";
  const targets = observationTargetsByAgentId(observations.feed);
  const now = Date.now();
  const cards = data.items.map((agent) => agentCardWithObservations(
    agent,
    targets.get(agent.agentId) ?? [],
    observations.status === "available",
    now,
    provenAgentId,
    query.category,
  ));
  const hrefForPage = (page: number) => {
    const params = new URLSearchParams({ view: query.view, page: String(page), limit: allView ? "24" : "12" });
    if (query.category) params.set("category", query.category);
    if (query.q) params.set("q", query.q);
    if (query.sort) params.set("sort", query.sort);
    return `/agents?${params}`;
  };

  return (
    <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <PageIntro eyebrow="BSC agent catalog" title={allView ? "All registered agents" : "Hire an agent"}>
          {allView
            ? `Every agent here is an active BSC registration. Marketplace selection is a curated subset; registration alone is not evaluation or hireability. The count is trust8004 response.total for chainId 56 with active=true, fetched ${new Date(data.fetchedAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })}.`
            : "Marketplace selection is a curated subset of all registered BSC agents, classified by outcome. Hiring status shows which agents can be quoted now."}
        </PageIntro>
        <CoverageBadge scope={allView ? "registry" : "marketplace"} total={data.pagination.total} />
      </div>

      {!allView && observations.status === "unavailable" && (
        <Alert className="mt-6 border-amber-400/25 bg-amber-400/[0.06]">
          <AlertTitle>Marketplace monitoring is not connected</AlertTitle>
          <AlertDescription>
            Reachability is unknown—not failed. No probe count or last-attempt time can be shown until the observation feed is configured.
          </AlertDescription>
        </Alert>
      )}
      {!allView && observations.status === "available" && (
        <Alert className="mt-6 border-cyan-400/20 bg-cyan-400/[0.04]">
          <AlertTitle>Marketplace monitoring</AlertTitle>
          <AlertDescription>
            {observations.feed.monitoring?.producerEnabled === false
              ? `Automatic monitoring is paused.${observations.feed.monitoring.lastSchedulerAttemptAt ? ` Last Worker run ${new Date(observations.feed.monitoring.lastSchedulerAttemptAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })}.` : ""}`
              : observations.feed.monitoring?.lastSchedulerAttemptAt
              ? `Last Worker run ${new Date(observations.feed.monitoring.lastSchedulerAttemptAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })} · ${observations.feed.monitoring.lastSchedulerPhase ?? "unknown phase"} · ${observations.feed.monitoring.lastSchedulerOutcome ?? "unknown outcome"}.`
              : observations.feed.monitoring
                ? "The feed is connected, but no scheduler execution has been recorded."
                : "The feed is connected, but the deployed Worker does not yet expose scheduler history."}
          </AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="agent-scope-heading" className="mt-8 flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-eyebrow text-zinc-500" id="agent-scope-heading">Agent scope</p>
          <p className="mt-1 text-xs text-zinc-400">One public registry, shown at two levels of curation.</p>
        </div>
        <nav aria-label="Agent scope" className="flex flex-wrap gap-2">
          <Button asChild variant={!allView ? "default" : "ghost"}><Link aria-current={!allView ? "page" : undefined} href="/agents?view=marketplace">Marketplace selection</Link></Button>
          <Button asChild variant={allView ? "default" : "ghost"}><Link aria-current={allView ? "page" : undefined} href="/agents?view=all&page=1&limit=24">All registered agents</Link></Button>
        </nav>
      </section>

      {!allView && (
        <nav aria-label="Marketplace categories" className="mt-5 flex flex-wrap gap-2">
          <Button asChild size="sm" variant={!query.category ? "secondary" : "outline"}><Link href="/agents?view=marketplace">All outcomes</Link></Button>
          {Object.entries(categoryLabels).map(([category, label]) => (
            <Button asChild key={category} size="sm" variant={query.category === category ? "secondary" : "outline"}>
              <Link href={`/agents?view=marketplace&category=${category}`}>{label}</Link>
            </Button>
          ))}
        </nav>
      )}

      <form action="/agents" className="mt-6 grid gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:grid-cols-[1fr_auto_auto]">
        <input name="view" type="hidden" value={query.view} />
        {query.category && <input name="category" type="hidden" value={query.category} />}
        <label className="relative">
          <span className="sr-only">Search agents</span>
          <Search aria-hidden="true" className="absolute left-3 top-3 size-4 text-zinc-500" />
          <Input className="pl-9" defaultValue={query.q} maxLength={120} name="q" placeholder={allView ? "Search all registered agents" : "Search marketplace selection"} />
        </label>
        {allView && (
          <label>
            <span className="sr-only">Sort agents</span>
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" defaultValue={query.sort ?? DEFAULT_REGISTERED_AGENT_SORT} name="sort">
              <option value="newest">Newest</option>
              <option value="trust_score">Trust score</option>
              <option value="reputation">Reputation</option>
              <option value="agent_id">Agent ID</option>
            </select>
          </label>
        )}
        <Button type="submit">Search</Button>
      </form>

      {data.items.length > 0 ? (
        <CatalogResults agents={cards} registry={allView} />
      ) : query.category === "grid_trading" ? (
        <Alert className="mt-6 border-zinc-800 bg-zinc-950">
          <AlertTitle>No verified Grid Trading agent yet</AlertTitle>
          <AlertDescription><span>We have not found a seller with sufficient operational evidence.</span> <Link href="/jobs/testnet/551">Inspect the verified ERC-8183 demonstration</Link> without treating it as a Grid seller.</AlertDescription>
        </Alert>
      ) : (
        <Alert className="mt-6 border-zinc-800 bg-zinc-950">
          <AlertTitle>No agents found</AlertTitle>
          <AlertDescription>Try a different search or return to the complete view.</AlertDescription>
        </Alert>
      )}

      <PaginationLinks hrefFor={hrefForPage} page={data.pagination.page} totalPages={data.pagination.totalPages} />
    </main>
  );
}
