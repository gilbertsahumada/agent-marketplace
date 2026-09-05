import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXAMPLE_BRIEF, PostAJobSection, matchingAgents } from "@/components/marketplace/post-a-job-section";
import type { AgentCardViewModel } from "@/components/marketplace/presentation-types";

function agent(overrides: Partial<AgentCardViewModel> & Pick<AgentCardViewModel, "agentId" | "name">): AgentCardViewModel {
  return {
    description: "", operator: "third_party", categories: ["grid_trading"], href: `/hire/${overrides.agentId}`,
    hireability: "hireable", evidence: [], passportState: "hireable", ...overrides,
  };
}

describe("PostAJobSection", () => {
  it("ranks verified agents in the brief's category first and caps the list", () => {
    const agents = [
      agent({ agentId: "1", name: "Listed only", hireability: "listed_only" }),
      agent({ agentId: "2", name: "Other category", categories: ["rebalancing"] }),
      agent({ agentId: "3", name: "Grid Planner" }),
      agent({ agentId: "4", name: "Stale", hireability: "quote_stale" }),
      agent({ agentId: "5", name: "Fourth", hireability: "listed_only" }),
    ];
    expect(matchingAgents(agents, EXAMPLE_BRIEF.category).map((entry) => entry.name)).toEqual(["Grid Planner", "Stale", "Listed only"]);
  });

  it("shows the example brief in the quote request's own fields and links to the first verified agent", () => {
    const html = renderToStaticMarkup(createElement(PostAJobSection, { agents: [agent({ agentId: "303779", name: "Grid Planner" })] }));
    expect(html).toContain("What I need");
    expect(html).toContain(EXAMPLE_BRIEF.objective);
    expect(html).toContain("How I will judge it");
    expect(html).toContain("1 listed · 1 verified");
    expect(html).toContain('href="/hire/303779"');
    expect(html).toContain("Get a quote from Grid Planner");
    expect(html).toContain("Verified · quote on request");
    expect(html).not.toMatch(/proven|track record|applied/i);
  });

  it("keeps the gap visible when no verified agent covers the category", () => {
    const html = renderToStaticMarkup(createElement(PostAJobSection, { agents: [agent({ agentId: "9", name: "Rebalancer", categories: ["rebalancing"] })] }));
    expect(html).toContain("No agent covers grid trading yet");
    expect(html).toContain("0 listed · 0 verified");
    expect(html).not.toContain("Get a quote from");
    expect(html).toContain('href="/agents?view=marketplace"');
  });

  it("offers to see, not to quote, an agent that is only listed", () => {
    const html = renderToStaticMarkup(createElement(PostAJobSection, { agents: [agent({ agentId: "7", name: "Grid Bot", hireability: "listed_only" })] }));
    expect(html).toContain("1 listed · 0 verified");
    expect(html).toContain("See Grid Bot");
    expect(html).not.toContain("Get a quote from");
  });
});
