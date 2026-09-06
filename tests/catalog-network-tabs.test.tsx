// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CatalogNetworkTabs } from "../components/marketplace/catalog-network-tabs";

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
