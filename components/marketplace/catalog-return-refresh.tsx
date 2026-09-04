"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const REFRESH_KEY = "bnb-agent-marketplace:catalog-refresh";

/** Mark the list for a fresh server read after a validation/quote write. */
export function markCatalogForRefresh(): void {
  try {
    window.sessionStorage.setItem(REFRESH_KEY, String(Date.now()));
  } catch {
    // Private browsing/storage restrictions must never interrupt validation.
  }
}

/**
 * The App Router can restore the previous /agents tree from its client history
 * cache when the user presses Back. Check a one-shot marker on mount and when
 * the page becomes visible so a completed detail-page action is reflected in
 * the restored card without asking the user to hard-refresh.
 */
export function CatalogReturnRefresh() {
  const router = useRouter();
  const consumed = useRef<string | null>(null);

  useEffect(() => {
    const refreshIfMarked = () => {
      let marker: string | null = null;
      try {
        marker = window.sessionStorage.getItem(REFRESH_KEY);
      } catch {
        return;
      }
      if (!marker || marker === consumed.current) return;
      consumed.current = marker;
      try {
        window.sessionStorage.removeItem(REFRESH_KEY);
      } catch {
        // The marker was still consumed in memory; avoid a refresh loop.
      }
      router.refresh();
    };

    refreshIfMarked();
    window.addEventListener("pageshow", refreshIfMarked);
    window.addEventListener("focus", refreshIfMarked);
    document.addEventListener("visibilitychange", refreshIfMarked);
    return () => {
      window.removeEventListener("pageshow", refreshIfMarked);
      window.removeEventListener("focus", refreshIfMarked);
      document.removeEventListener("visibilitychange", refreshIfMarked);
    };
  }, [router]);

  return null;
}
