// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CatalogReturnRefresh, markCatalogForRefresh, subscribeMarketplaceEvidence } from "../components/marketplace/catalog-return-refresh";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); refresh.mockClear(); });
it("notifies only the affected agent and network and supports unsubscribe", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeMarketplaceEvidence("303779", listener);
  markCatalogForRefresh("304169");
  markCatalogForRefresh("303779", 97);
  expect(listener).not.toHaveBeenCalled();
  markCatalogForRefresh("303779");
  expect(document.cookie).toContain("marketplace_evidence_refresh=1");
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  markCatalogForRefresh("303779");
  expect(listener).toHaveBeenCalledTimes(1);
});
it("refreshes a visible catalogue immediately and does not replay consumed markers", () => {
  render(<CatalogReturnRefresh />);
  markCatalogForRefresh("303779");
  expect(refresh).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("still emits evidence events when session storage is blocked", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeMarketplaceEvidence("303779", listener);
  vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(() => markCatalogForRefresh("303779")).not.toThrow();
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
});
