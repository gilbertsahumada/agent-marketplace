"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import type { MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import type { CatalogStatus } from "@/src/business/entities/catalog-candidate";

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

export function CatalogFilters({ status, category, q, idPrefix = "catalog" }: {
  status: CatalogStatus;
  category?: MarketplaceCategory;
  q?: string;
  idPrefix?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const navigate = (nextStatus: CatalogStatus, nextCategory?: MarketplaceCategory) => {
    const params = new URLSearchParams({ view: "marketplace", status: nextStatus });
    if (nextCategory) params.set("category", nextCategory);
    if (q) params.set("q", q);
    startTransition(() => router.push(`/agents?${params.toString()}`));
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
                  checked={status === filter.value}
                  disabled={pending}
                  id={id}
                  onCheckedChange={(checked) => {
                    if (checked) navigate(filter.value, category);
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
                  checked={category === filter.value}
                  disabled={pending}
                  id={id}
                  onCheckedChange={(checked) => navigate(status, checked ? filter.value : undefined)}
                />
                <FieldLabel className="cursor-pointer text-sm font-normal text-zinc-300" htmlFor={id}>
                  {filter.label}
                </FieldLabel>
              </Field>
            );
          })}
        </FieldGroup>
      </FieldSet>
    </div>
  );
}
