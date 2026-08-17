// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import axe from "axe-core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentCard } from "../components/marketplace/agent-card.js";
import { CatalogPage } from "../components/marketplace/catalog-page.js";
import { EvidenceRail } from "../components/marketplace/evidence-rail.js";
import type { MarketplaceAgentPage } from "../src/business/entities/marketplace-agent.js";

const evidence = [
  { kind: "declared" as const, label: "Declared", status: "verified" as const, provenance: "declared" as const, detail: "Declared" },
  { kind: "reachable" as const, label: "Reachable", status: "unknown" as const, provenance: "observed" as const, detail: "Unknown" },
  { kind: "quote" as const, label: "Quote verified", status: "unknown" as const, provenance: "derived" as const, detail: "Unknown" },
  { kind: "job" as const, label: "Job proven", status: "unknown" as const, provenance: "onchain" as const, detail: "Unknown" },
];

afterEach(cleanup);

describe("marketplace presentation rules", () => {
  it("does not render a Hire action for an MCP-only agent", () => {
    render(createElement(AgentCard, { agent: { agentId: "45650", name: "V3 Pools", description: "Agent", categories: ["rebalancing"], href: "/agents/45650", hireability: "mcp_only", evidence } }));
    expect(screen.getByText("MCP only")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /hire agent/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view evidence/i })).toHaveAttribute("href", "/agents/45650");
  });

  it("keeps the evidence rail accessible as an ordered progression", () => {
    render(createElement(EvidenceRail, { ariaLabel: "Agent evidence", steps: evidence }));
    expect(screen.getByRole("list", { name: "Agent evidence" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("shows the required honest Grid empty state", () => {
    const page: MarketplaceAgentPage = {
      view: "marketplace",
      items: [],
      pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 },
      categories: [],
      catalogCoverage: "partial",
      fetchedAt: "2026-08-17T00:00:00.000Z",
    };
    render(createElement(CatalogPage, { data: page, query: { view: "marketplace", category: "grid_trading" } }));
    expect(screen.getByText("No verified Grid Trading agent yet")).toBeInTheDocument();
    expect(screen.getByText("We have not found a seller with sufficient operational evidence.")).toBeInTheDocument();
  });

  it("has no basic automated accessibility violations in the evidence component", async () => {
    render(createElement("main", {}, createElement("h1", {}, "Evidence"), createElement(EvidenceRail, { steps: evidence })));
    const result = await axe.run(document.body);
    expect(result.violations).toEqual([]);
  });
});
