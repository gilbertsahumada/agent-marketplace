"use client";

import { Suspense, use, useEffect, useRef, useState } from "react";
import type { CatalogReadResult, CatalogReadError } from "@/src/business/entities/catalog-resource";
import type { CatalogResources, CatalogResourceMap, CatalogResourceName } from "@/src/business/entities/catalog-resource";
import { catalogQueryHref, type CatalogQuery } from "@/src/presentation/catalog-query";
import { Button } from "@/components/ui/button";
import { CatalogNavigationProvider, useCatalogNavigation } from "./catalog-navigation";
import { CatalogResultsSkeleton } from "./catalog-loading";
import { CatalogPage } from "./catalog-page";
import { CatalogSearch } from "./catalog-search";
import { CatalogReturnRefresh } from "./catalog-return-refresh";
import { ServiceCatalogControls, ServiceCatalogSidebar, serviceFacetCount } from "./service-catalog-controls";

const messages: Record<CatalogReadError["kind"], string> = {
  timeout: "This is taking longer than expected.",
  network: "Could not connect to the catalogue service.",
  upstream: "The catalogue service could not complete this request.",
  invalid_response: "The catalogue service returned an unexpected response.",
  unavailable: "Catalogue information is temporarily unavailable.",
};

function CountLoading() {
  return <span aria-label="Loading count" aria-busy="true" className="ml-auto inline-block h-3 w-6 rounded bg-muted motion-safe:animate-pulse" />;
}

function Count({ resources, kind, field, value }: { resources: CatalogResources; kind: "facets" | "scopes"; field?: string; value: string }) {
  const { navigating } = useCatalogNavigation();
  if (navigating) return <CountLoading />;
  const result = use<CatalogReadResult<CatalogResourceMap["facets"] | CatalogResourceMap["scopes"]>>(resources[kind]);
  let count: number | undefined;
  if (result.ok) {
    if (kind === "facets") count = serviceFacetCount(result.data as CatalogResourceMap["facets"], field ?? "", value);
    else {
      const scopes = result.data as CatalogResourceMap["scopes"];
      count = value === "all" ? scopes.hiring !== undefined && scopes.evaluation !== undefined ? scopes.hiring + scopes.evaluation : undefined : scopes[value as "hiring" | "evaluation"];
    }
  }
  return <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count === undefined ? "—" : count.toLocaleString("en-US")}</span>;
}

function ResourceError({ result, retry, label }: { result: CatalogReadResult<unknown>; retry: () => void; label: string }) {
  if (result.ok) return null;
  return <div role="status" className="space-y-2 rounded-lg border border-border p-3 text-sm text-muted-foreground"><p>{messages[result.error.kind]}</p><Button type="button" variant="outline" size="sm" onClick={retry}>Retry {label}</Button></div>;
}

function CounterError({ promise, retry, label }: { promise: Promise<CatalogReadResult<unknown>>; retry: () => void; label: string }) {
  const { navigating } = useCatalogNavigation();
  if (navigating) return null;
  return <ResourceError result={use(promise)} retry={retry} label={label} />;
}

function Summary({ promise, query }: { promise: CatalogResources["results"]; query: CatalogQuery }) {
  const result = use(promise);
  if (!result.ok) return <span>Results unavailable</span>;
  const total = result.data.catalog?.total ?? result.data.data?.pagination.total;
  return <span>{total?.toLocaleString("en-US") ?? "—"} {query.view === "all" ? "registered agents" : query.scope === "hiring" ? "agents available to quote" : query.scope === "evaluation" ? "agents under evaluation" : "listed agents"}</span>;
}

function Results({ promise, query, retry }: { promise: CatalogResources["results"]; query: CatalogQuery; retry: () => void }) {
  const result = use(promise);
  const { setResultsPending } = useCatalogNavigation();
  useEffect(() => { setResultsPending(false); }, [promise, setResultsPending]);
  return <section aria-label="Agent results" aria-busy="false" className="flex min-w-0 flex-col gap-6">
    {result.ok ? <CatalogPage {...result.data} query={query} contentOnly /> : <ResourceError result={result} retry={retry} label="results" />}
  </section>;
}

function AvailabilitySummary({ resources, query }: { resources: CatalogResources; query: CatalogQuery }) {
  const results = use(resources.results);
  if (!results.ok || results.data.catalog?.total !== 0 || query.scope !== "hiring") return null;
  const scopes = use(resources.scopes);
  if (!scopes.ok || !scopes.data.evaluation) return null;
  return <p className="text-sm text-muted-foreground">{scopes.data.evaluation.toLocaleString("en-US")} agents are under evaluation on this network. <a className="text-primary underline" href={catalogQueryHref({ ...query, scope: "evaluation", page: 1 })}>Browse agents under evaluation</a></p>;
}

function ResultsLoading() {
  const { setResultsPending } = useCatalogNavigation();
  useEffect(() => { setResultsPending(true); }, [setResultsPending]);
  return <section aria-label="Agent results" aria-busy="true"><span className="sr-only" role="status">Loading agents</span><CatalogResultsSkeleton /></section>;
}

function CatalogSections({ query, initial }: { query: CatalogQuery; initial: CatalogResources }) {
  const [resources, setResources] = useState(initial);
  const [previous, setPrevious] = useState(initial);
  const requests = useRef(new Map<CatalogResourceName, AbortController>());
  const { navigating, pending, navigate, setResultsPending } = useCatalogNavigation();
  // A server refresh (including buyer-action refresh) replaces manual retry data.
  if (previous !== initial) { setPrevious(initial); setResources(initial); }
  useEffect(() => {
    const pending = requests.current;
    return () => { for (const controller of pending.values()) controller.abort(); pending.clear(); };
  }, [initial]);
  const retry = (resource: CatalogResourceName) => {
    if (requests.current.has(resource)) return;
    const controller = new AbortController();
    requests.current.set(resource, controller);
    if (resource === "results") setResultsPending(true);
    const params = new URL(catalogQueryHref(query), "https://catalogue.invalid").searchParams;
    params.set("resource", resource);
    const promise = fetch(`/api/marketplace/catalog-section?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) return { ok: false, error: { kind: "upstream", status: response.status } } as const;
        try {
          const body = await response.json();
          if (body?.ok === true && body.data && typeof body.data === "object") return body;
          if (body?.ok === false && Object.hasOwn(messages, body.error?.kind)) return body;
        } catch { /* Invalid JSON is not a transport failure. */ }
        return { ok: false, error: { kind: "invalid_response" } } as const;
      }).catch(() => ({ ok: false, error: { kind: "network" } } as const))
      .finally(() => { if (requests.current.get(resource) === controller) requests.current.delete(resource); });
    setResources(current => ({ ...current, [resource]: promise }));
  };
  const href = catalogQueryHref(query);
  const slots = {
    facet: (field: string, value: string) => <Suspense fallback={<CountLoading />}><Count resources={resources} kind="facets" field={field} value={value} /></Suspense>,
    scope: (value: string) => <Suspense fallback={<CountLoading />}><Count resources={resources} kind="scopes" value={value} /></Suspense>,
    errors: <div className="mt-3 space-y-2"><Suspense fallback={<span role="status">Loading filter counts…</span>}><CounterError promise={resources.facets} retry={() => retry("facets")} label="filter counts" /></Suspense><Suspense fallback={null}><CounterError promise={resources.scopes} retry={() => retry("scopes")} label="availability counts" /></Suspense></div>,
  };
  return <div className={query.view === "all" ? "grid items-start gap-6" : "grid items-start gap-6 lg:grid-cols-[250px_minmax(0,1fr)]"}>
    {query.view !== "all" && <ServiceCatalogSidebar href={href} countSlots={slots} />}
    <div className="flex min-w-0 flex-col gap-6">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] lg:grid-cols-[minmax(0,1fr)_auto]">
        <ServiceCatalogControls href={href} registry={query.view === "all"} countSlots={slots} search={<div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><CatalogSearch {...query} />{query.view === "all" && <select aria-label="Sort agents" className="h-10 rounded-lg border border-input bg-background px-3 text-sm" disabled={pending} value={query.sort} onChange={event => navigate(catalogQueryHref({ ...query, page: 1, sort: event.target.value as NonNullable<CatalogQuery["sort"]> }))}><option value="newest">Newest</option><option value="trust_score">Trust score</option><option value="reputation">Reputation</option><option value="agent_id">Agent ID</option></select>}</div>} summary={<Suspense fallback={<CountLoading />}><Summary promise={resources.results} query={query} /></Suspense>} />
      </div>
      {navigating ? <ResultsLoading /> : <Suspense fallback={<ResultsLoading />}><Results promise={resources.results} query={query} retry={() => retry("results")} /></Suspense>}
      {!navigating && query.view !== "all" && <Suspense fallback={null}><AvailabilitySummary resources={resources} query={query} /></Suspense>}
    </div>
  </div>;
}

export function ProgressiveCatalog({ query, resources }: { query: CatalogQuery; resources: CatalogResources }) {
  return <main id="main-content" className="agents-catalog mx-auto w-full max-w-[96rem] flex-1 px-4 py-8 sm:px-6 lg:px-8">
    <header className="mb-8"><h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{query.view === "all" ? "Agent directory" : "Find an agent for your next job"}</h1><p className="mt-3 text-sm text-muted-foreground">Explore services, define your requirements and get a quote.</p></header>
    <CatalogReturnRefresh />
    <CatalogNavigationProvider navigationKey={catalogQueryHref(query)} scope={query.scope} network={query.network} initialPending>
      <CatalogSections query={query} initial={resources} />
    </CatalogNavigationProvider>
  </main>;
}
