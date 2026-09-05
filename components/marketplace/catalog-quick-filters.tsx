"use client";

import { RadioTower, RotateCcw, ShieldCheck, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CatalogFacetCounts, CatalogStatus } from "@/src/business/entities/catalog-candidate";
import type { MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import type { MarketplaceReachability, MarketplaceProtocol } from "@/src/business/use-cases/list-marketplace-agents";
import { useCatalogNavigation } from "./catalog-navigation";

type QuickFilter = {
  label: string;
  icon: typeof RadioTower;
  status?: CatalogStatus;
  reachability?: MarketplaceReachability;
  countKey?: CatalogStatus;
};

const quickFilters: QuickFilter[] = [
  { label: "Can request quote", icon: FileCheck, status: "requestable", countKey: "requestable" },
  { label: "Ready to quote", icon: ShieldCheck, status: "quote_capable", countKey: "quote_capable" },
  { label: "Reachable now", icon: RadioTower, reachability: "live" },
  { label: "Compatibility pending", icon: RadioTower, status: "pending", countKey: "pending" },
];

export function CatalogQuickFilters({
  statuses,
  categories,
  reachability,
  protocols = [],
  counts,
  q,
}: {
  statuses: CatalogStatus[];
  categories: MarketplaceCategory[];
  reachability: MarketplaceReachability[];
  protocols?: MarketplaceProtocol[];
  counts?: CatalogFacetCounts;
  q?: string;
}) {
  const { navigate, pending } = useCatalogNavigation();

  const apply = (nextStatuses: CatalogStatus[], nextReachability: MarketplaceReachability[]) => {
    const params = new URLSearchParams({ view: "marketplace" });
    for (const status of nextStatuses) params.append("status", status);
    for (const category of categories) params.append("category", category);
    for (const value of nextReachability) params.append("reachability", value);
    for (const value of protocols) params.append("protocol", value);
    if (q) params.set("q", q);
    navigate(`/agents?${params.toString()}`);
  };

  const active = (filter: QuickFilter) => filter.status
    ? statuses.includes(filter.status)
    : filter.reachability !== undefined && reachability.includes(filter.reachability);

  return (
    <div aria-busy={pending} aria-label="Quick filters" className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 pr-1" data-testid="catalog-quick-filters">
      {quickFilters.map((filter) => {
        const Icon = filter.icon;
        const isActive = active(filter);
        const count = filter.countKey !== undefined
          ? counts?.statuses[filter.countKey]
          : filter.reachability !== undefined
            ? counts?.reachability?.[filter.reachability]
            : undefined;
        return (
          <Button
            aria-pressed={isActive}
            className="h-8 w-auto shrink-0 cursor-pointer gap-1.5 rounded-md px-2.5 text-xs whitespace-nowrap"
            disabled={pending}
            key={filter.label}
            onClick={() => {
              if (filter.status) {
                const next = isActive
                  ? statuses.filter((status) => status !== filter.status)
                  : [...statuses, filter.status];
                apply(next, reachability);
              } else if (filter.reachability) {
                const next = isActive
                  ? reachability.filter((value) => value !== filter.reachability)
                  : [...reachability, filter.reachability];
                apply(statuses, next);
              }
            }}
            type="button"
            variant={isActive ? "default" : "outline"}
          >
            <Icon aria-hidden="true" data-icon="inline-start" />
            <span className="text-left leading-tight">{filter.label}</span>
            {typeof count === "number" && <span className="font-stat border-l border-current/15 pl-2 text-xs tabular-nums opacity-70">{count.toLocaleString("en-US")}</span>}
          </Button>
        );
      })}
      <Button
        className="h-8 w-auto shrink-0 cursor-pointer gap-1.5 rounded-md px-2.5 text-xs whitespace-nowrap"
        disabled={pending || (statuses.length === 0 && categories.length === 0 && reachability.length === 0 && protocols.length === 0 && !q)}
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
