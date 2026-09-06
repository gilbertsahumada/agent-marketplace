// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CatalogNetworkTabs } from "../components/marketplace/catalog-network-tabs";
import { NetworkSelector } from "../components/marketplace/network-selector";

const navigation = vi.hoisted(() => ({ navigate: vi.fn(), pending: false }));
vi.mock("../components/marketplace/catalog-navigation", () => ({ useCatalogNavigation: () => navigation }));
afterEach(() => { cleanup(); navigation.navigate.mockReset(); navigation.pending = false; });

it("uses the jobs network labels and selected yellow treatment while preserving filters", () => {
  render(<CatalogNetworkTabs network="mainnet" href="/agents?scope=hiring&q=grid&page=3&cursor=old"><p>Results</p></CatalogNetworkTabs>);
  expect(screen.getByRole("navigation", { name: "Agent network" })).toHaveClass("rounded-lg");
  const selected = screen.getByRole("button", { name: "BSC Mainnet" });
  expect(selected).toHaveAttribute("aria-current", "page");
  expect(selected).toHaveClass("text-signal");
  fireEvent.click(selected);
  expect(navigation.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "BSC Testnet" }));
  expect(navigation.navigate).toHaveBeenCalledWith("/agents?scope=hiring&q=grid&network=testnet");
  expect(screen.getByText("Results")).toBeInTheDocument();
});

it("disables both controls while the network is loading", () => {
  navigation.pending = true;
  render(<CatalogNetworkTabs network="testnet" href="/agents?network=testnet">Results</CatalogNetworkTabs>);
  for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  expect(screen.getByRole("button", { name: "BSC Testnet" })).toHaveAttribute("aria-current", "page");
});

it.each(["mainnet", "testnet"] as const)("links to both networks and selects only %s in Jobs mode", (network) => {
  render(<NetworkSelector network={network} hrefs={{ mainnet: "/jobs?network=mainnet&days=7", testnet: "/jobs?network=testnet&days=7" }} />);
  const mainnet = screen.getByRole("link", { name: "BSC Mainnet" });
  const testnet = screen.getByRole("link", { name: "BSC Testnet" });
  expect(mainnet).toHaveAttribute("href", "/jobs?network=mainnet&days=7");
  expect(testnet).toHaveAttribute("href", "/jobs?network=testnet&days=7");
  const selected = network === "mainnet" ? mainnet : testnet;
  const other = network === "mainnet" ? testnet : mainnet;
  expect(selected).toHaveAttribute("aria-current", "page");
  expect(selected).toHaveClass("text-signal");
  expect(other).not.toHaveAttribute("aria-current");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Network" })).toHaveClass("h-9", "items-stretch");
});

it("keeps the same compact height in pending-aware Agents mode", () => {
  render(<CatalogNetworkTabs network="mainnet" href="/agents" />);
  expect(screen.getByRole("navigation", { name: "Agent network" })).toHaveClass("h-9", "items-stretch");
});
