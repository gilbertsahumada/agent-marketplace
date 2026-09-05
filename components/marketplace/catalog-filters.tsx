"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import type { MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import type { CatalogFacetCounts, CatalogStatus } from "@/src/business/entities/catalog-candidate";
import type { MarketplaceReachability, MarketplaceProtocol } from "@/src/business/use-cases/list-marketplace-agents";
import { useCatalogNavigation } from "./catalog-navigation";

const statusFilters: Array<{ value: CatalogStatus; label: string }> = [
  { value: "requestable", label: "Can request quote" },
  { value: "quote_capable", label: "Ready to quote" },
  { value: "declared", label: "Declared endpoints" },
  { value: "pending", label: "Compatibility pending" },
  { value: "erc8183", label: "ERC-8183 declared" },
  { value: "quote_failed", label: "Quote failed" },
  { value: "failed", label: "Endpoint check failed" },
  { value: "completed_jobs", label: "Completed jobs" },
];

const categoryFilters: Array<{ value: MarketplaceCategory; label: string }> = [
  { value: "rebalancing", label: "Rebalancing" },
  { value: "grid_trading", label: "Grid trading" },
  { value: "yield_optimisation", label: "Yield optimisation" },
  { value: "health_factor_monitoring", label: "Health factor monitoring" },
];

export function CatalogFilters({ statuses, categories, reachability, protocols = [], counts, q, idPrefix = "catalog" }: {
  statuses: CatalogStatus[];
  categories: MarketplaceCategory[];
  reachability: MarketplaceReachability[];
  protocols?: MarketplaceProtocol[];
  counts?: CatalogFacetCounts;
  q?: string;
  idPrefix?: string;
}) {
  const { navigate, pending } = useCatalogNavigation();

  const apply = (
    nextStatuses: CatalogStatus[],
    nextCategories: MarketplaceCategory[],
    nextReachability: MarketplaceReachability[],
    nextProtocols: MarketplaceProtocol[] = protocols,
  ) => {
    const params = new URLSearchParams({ view: "marketplace" });
    for (const status of nextStatuses) params.append("status", status);
    for (const category of nextCategories) params.append("category", category);
    for (const value of nextReachability) params.append("reachability", value);
    for (const value of nextProtocols) params.append("protocol", value);
    if (q) params.set("q", q);
    navigate(`/agents?${params.toString()}`);
  };

  return (
    <div aria-busy={pending} className="flex flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
        <p className="text-sm font-semibold text-white">Filters</p>
        <Button
          aria-label="Clear filters"
          className="h-auto cursor-pointer px-0 text-xs text-zinc-400 hover:text-white"
          disabled={pending}
          onClick={() => navigate("/agents?view=marketplace")}
          type="button"
          variant="link"
        >
          Clear all
        </Button>
      </div>

      <FieldSet className="border-b border-white/10 px-4 py-4">
        <FieldLegend variant="label">Transport</FieldLegend>
        <FieldGroup data-slot="checkbox-group">
          {([['a2a', 'A2A'], ['erc8183_http', 'HTTP'], ['mcp', 'MCP']] as const).map(([value,label]) => (
            <Field key={value} orientation="horizontal">
              <Checkbox id={`${idPrefix}-protocol-${value}`} disabled={pending} checked={protocols.includes(value)} onCheckedChange={(checked) => apply(statuses,categories,reachability,checked ? [...protocols,value] : protocols.filter((protocol) => protocol !== value))} />
              <FieldLabel htmlFor={`${idPrefix}-protocol-${value}`} className="flex cursor-pointer items-center justify-between gap-3 text-sm font-normal text-zinc-300">
                {label}
                {typeof counts?.protocols?.[value] === "number" && <span className="font-stat text-xs tabular-nums text-zinc-500">{counts.protocols[value]!.toLocaleString("en-US")}</span>}
              </FieldLabel>
            </Field>
          ))}
        </FieldGroup>
      </FieldSet>
      <details className="group border-b border-white/10 px-4 py-4" open>
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-white [&::-webkit-details-marker]:hidden">
          Evidence
          <ChevronDown aria-hidden="true" className="size-4 text-zinc-500 transition-transform group-open:rotate-180" />
        </summary>
        <FieldSet className="mt-4">
          <FieldLegend className="sr-only" variant="label">Evidence</FieldLegend>
          <FieldGroup data-slot="checkbox-group">
          <Field orientation="horizontal">
            <Checkbox
              checked={reachability.includes("live")}
              disabled={pending}
              id={`${idPrefix}-reachability-live`}
              onCheckedChange={(checked) => apply(
                statuses,
                categories,
                checked ? [...reachability, "live"] : reachability.filter((value) => value !== "live"),
              )}
            />
            <FieldLabel className="flex cursor-pointer items-center justify-between gap-3 text-sm font-normal text-zinc-300" htmlFor={`${idPrefix}-reachability-live`}>
              <span>Reachable now</span>
              {counts?.reachability && <span aria-hidden="true" className="font-stat text-xs tabular-nums text-zinc-500">{counts.reachability.live.toLocaleString("en-US")}</span>}
            </FieldLabel>
          </Field>
          {statusFilters.map((filter) => {
            const id = `${idPrefix}-status-${filter.value}`;
            return (
              <Field key={filter.value} orientation="horizontal">
                <Checkbox
                  checked={statuses.includes(filter.value)}
                  disabled={pending}
                  id={id}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...statuses, filter.value]
                      : statuses.filter((status) => status !== filter.value);
                    apply(next, categories, reachability);
                  }}
                />
                <FieldLabel className="flex cursor-pointer items-center justify-between gap-3 text-sm font-normal text-zinc-300" htmlFor={id}>
                  <span>{filter.label}</span>
                  {typeof counts?.statuses[filter.value] === "number" && <span aria-hidden="true" className="font-stat text-xs tabular-nums text-zinc-500">{counts.statuses[filter.value]!.toLocaleString("en-US")}</span>}
                </FieldLabel>
              </Field>
            );
          })}
          </FieldGroup>
        </FieldSet>
      </details>

      <details className="group border-b border-white/10 px-4 py-4" open>
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-white [&::-webkit-details-marker]:hidden">
          Outcome
          <ChevronDown aria-hidden="true" className="size-4 text-zinc-500 transition-transform group-open:rotate-180" />
        </summary>
        <FieldSet className="mt-4">
          <FieldLegend className="sr-only" variant="label">Outcome</FieldLegend>
          <FieldGroup data-slot="checkbox-group">
          {categoryFilters.map((filter) => {
            const id = `${idPrefix}-category-${filter.value}`;
            return (
              <Field key={filter.value} orientation="horizontal">
                <Checkbox
                  checked={categories.includes(filter.value)}
                  disabled={pending}
                  id={id}
                  onCheckedChange={(checked) => apply(
                    statuses,
                    checked ? [...categories, filter.value] : categories.filter((category) => category !== filter.value),
                    reachability,
                  )}
                />
                <FieldLabel className="flex cursor-pointer items-center justify-between gap-3 text-sm font-normal text-zinc-300" htmlFor={id}>
                  <span>{filter.label}</span>
                  {counts && <span aria-hidden="true" className="font-stat text-xs tabular-nums text-zinc-500">{counts.categories[filter.value].toLocaleString("en-US")}</span>}
                </FieldLabel>
              </Field>
            );
          })}
          </FieldGroup>
        </FieldSet>
      </details>

    </div>
  );
}
