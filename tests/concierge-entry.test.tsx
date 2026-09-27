// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement, type AnchorHTMLAttributes } from "react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CatalogPage } from "../components/marketplace/catalog-page.tsx";
import { PrimaryNav, MobileNav } from "../components/marketplace/site-nav.tsx";
import type { MarketplaceAgentPage } from "../src/business/entities/marketplace-agent.ts";

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/agents",
  useRouter: () => ({ refresh: routerRefresh }),
}));

vi.mock("next/link", async () => {
  const { createElement: createMockElement } = await import("react");
  return {
    default: ({ prefetch, ...anchorProps }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) =>
      createMockElement("a", { ...anchorProps, "data-prefetch": String(prefetch) }),
  };
});

vi.mock("../components/marketplace/wallet-connect-button", () => ({ WalletConnectButton: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function emptyPage(): MarketplaceAgentPage {
  return {
    view: "all",
    items: [],
    pagination: { page: 1, pageSize: 24, total: 0, totalPages: 0 },
    categories: [],
    catalogCoverage: "partial",
    fetchedAt: "2026-08-17T00:00:00.000Z",
  };
}

describe("concierge entry points", () => {
  it("keeps Ask accessible through Tools in the desktop nav", () => {
    render(createElement(PrimaryNav));
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByRole("link", { name: "Ask" })).toHaveAttribute("href", "/ask");
  });

  it("keeps Ask accessible in the mobile nav", () => {
    render(createElement(MobileNav));
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("link", { name: "Ask" })).toHaveAttribute("href", "/ask");
  });

  it("keeps the catalog focused on agents without a duplicate concierge form", async () => {
    render(createElement(CatalogPage, {
      data: emptyPage(),
      query: { view: "all", sort: "newest" },
    }));
    expect(screen.queryByRole("form", { name: "Ask the concierge" })).not.toBeInTheDocument();
    expect(screen.queryByText("Checked quote forms. No previous quote or job required.")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("agents-catalog");
    expect((await axe.run(screen.getByRole("combobox", { name: "Agent network" }))).violations).toEqual([]);
  });

  it("does not render the ask-the-concierge form when conciergeEnabled is not set", () => {
    render(createElement(CatalogPage, {
      data: emptyPage(),
      query: { view: "all", sort: "newest" },
    }));
    expect(screen.queryByRole("form", { name: "Ask the concierge" })).not.toBeInTheDocument();
  });
});
