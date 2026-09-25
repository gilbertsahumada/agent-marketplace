"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { catalogQueryHref, normalizeCatalogQuery } from "@/src/presentation/catalog-query";

type CatalogNavigationValue = {
  navigate: (href: string, method?: "push" | "replace") => void;
  pending: boolean;
  navigating: boolean;
  setResultsPending: (pending: boolean) => void;
};

const CatalogNavigationContext = createContext<CatalogNavigationValue | null>(null);

export function catalogScopedHref(href: string, scope?: "all" | "hiring" | "evaluation", network?: "mainnet" | "testnet") {
  const url = new URL(href, "https://marketplace.invalid");
  if (scope && url.pathname === "/agents" && url.searchParams.get("view") !== "all" && !url.searchParams.has("scope")) url.searchParams.set("scope", scope);
  if (network && url.pathname === "/agents" && !url.searchParams.has("network")) url.searchParams.set("network", network);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function CatalogNavigationProvider({ children, navigationKey, scope, network, initialPending = false }: { children: ReactNode; navigationKey: string; scope?: "all" | "hiring" | "evaluation"; network?: "mainnet" | "testnet"; initialPending?: boolean }) {
  const router = useRouter();
  const [targetHref, setTargetHref] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [resultsPending, setResultsPending] = useState(initialPending);

  useEffect(() => setTargetHref(null), [navigationKey]);

  const navigate = useCallback((href: string, method: "push" | "replace" = "push") => {
    const scopedHref = catalogScopedHref(href, scope, network);
    if (navigationKey.startsWith("/agents?")) {
      const params = new URL(scopedHref, "https://marketplace.invalid").searchParams;
      const input = Object.fromEntries([...new Set(params.keys())].map(key => [key, params.getAll(key).length > 1 ? params.getAll(key) : params.get(key) ?? undefined]));
      if (catalogQueryHref(normalizeCatalogQuery(input)) === navigationKey) return;
    }
    setTargetHref(scopedHref);
    startTransition(() => router[method](scopedHref));
  }, [router, scope, network, navigationKey]);

  const value = useMemo<CatalogNavigationValue>(() => ({
    navigate,
    pending: targetHref !== null || resultsPending,
    navigating: targetHref !== null,
    setResultsPending,
  }), [navigate, targetHref, resultsPending]);

  return <CatalogNavigationContext.Provider value={value}>{children}</CatalogNavigationContext.Provider>;
}

export function useCatalogNavigation() {
  const context = useContext(CatalogNavigationContext);
  if (!context) throw new Error("CATALOG_NAVIGATION_PROVIDER_REQUIRED");
  return context;
}
