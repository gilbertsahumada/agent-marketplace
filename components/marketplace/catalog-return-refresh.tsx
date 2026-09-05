"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const REFRESH_KEY = "bnb-agent-marketplace:catalog-refresh";
export const MARKETPLACE_EVIDENCE_CHANGED = "marketplace:evidence-changed";
let revision = 0;

/** Scope local mutations without treating browser data as verified evidence. */
export function subscribeMarketplaceEvidence(agentId: string, callback: () => void, chainId: 56 | 97 = 56): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ agentId?: string; chainId: number }>).detail;
    if (detail && detail.chainId === chainId && (!detail.agentId || detail.agentId === agentId)) callback();
  };
  window.addEventListener(MARKETPLACE_EVIDENCE_CHANGED, listener);
  return () => window.removeEventListener(MARKETPLACE_EVIDENCE_CHANGED, listener);
}

/** Mark the list for a fresh server read after a validation/quote write. */
export function markCatalogForRefresh(agentId?: string, chainId: 56 | 97 = 56): void {
  if (typeof window === "undefined") return;
  // Non-sensitive, short-lived hint. Only the server can authenticate the
  // corresponding Worker cache bypass; this cookie never grants write access.
  try {
    document.cookie = "marketplace_evidence_refresh=1; Max-Age=30; Path=/; SameSite=Lax";
  } catch {
    // Storage policies must not turn a completed seller action into a UI error.
  }
  try {
    window.sessionStorage.setItem(REFRESH_KEY, `${Date.now()}:${++revision}`);
  } catch {
    // Private browsing/storage restrictions must never interrupt validation.
  }
  window.dispatchEvent(new CustomEvent(MARKETPLACE_EVIDENCE_CHANGED, { detail: { agentId, chainId } }));
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
    window.addEventListener(MARKETPLACE_EVIDENCE_CHANGED, refreshIfMarked);
    document.addEventListener("visibilitychange", refreshIfMarked);
    return () => {
      window.removeEventListener("pageshow", refreshIfMarked);
      window.removeEventListener("focus", refreshIfMarked);
      window.removeEventListener(MARKETPLACE_EVIDENCE_CHANGED, refreshIfMarked);
      document.removeEventListener("visibilitychange", refreshIfMarked);
    };
  }, [router]);

  return null;
}
