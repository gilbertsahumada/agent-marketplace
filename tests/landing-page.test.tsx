// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement, type AnchorHTMLAttributes } from "react";
import axe from "axe-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketplaceLanding } from "../components/marketplace/landing-page.tsx";
import type { CategoryCardViewModel, LedgerPulseViewModel } from "../components/marketplace/presentation-types.ts";
import { POPULAR_TASKS, requestHref } from "../components/marketplace/request-hero.tsx";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const { createElement: createMockElement } = await import("react");
  return {
    default: ({ prefetch, ...anchorProps }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) =>
      createMockElement("a", { ...anchorProps, "data-prefetch": String(prefetch) }),
  };
});

const categories: CategoryCardViewModel[] = [
  { category: "grid_trading", title: "Grid trading", description: "", href: "/agents?view=marketplace&category=grid_trading", availability: "listed", availabilityLabel: "1 candidate" },
  { category: "rebalancing", title: "Rebalancing", description: "", href: "/agents?view=marketplace&category=rebalancing", availability: "empty", availabilityLabel: "Unverified · empty" },
  { category: "yield_optimisation", title: "Yield optimisation", description: "", href: "/agents?view=marketplace&category=yield_optimisation", availability: "empty", availabilityLabel: "Unverified · empty" },
  { category: "health_factor_monitoring", title: "Health factor monitoring", description: "", href: "/agents?view=marketplace&category=health_factor_monitoring", availability: "empty", availabilityLabel: "Unverified · empty" },
];

const pulse: LedgerPulseViewModel = {
  network: "ERC-8183 Commerce · BSC Mainnet",
  jobsIndexed: "56,744",
  jobsIndexedCount: 56744,
  processedHere: "9",
  indexedThrough: { blockNumber: "120,600,000", ago: "12s ago" },
  window: { days: 7, created: "31", settled: "4", refunded: "0" },
  recent: [
    { jobId: "56744", status: "FUNDED", href: "/jobs/mainnet/56744", buyerShort: "0x7a3c…e91b", updatedAgo: "2m ago", marketplace: true },
    { jobId: "56743", status: "SUBMITTED", href: "/jobs/mainnet/56743", buyerShort: "0x19d0…44af", updatedAgo: "2h ago", marketplace: false },
    { jobId: "56662", status: "COMPLETED", href: "/jobs/mainnet/56662", buyerShort: "0x5ee7…0b1c", updatedAgo: "1d ago", marketplace: true },
  ],
};

function renderLanding(overrides: Partial<Parameters<typeof MarketplaceLanding>[0]> = {}) {
  return render(createElement(MarketplaceLanding, {
    categories,
    conciergeEnabled: true,
    featuredAgents: [],
    ledgerPulse: pulse,
    proofSummary: { href: "/proof/mainnet", title: "Grid plan for BNB/USDT", description: "Requested, paid, delivered and paid out on BNB Chain." },
    qualifiedSeller: { agentId: "303779", name: "Grid Planner" },
    ...overrides,
  }));
}

afterEach(cleanup);

describe("request-first landing", () => {
  it("leads with a request box that lands in the concierge with the text", () => {
    renderLanding();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Post a task. An agent does it. Pay when it’s done.");
    const form = screen.getByRole("form", { name: "Post a task" });
    expect(form).toHaveAttribute("action", "/ask");
    expect(form).toHaveAttribute("method", "get");
    expect(within(form).getByLabelText("What do you need done?")).toHaveAttribute("name", "q");
    expect(within(form).getByRole("button", { name: /get a price/i })).toHaveAttribute("type", "submit");
    const popular = screen.getByRole("navigation", { name: "Popular tasks" });
    expect(within(popular).getAllByRole("link")).toHaveLength(POPULAR_TASKS.length);
    expect(within(popular).getByRole("link", { name: POPULAR_TASKS[0]! })).toHaveAttribute("href", "/ask?q=Plan+a+grid+strategy+for+BNB%2FUSDT+between+500+and+700");
    expect(screen.getByRole("link", { name: "Browse all agents" })).toHaveAttribute("href", "/agents?view=marketplace");
  });

  it("falls back to the catalogue search when the concierge is not configured", () => {
    renderLanding({ conciergeEnabled: false });

    const form = screen.getByRole("form", { name: "Post a task" });
    expect(form).toHaveAttribute("action", "/agents");
    expect(form.querySelector('input[name="view"]')).toHaveAttribute("value", "marketplace");
    expect(requestHref(false, "grid")).toBe("/agents?view=marketplace&q=grid");
    expect(screen.getAllByRole("link", { name: /post (a|your) task/i }).every((link) => link.getAttribute("href") === "/agents?view=marketplace")).toBe(true);
  });

  it("tells the live activity in plain words and links it to the ledger", () => {
    renderLanding();

    const live = screen.getByRole("list", { name: "Live activity" });
    expect(live).toHaveTextContent("Task #56744 funded 2m ago");
    expect(live).toHaveTextContent("31 tasks posted in the last 7 days");
    expect(within(live).getByRole("link", { name: /Task #56744/ })).toHaveAttribute("href", "/jobs/mainnet/56744");
    expect(within(live).getByRole("link", { name: /1 task delivered and checked/ })).toHaveAttribute("href", "/proof/mainnet");
  });

  it("says activity is unavailable instead of showing zeros when the indexer cannot be read", () => {
    renderLanding({ ledgerPulse: null, proofSummary: null });

    expect(screen.getAllByRole("status").map((node) => node.textContent).join(" ")).toMatch(/unavailable/);
    expect(screen.queryByRole("list", { name: "Live activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Recent tasks" })).not.toBeInTheDocument();
    expect(screen.queryByText(/\b0 tasks\b/)).not.toBeInTheDocument();
  });

  it("turns the four categories into services with an honest availability label", () => {
    renderLanding();

    const services = screen.getByRole("list", { name: "Services" });
    const tiles = within(services).getAllByRole("link");
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      expect.stringContaining("Grid trading plans"),
      expect.stringContaining("Portfolio rebalancing"),
      expect.stringContaining("Yield optimisation"),
      expect.stringContaining("Loan health monitoring"),
    ]);
    expect(tiles[0]).toHaveTextContent("Available now");
    expect(tiles[0]).toHaveAttribute("href", "/agents?view=marketplace&category=grid_trading");
    expect(tiles.slice(1).every((tile) => tile.textContent?.includes("Agents onboarding"))).toBe(true);
    expect(within(services).queryByText(/0 agents|empty/i)).not.toBeInTheDocument();
  });

  it("lists recent tasks with plain status words, the proven one first", () => {
    renderLanding();

    const recent = screen.getByRole("list", { name: "Recent tasks" });
    const cards = within(recent).getAllByRole("listitem");
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveTextContent("Grid plan for BNB/USDT");
    expect(cards[0]).toHaveTextContent("Paid & checked");
    expect(within(cards[0]!).getByRole("link", { name: "See the receipt" })).toHaveAttribute("href", "/proof/mainnet");
    expect(cards[1]).toHaveTextContent("Hired here");
    expect(cards[1]).toHaveTextContent("Grid Planner · posted by 0x7a3c…e91b");
    expect(cards[1]).toHaveTextContent("In progress");
    expect(cards[2]).toHaveTextContent("On BNB Chain");
    expect(cards[2]).toHaveTextContent("Ready to review");
    expect(cards[3]).toHaveTextContent("Paid out");
    expect(within(cards[1]!).getByRole("link", { name: "Task #56744" })).toHaveAttribute("href", "/jobs/mainnet/56744");
    expect(screen.getByRole("link", { name: "See all recent tasks" })).toHaveAttribute("href", "/jobs");
    // On-chain phases are named, never graded: a settled job is "paid out",
    // and only the hash-verified proof says "checked".
    expect(cards[3]).not.toHaveTextContent(/checked/);
  });

  it("keeps the technical vocabulary one click away and inside the copy rules", () => {
    const { container } = renderLanding();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/ERC-?8183|ERC-?8004|chain 56|0x[0-9a-f]{40}|escrow|tx hash/i);
    expect(text).not.toMatch(/proven|track record|guarantee|applied/i);
    expect(screen.getByRole("link", { name: "How we verify identity, payment and results" })).toHaveAttribute("href", "/evidence/verification");
    expect(screen.getByRole("link", { name: "Earn with your agent" })).toHaveAttribute("href", "/validate");
    expect(screen.getByRole("link", { name: /post a task/i })).toHaveAttribute("href", "/ask");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderLanding();
    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
