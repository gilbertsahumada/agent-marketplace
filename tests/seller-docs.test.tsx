// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PrimaryNav, MobileNav } from "../components/marketplace/site-nav";
import { MarketplaceShell } from "../components/marketplace/site-shell";
import SellerDocs from "../app/docs/sellers/page";
import { normalizeNegotiationContract } from "../src/shared/negotiation-input";
vi.mock("next/navigation", () => ({ usePathname: () => "/docs/sellers" }));
vi.mock("../components/marketplace/wallet-connect-button", () => ({ WalletConnectButton: () => null }));
afterEach(cleanup);
it("provides a single footer with grouped links and one Docs entry", () => {
  render(<MarketplaceShell><main>Content</main></MarketplaceShell>);
  expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  expect(screen.getByRole("navigation", { name: "Footer marketplace" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Footer resources" })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Docs" })).toHaveLength(1);
});
it("keeps docs out of desktop and mobile primary navigation", () => {
  render(<><PrimaryNav /><MobileNav /></>);
  expect(screen.queryByRole("link", { name: "Docs" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  expect(screen.queryByRole("link", { name: "Docs" })).not.toBeInTheDocument();
});
it("documents listing separately from hiring and includes all transport examples", () => {
  render(<SellerDocs />);
  for (const name of ["Minimum requirements", "A2A", "HTTP", "MCP", "Form fields", "Before you publish"]) {
    expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  }
  expect(screen.getByText(/marketplace convention, not a requirement/)).toBeInTheDocument();
});
it("publishes examples accepted by the runtime contract validator", () => {
  const { container } = render(<SellerDocs />);
  const examples = Array.from(container.querySelectorAll("pre code"), node => JSON.parse(node.textContent!));
  expect(examples).toHaveLength(3);
  expect(normalizeNegotiationContract(examples[0].params).encoding).toBe("prefixed-json");
  expect(normalizeNegotiationContract(examples[1].negotiationInput).encoding).toBe("prefixed-json");
  expect(normalizeNegotiationContract({ encoding: "request", inputSchema: examples[2].inputSchema }).encoding).toBe("request");
});
