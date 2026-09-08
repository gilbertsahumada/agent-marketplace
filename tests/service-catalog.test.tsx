// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { ServiceCard, serviceArtwork } from "../components/marketplace/service-card";
import { serviceFilterHref, serviceFacetCount } from "../components/marketplace/service-catalog-controls";
import type { AgentCardViewModel } from "../components/marketplace/presentation-types";

afterEach(cleanup);

it("isolates decorative motion from the cover text and background", () => {
  render(createElement(ServiceCard, { agent }));
  const cover = screen.getByTestId("service-cover");
  const graphic = cover.querySelector('[data-artwork="grid"]');
  expect(graphic).not.toBeNull();
  expect(graphic?.querySelectorAll("rect")).toHaveLength(7);
  expect(graphic?.querySelector("text")).toBeNull();
  expect(cover.querySelectorAll("text")).toHaveLength(3);
});

it("opens from the card surface without intercepting the identity link", async () => {
  render(createElement(ServiceCard, { agent }));
  const card = screen.getByRole("article", { name: `${agent.name} service` });
  expect(card).toHaveClass("cursor-pointer", "duration-300", "hover:border-primary/25");
  await userEvent.click(screen.getByRole("link", { name: /Agent 2197 on Trust8004/ }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(card);
  expect(screen.getByRole("dialog", { name: agent.name })).toBeInTheDocument();
});

it("keeps missing facet counts distinct from zero", () => {
  expect(serviceFacetCount(undefined, "category", "grid_trading")).toBeUndefined();
  expect(serviceFacetCount({ categories: { grid_trading: 0, rebalancing: 3, yield_optimisation: 0, health_factor_monitoring: 0 }, statuses: {} as never, protocols: { a2a: 23 } }, "protocol", "a2a")).toBe(23);
  expect(serviceFacetCount({ categories: { grid_trading: 0, rebalancing: 3, yield_optimisation: 0, health_factor_monitoring: 0 }, statuses: {} as never }, "category", "grid_trading")).toBe(0);
});
const agent: AgentCardViewModel = {
  agentId: "2197", chainId: 97, name: "Grid provider", description: "A declared service description.",
  operator: "marketplace", categories: ["grid_trading"], href: "/hire/2197?network=testnet",
  hireability: "quote_stale", passportState: "evaluated", evidence: [],
  quoteRequestAvailable: true, buyerAction: "request_quote", jobCount: 5, completedJobCount: 1,
};

it("restores varied declaration-based artwork without assigning verified categories", () => {
  for (const [description, kind] of [
    ["Health factor monitoring agent", "monitor"],
    ["Yield optimization agent", "yield"],
    ["Liquidity range rebalancer", "range"],
    ["Grid trading strategy agent", "grid"],
  ]) {
    const declared = { ...agent, categories: [], description: description! };
    expect(serviceArtwork(declared).kind).toBe(kind);
    expect(declared.categories).toEqual([]);
  }
  render(createElement(ServiceCard, { agent }));
  expect(screen.getByLabelText("Grid provider initials")).toHaveTextContent("GR");
});

it("opens a compact service dialog with visible history and the correct network action", async () => {
  render(createElement(ServiceCard, { agent }));
  expect(screen.getByRole("link", { name: /Agent 2197 on Trust8004/ })).toHaveAttribute("href", "https://trust8004.xyz/agents/97:2197");
  expect(screen.getByRole("button", { name: agent.description })).toHaveClass("line-clamp-3");
  await userEvent.click(screen.getByRole("button", { name: "Explore service" }));
  const dialog = screen.getByRole("dialog", { name: agent.name });
  expect(within(dialog).getByText("BSC Testnet")).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: /Identity for agent 2197/ })).toHaveTextContent("Identity · #2197");
  expect(within(dialog).getByText("5")).toBeInTheDocument();
  expect(within(dialog).getByText("1")).toBeInTheDocument();
  expect(dialog.querySelector("details")).toBeNull();
  expect(within(dialog).getByRole("link", { name: "Request quote" })).toHaveAttribute("href", "/hire/2197?network=testnet#hire-flow");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not turn missing history into zero or names into service claims", async () => {
  const { jobCount: _jobs, completedJobCount: _completed, ...unknown } = agent;
  expect(serviceArtwork({ ...unknown, categories: [] }).kind).toBe("generic");
  render(createElement(ServiceCard, { agent: { ...unknown, buyerAction: "unavailable", quoteRequestAvailable: false } }));
  await userEvent.click(screen.getByRole("button", { name: "Explore service" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByText("—")).toHaveLength(2);
  expect(within(dialog).getByRole("button", { name: "Not available" })).toBeDisabled();
});

it("updates filter groups without losing search, scope or network and resets pagination", () => {
  const url = new URL(serviceFilterHref("/agents?network=testnet&scope=evaluation&q=grid&page=4&cursor=old&status=pending&protocol=mcp", { status: ["quote_capable", "completed_jobs"] }), "http://localhost");
  expect(url.searchParams.get("network")).toBe("testnet");
  expect(url.searchParams.get("scope")).toBe("evaluation");
  expect(url.searchParams.get("q")).toBe("grid");
  expect(url.searchParams.get("protocol")).toBe("mcp");
  expect(url.searchParams.getAll("status")).toEqual(["quote_capable", "completed_jobs"]);
  expect(url.searchParams.has("page")).toBe(false);
  expect(url.searchParams.has("cursor")).toBe(false);
});
