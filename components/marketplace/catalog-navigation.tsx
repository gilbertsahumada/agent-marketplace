"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type CatalogNavigationValue = {
  navigate: (href: string, method?: "push" | "replace") => void;
  pending: boolean;
};

const NAVIGATION_TIMEOUT_MS = 15_000;

const CatalogNavigationContext = createContext<CatalogNavigationValue | null>(null);

export function catalogScopedHref(href: string, scope?: "hiring" | "evaluation", network?: "mainnet" | "testnet") {
  const url = new URL(href, "https://marketplace.invalid");
  if (scope && url.pathname === "/agents" && url.searchParams.get("view") !== "all" && !url.searchParams.has("scope")) url.searchParams.set("scope", scope);
  if (network && url.pathname === "/agents" && !url.searchParams.has("network")) url.searchParams.set("network", network);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function CatalogNavigationProvider({ children, navigationKey, scope, network }: { children: ReactNode; navigationKey: string; scope?: "hiring" | "evaluation"; network?: "mainnet" | "testnet" }) {
  const router = useRouter();
  const [targetHref, setTargetHref] = useState<string | null>(null);
  const [transitionPending, startTransition] = useTransition();

  useEffect(() => setTargetHref(null), [navigationKey]);

  useEffect(() => {
    if (targetHref === null) return;
    const timeout = window.setTimeout(() => setTargetHref(null), NAVIGATION_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [targetHref]);

  const navigate = useCallback((href: string, method: "push" | "replace" = "push") => {
    const scopedHref = catalogScopedHref(href, scope, network);
    setTargetHref(scopedHref);
    startTransition(() => router[method](scopedHref));
  }, [router, scope, network]);

  const value = useMemo<CatalogNavigationValue>(() => ({
    navigate,
    pending: targetHref !== null || transitionPending,
  }), [navigate, targetHref, transitionPending]);

  return <CatalogNavigationContext.Provider value={value}>{children}</CatalogNavigationContext.Provider>;
}

export function useCatalogNavigation() {
  const context = useContext(CatalogNavigationContext);
  if (!context) throw new Error("CATALOG_NAVIGATION_PROVIDER_REQUIRED");
  return context;
}
