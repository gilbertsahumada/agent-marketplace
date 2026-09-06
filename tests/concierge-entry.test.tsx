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
  it("renders an Ask link to /ask first in the desktop nav", () => {
    render(createElement(PrimaryNav));
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/ask");
    expect(links[0]).toHaveTextContent("Ask");
  });

  it("renders an Ask link to /ask first in the mobile nav", () => {
    render(createElement(MobileNav));
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/ask");
    expect(links[0]).toHaveTextContent("Ask");
  });

  it("renders the ask-the-concierge form when conciergeEnabled is set", async () => {
    render(createElement(CatalogPage, {
      data: emptyPage(),
      query: { view: "all", sort: "newest" },
      conciergeEnabled: true,
    }));
    const form = screen.getByRole("form", { name: "Ask the concierge" });
    expect(form).toHaveAttribute("action", "/ask");
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByPlaceholderText(/What do you need\? e\.g\. a grid on BNB\/USDT between 500 and 700/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();

    expect((await axe.run(form)).violations).toEqual([]);
  });

  it("does not render the ask-the-concierge form when conciergeEnabled is not set", () => {
    render(createElement(CatalogPage, {
      data: emptyPage(),
      query: { view: "all", sort: "newest" },
    }));
    expect(screen.queryByRole("form", { name: "Ask the concierge" })).not.toBeInTheDocument();
  });
});
