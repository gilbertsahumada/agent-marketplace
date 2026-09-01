"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import type { MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import type { CatalogStatus } from "@/src/business/entities/catalog-candidate";
import { useCatalogNavigation } from "./catalog-navigation";

const statusFilters: Array<{ value: CatalogStatus; label: string }> = [
  { value: "declared", label: "Declared endpoints" },
  { value: "pending", label: "Pending validation" },
  { value: "a2a", label: "A2A reachable" },
  { value: "mcp", label: "MCP reachable" },
  { value: "erc8183", label: "ERC-8183 declared" },
  { value: "quote_capable", label: "Quote verified" },
  { value: "hireable", label: "Hireable now" },
  { value: "failed", label: "Latest probe failed" },
];

const categoryFilters: Array<{ value: MarketplaceCategory; label: string }> = [
  { value: "rebalancing", label: "Rebalancing" },
  { value: "grid_trading", label: "Grid trading" },
  { value: "yield_optimisation", label: "Yield optimisation" },
  { value: "health_factor_monitoring", label: "Health factor monitoring" },
];

export function CatalogFilters({ statuses, categories, q, idPrefix = "catalog" }: {
  statuses: CatalogStatus[];
  categories: MarketplaceCategory[];
  q?: string;
  idPrefix?: string;
}) {
  const { navigate, pending } = useCatalogNavigation();

  const apply = (nextStatuses: CatalogStatus[], nextCategories: MarketplaceCategory[]) => {
    const params = new URLSearchParams({ view: "marketplace" });
    for (const status of nextStatuses) params.append("status", status);
    for (const category of nextCategories) params.append("category", category);
    if (q) params.set("q", q);
    navigate(`/agents?${params.toString()}`);
  };

  return (
    <div aria-busy={pending} className="flex flex-col gap-6">
      <FieldSet>
        <FieldLegend className="font-eyebrow text-zinc-500" variant="label">Evidence</FieldLegend>
        <FieldGroup data-slot="checkbox-group">
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
                    apply(next.length > 0 ? next : ["declared"], categories);
                  }}
                />
                <FieldLabel className="cursor-pointer text-sm font-normal text-zinc-300" htmlFor={id}>
                  {filter.label}
                </FieldLabel>
              </Field>
            );
          })}
        </FieldGroup>
      </FieldSet>

      <Separator />

      <FieldSet>
        <FieldLegend className="font-eyebrow text-zinc-500" variant="label">Outcome</FieldLegend>
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
                  )}
                />
                <FieldLabel className="cursor-pointer text-sm font-normal text-zinc-300" htmlFor={id}>
                  {filter.label}
                </FieldLabel>
              </Field>
            );
          })}
        </FieldGroup>
      </FieldSet>

      <Button
        className="w-full"
        disabled={pending}
        onClick={() => navigate("/agents?view=marketplace")}
        type="button"
        variant="outline"
      >
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        Clear filters
      </Button>
    </div>
  );
}
