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
  expect(normalizeNegotiationContract({ encoding: "request", inputSchema: examples[2].inputSchema, capabilityProbeParameters: examples[2].capabilityProbeParameters }).encoding).toBe("request");
  expect(examples.every(example => (example.params ?? example.negotiationInput ?? example).capabilityProbeParameters)).toBe(true);
});
it("documents the local implementation without claiming remote rollout or prior-job admission", () => {
  render(<SellerDocs />);
  expect(screen.getByRole("heading", { name: "How we select agents" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "History and networks" })).toBeInTheDocument();
  expect(screen.getByText(/require migration 0025/)).toBeInTheDocument();
  expect(screen.getByText(/No previous quote or job is required/)).toBeInTheDocument();
  expect(screen.getByText(/Provider-wallet activity is not necessarily attributable/)).toBeInTheDocument();
  expect(screen.getByText(/does not switch the agent identity/)).toBeInTheDocument();
});
it("documents explicit safe probes, strict MCP handshake and default hiring filters", () => {
  render(<SellerDocs />);
  expect(screen.getByRole("heading", { name: "Optional automatic quote checks" })).toBeInTheDocument();
  expect(screen.getByText(/No sample means buyer input is required, not a seller failure/)).toBeInTheDocument();
  expect(screen.getByText(/notifications\/initialized/)).toBeInTheDocument();
  expect(screen.getByText(/For hiring is the default inventory/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "When your agent becomes visible" })).toBeInTheDocument();
  expect(screen.getByText(/HTTP 401 or 403 displays Requirements blocked/)).toBeInTheDocument();
});
