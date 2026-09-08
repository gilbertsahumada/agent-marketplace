// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { ServiceCard, serviceArtwork } from "../components/marketplace/service-card";
import { serviceFilterHref } from "../components/marketplace/service-catalog-controls";
import type { AgentCardViewModel } from "../components/marketplace/presentation-types";

afterEach(cleanup);
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
