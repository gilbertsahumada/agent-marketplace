"use client";

import { useState, type ReactNode } from "react";
import { Layers, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CatalogFacetCounts } from "@/src/business/entities/catalog-candidate";
import { useCatalogNavigation } from "./catalog-navigation";

const groups = [
  { title: "Service type", key: "category", options: [["grid_trading", "Grid trading"], ["rebalancing", "Rebalancing"], ["yield_optimisation", "Yield optimisation"], ["health_factor_monitoring", "Health factor monitoring"]] },
  { title: "Availability", key: "status", options: [["requestable", "Can request quote"], ["quote_capable", "Ready to quote"], ["pending", "Compatibility pending"], ["quote_failed", "Quote failed"], ["failed", "Endpoint check failed"]] },
  { title: "Work history", key: "status", options: [["completed_jobs", "Completed jobs"]] },
  { title: "Connection", key: "reachability", options: [["live", "Reachable now"], ["historical", "Previously reachable"], ["never", "Never observed"], ["browser_observed", "Browser observed"]] },
  { title: "Protocol", key: "protocol", options: [["a2a", "A2A"], ["erc8183_http", "HTTP"], ["mcp", "MCP"]] },
  { title: "Declarations", key: "status", options: [["declared", "Declared endpoints"], ["erc8183", "ERC-8183 declared"]] },
] as const;
const filterKeys = ["category", "status", "reachability", "protocol"] as const;

function AvailabilityHelp() {
  return <FieldDescription>Available to quote: you can request a price for your job. Ready to quote: quote capability was recently checked. You still need your own quote before hiring.</FieldDescription>;
}

function FilterCount({ value }: { value: number | undefined }) {
  return <span aria-hidden="true" className="ml-auto text-xs tabular-nums text-muted-foreground">{typeof value === "number" ? value.toLocaleString("en-US") : "—"}</span>;
}

export function serviceFacetCount(counts: CatalogFacetCounts | undefined, key: string, value: string): number | undefined {
  const values = key === "category" ? counts?.categories : key === "status" ? counts?.statuses : key === "protocol" ? counts?.protocols : counts?.reachability;
  return (values as Record<string, number> | undefined)?.[value];
}

export function ServiceCatalogSidebar({ href, counts, scopeCounts }: { href: string; counts?: CatalogFacetCounts; scopeCounts?: { hiring?: number; evaluation?: number } }) {
  const { pending, navigate } = useCatalogNavigation();
  const params = new URL(href, "https://marketplace.invalid").searchParams;
  return <aside aria-label="Catalog filters" aria-busy={pending} className="hidden self-start rounded-xl border border-border bg-card p-4 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
    <div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-medium">Filters</h2><Button variant="ghost" size="sm" disabled={pending} onClick={() => navigate(serviceFilterHref(href, { category: [], status: [], reachability: [], protocol: [] }))}>Clear filters</Button></div>
    <FieldGroup>
      <FieldSet><FieldLegend variant="label">Browse agents</FieldLegend>
        <FieldDescription>Under evaluation: checks are incomplete or need updating. Listing is not proof of delivery.</FieldDescription>
        <FieldGroup className="gap-3">
          {([["hiring", "Available to quote"], ["evaluation", "Under evaluation"]] as const).map(([value, label]) => <Field key={value} orientation="horizontal" data-disabled={pending}>
            <input className="size-4 shrink-0 accent-primary" type="radio" name="sidebar-scope" id={`sidebar-scope-${value}`} value={value} checked={(params.get("scope") ?? "hiring") === value} disabled={pending} onChange={() => navigate(serviceFilterHref(href, { scope: [value] }))} />
            <FieldLabel className="flex flex-1 justify-between gap-3" htmlFor={`sidebar-scope-${value}`}>{label}<FilterCount value={scopeCounts?.[value]} /></FieldLabel>
          </Field>)}
        </FieldGroup>
      </FieldSet>
      {groups.map(group => <FieldSet key={group.title}><FieldLegend variant="label">{group.title}</FieldLegend>{group.title === "Availability" && <AvailabilityHelp />}<FieldGroup className="gap-3">
        {group.options.map(([value, label]) => <Field key={value} orientation="horizontal" data-disabled={pending}>
          <Checkbox id={`sidebar-${value}`} disabled={pending} checked={params.getAll(group.key).includes(value)} onCheckedChange={checked => navigate(serviceFilterHref(href, { [group.key]: checked ? [...params.getAll(group.key), value] : params.getAll(group.key).filter(item => item !== value) }))} />
          <FieldLabel className="flex flex-1 justify-between gap-3" htmlFor={`sidebar-${value}`}>{label}<FilterCount value={serviceFacetCount(counts, group.key, value)} /></FieldLabel>
        </Field>)}
      </FieldGroup></FieldSet>)}
    </FieldGroup>
  </aside>;
}

export function serviceFilterHref(href: string, changes: Record<string, string[]>) {
  const url = new URL(href, "https://marketplace.invalid");
  url.searchParams.delete("page");
  url.searchParams.delete("cursor");
  for (const [key, values] of Object.entries(changes)) {
    url.searchParams.delete(key);
    for (const value of values) url.searchParams.append(key, value);
  }
  return `${url.pathname}?${url.searchParams}`;
}

export function ServiceCatalogControls({ href, search, total, counts, registry = false }: {
  href: string; search: ReactNode; total: number; counts?: CatalogFacetCounts; registry?: boolean;
}) {
  const { pending, navigate } = useCatalogNavigation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => new URL(href, "https://marketplace.invalid").searchParams.toString());
  const params = new URL(href, "https://marketplace.invalid").searchParams;
  const draftParams = new URLSearchParams(draft);
  const active = filterKeys.flatMap(key => params.getAll(key).map(value => ({ key, value, label: groups.flatMap(g => g.key === key ? [...g.options] : []).find(([v]) => v === value)?.[1] ?? value })));
  if (params.get("scope") === "evaluation") active.push({ key: "status", value: "__evaluation", label: "Under evaluation" });
  const clear = () => navigate(serviceFilterHref(href, { category: [], status: [], reachability: [], protocol: [], scope: ["hiring"] }));
  const setDraftValue = (key: string, value: string, checked = true, single = false) => {
    setDraft(current => {
      const next = new URLSearchParams(current);
      const values = single ? [] : next.getAll(key).filter(v => v !== value);
      next.delete(key);
      for (const item of checked ? [...values, value] : values) next.append(key, item);
      return next.toString();
    });
  };
  return <div className="contents" aria-busy={pending}>
    <div className="contents">
      <div className="col-span-2 min-w-0 sm:col-span-1">{search}</div>
      <Select value={params.get("network") ?? "mainnet"} disabled={pending} onValueChange={value => navigate(serviceFilterHref(href, { network: [value] }))}>
        <SelectTrigger className="data-[size=default]:h-10" aria-label="Agent network"><Layers aria-hidden="true" /><SelectValue>{params.get("network") === "testnet" ? "BSC Testnet" : "BSC Mainnet"}</SelectValue></SelectTrigger>
        <SelectContent><SelectGroup><SelectItem value="mainnet">BSC Mainnet</SelectItem><SelectItem value="testnet">BSC Testnet</SelectItem></SelectGroup></SelectContent>
      </Select>
      {!registry && <Dialog open={open} onOpenChange={next => { if (next) setDraft(params.toString()); setOpen(next); }}>
        <DialogTrigger asChild><Button className="h-10 lg:hidden" variant="outline" disabled={pending}><SlidersHorizontal aria-hidden="true" data-icon="inline-start" />Filters{active.length > 0 && <Badge>{active.length}</Badge>}</Button></DialogTrigger>
        <DialogContent className="agents-catalog inset-y-0 right-0 left-auto h-dvh max-h-dvh max-w-full translate-x-0 translate-y-0 overflow-y-auto rounded-none sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Filters</DialogTitle><DialogDescription>Find services by availability, type and recorded work.</DialogDescription></DialogHeader>
          <form onSubmit={event => {
            event.preventDefault();
            const changes: Record<string, string[]> = { scope: [draftParams.get("scope") ?? "hiring"] };
            for (const key of filterKeys) changes[key] = draftParams.getAll(key);
            navigate(serviceFilterHref(href, changes)); setOpen(false);
          }}>
            <FieldGroup>
              <Field><FieldLabel htmlFor="service-scope">Browse</FieldLabel><Select value={draftParams.get("scope") ?? "hiring"} disabled={pending} onValueChange={value => setDraftValue("scope", value, true, true)}><SelectTrigger id="service-scope" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="hiring">For hiring</SelectItem><SelectItem value="evaluation">Under evaluation</SelectItem></SelectGroup></SelectContent></Select></Field>
              <FieldDescription>Under evaluation: checks are incomplete or need updating. Listing is not proof of delivery.</FieldDescription>
              {groups.map(group => <FieldSet key={group.title}><FieldLegend variant="label">{group.title}</FieldLegend>{group.title === "Availability" && <AvailabilityHelp />}<FieldGroup>
                {group.options.filter(([value]) => group.key !== "category" || !counts || counts.categories[value as keyof typeof counts.categories] > 0 || draftParams.getAll(group.key).includes(value)).map(([value, label]) => <Field orientation="horizontal" key={value}>
                  <Checkbox id={`service-filter-${value}`} disabled={pending} checked={draftParams.getAll(group.key).includes(value)} onCheckedChange={checked => setDraftValue(group.key, value, checked === true)} />
                  <FieldLabel className="flex flex-1 justify-between gap-3" htmlFor={`service-filter-${value}`}>{label}<FilterCount value={serviceFacetCount(counts, group.key, value)} /></FieldLabel>
                </Field>)}
              </FieldGroup></FieldSet>)}
              <div className="sticky bottom-0 flex gap-3 bg-popover py-3"><Button variant="outline" type="button" disabled={pending} onClick={() => { const next = new URLSearchParams(draft); for (const key of filterKeys) next.delete(key); next.set("scope", "hiring"); setDraft(next.toString()); }}>Clear filters</Button><Button type="submit" disabled={pending}>Show results</Button></div>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>}
    </div>
    <div className="order-last col-span-full flex flex-wrap items-center gap-2" aria-label="Active filters">
      <p className="mr-auto text-xs text-muted-foreground" role="status">{pending ? "Updating results…" : `${total.toLocaleString("en-US")} ${registry ? "registered agents" : params.get("scope") === "evaluation" ? "agents under evaluation" : "agents available to quote"}`}</p>
      {active.map(({ key, value, label }) => <Button key={`${key}:${value}`} variant="outline" size="sm" disabled={pending} aria-label={`Remove ${label} filter`} onClick={() => navigate(serviceFilterHref(href, value === "__evaluation" ? { scope: ["hiring"] } : { [key]: params.getAll(key).filter(v => v !== value) }))}>{label}<X aria-hidden="true" data-icon="inline-end" /></Button>)}
      {active.length > 0 && <Button size="sm" variant="ghost" disabled={pending} onClick={clear}>Clear all</Button>}
    </div>
  </div>;
}
