"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import type { CatalogStatus } from "@/src/business/entities/catalog-candidate";
import type {
  MarketplaceReachability,
  MarketplaceProtocol,
  MarketplaceSort,
} from "@/src/business/use-cases/list-marketplace-agents";
import { useCatalogNavigation } from "./catalog-navigation";

const SEARCH_DELAY_MS = 300;

export function catalogSearchHref(input: {
  view: "all" | "marketplace";
  statuses: CatalogStatus[];
  categories: MarketplaceCategory[];
  reachability?: MarketplaceReachability[];
  protocols?: MarketplaceProtocol[];
  sort?: MarketplaceSort;
  q: string;
}) {
  const params = new URLSearchParams({ view: input.view });
  if (input.view === "marketplace") {
    for (const status of input.statuses) params.append("status", status);
    for (const category of input.categories) params.append("category", category);
    for (const value of input.reachability ?? []) params.append("reachability", value);
    for (const value of input.protocols ?? []) params.append("protocol", value);
  }
  if (input.sort) params.set("sort", input.sort);
  const q = input.q.trim();
  if (q) params.set("q", q);
  return `/agents?${params.toString()}`;
}

export function CatalogSearch({ view, statuses, categories, reachability = [], protocols = [], sort, q = "" }: {
  view: "all" | "marketplace";
  statuses: CatalogStatus[];
  categories: MarketplaceCategory[];
  reachability?: MarketplaceReachability[];
  protocols?: MarketplaceProtocol[];
  sort?: MarketplaceSort;
  q?: string;
}) {
  const [value, setValue] = useState(q);
  const previousQuery = useRef(q);
  const { navigate, pending } = useCatalogNavigation();

  useEffect(() => {
    setValue((current) => current.trim() === previousQuery.current.trim() ? q : current);
    previousQuery.current = q;
  }, [q]);

  useEffect(() => {
    if (value.trim() === q.trim()) return;
    const timeout = window.setTimeout(() => {
      navigate(catalogSearchHref({ view, statuses, categories, reachability, protocols, ...(sort ? { sort } : {}), q: value }), "replace");
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [categories, navigate, protocols, q, reachability, sort, statuses, value, view]);

  return (
    <label className="relative block w-full min-w-0">
      <span className="sr-only">Search agents</span>
      <Search aria-hidden="true" className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-zinc-500" />
      <Input
        aria-busy={pending}
        className="catalog-search-input h-10 pl-11 focus-visible:ring-0"
        disabled={pending}
        maxLength={120}
        name="q"
        onChange={(event) => setValue(event.currentTarget.value)}
        placeholder={view === "all" ? "Search all registered agents" : "Search agents"}
        value={value}
      />
    </label>
  );
}
