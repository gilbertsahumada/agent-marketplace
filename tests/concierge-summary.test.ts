import { describe, expect, it } from "vitest";
import {
  BANNED_COPY,
  filterBannedCopy,
  summarizeConciergeMessage,
  type ConciergeAgentCard,
  type ConciergeUIMessage,
} from "../src/business/entities/concierge.ts";

const gridPlanner: ConciergeAgentCard = {
  agentId: "303779",
  name: "Grid Planner",
  categories: ["grid_trading"],
  hireability: "quote_verified",
  canHire: true,
  summary: "Runs grid strategies",
  href: "/hire/303779",
};

const brief = { objective: "Run a grid", deliverable: "A grid plan", acceptanceCriteria: "Stays in range" };

describe("filterBannedCopy", () => {
  it("rewrites every banned claim and leaves other text alone", () => {
    expect(filterBannedCopy("A proven track record that guarantees results, applied daily.")).toBe(
      "A indexed activity history that promises results, used daily.",
    );
    expect(filterBannedCopy("Approved and unproven.")).toBe("Approved and unproven.");
    expect(filterBannedCopy("Guaranteed")).not.toMatch(BANNED_COPY);
  });
});

describe("summarizeConciergeMessage", () => {
  it("flattens text, steps and the propose output", () => {
    const parts: ConciergeUIMessage["parts"] = [
      { type: "tool-search_agents", toolCallId: "c1", state: "output-available", input: { q: "grid" }, output: { label: "grid", agents: [gridPlanner] } },
      { type: "tool-get_quote_input", toolCallId: "c2", state: "output-available", input: { agentId: "303779" }, output: { agentId: "303779", inputSchema: { type: "object", properties: {} } } },
      {
        type: "tool-propose",
        toolCallId: "c3",
        state: "output-available",
        input: { brief, agentId: "303779", parameters: { pair: "BNB/USDT" } },
        output: {
          brief,
          proposal: { agentId: "303779", parameters: { pair: "BNB/USDT" }, contractHash: "f".repeat(64), fields: [{ key: "pair", title: "Pair", value: "BNB/USDT" }] },
          agents: [gridPlanner],
          rejected: [],
        },
      },
      { type: "text", text: "Here is a " },
      { type: "text", text: "grid plan." },
    ];

    const reply = summarizeConciergeMessage({ parts }, "m");

    expect(reply).toEqual({
      schemaVersion: 1,
      message: "Here is a grid plan.",
      question: null,
      brief,
      agents: [gridPlanner],
      proposal: { agentId: "303779", parameters: { pair: "BNB/USDT" }, contractHash: "f".repeat(64), fields: [{ key: "pair", title: "Pair", value: "BNB/USDT" }] },
      steps: [
        { tool: "search_agents", summary: "1 agents for “grid”" },
        { tool: "get_quote_input", summary: "quote input for 303779" },
      ],
      model: "m",
    });
  });

  it("falls back to the last search's agents and skips failed steps without a propose call", () => {
    const parts: ConciergeUIMessage["parts"] = [
      { type: "tool-search_agents", toolCallId: "c1", state: "output-available", input: {}, output: { error: "UNKNOWN_ERROR" } },
      { type: "tool-search_agents", toolCallId: "c2", state: "output-available", input: { q: "grid" }, output: { label: "grid", agents: [gridPlanner] } },
      { type: "tool-get_passport", toolCallId: "c3", state: "input-available", input: { agentId: "303779" } },
      { type: "text", text: "Nothing to propose yet." },
    ];

    const reply = summarizeConciergeMessage({ parts }, "m");

    expect(reply.agents).toEqual([gridPlanner]);
    expect(reply.proposal).toBeNull();
    expect(reply.brief).toBeNull();
    expect(reply.steps).toEqual([{ tool: "search_agents", summary: "1 agents for “grid”" }]);
  });

  it("keeps the last text the model wrote when the turn ended in a tool call", () => {
    const parts: ConciergeUIMessage["parts"] = [
      { type: "text", text: "Which pair " },
      { type: "text", text: "do you mean?" },
      { type: "tool-search_agents", toolCallId: "c1", state: "output-available", input: { q: "grid" }, output: { label: "grid", agents: [gridPlanner] } },
      { type: "text", text: " " },
    ];

    expect(summarizeConciergeMessage({ parts }, "m").message).toBe("Which pair do you mean?");
  });

  it("surfaces a clarifying question so the eval script can judge it", () => {
    const parts: ConciergeUIMessage["parts"] = [
      { type: "tool-search_agents", toolCallId: "c1", state: "output-available", input: { q: "grid" }, output: { label: "grid", agents: [gridPlanner] } },
      { type: "text", text: "The grid planner needs a price range. Which lower and upper price do you want?" },
    ];

    const reply = summarizeConciergeMessage({ parts }, "m");

    expect(reply.question).toBe("Which lower and upper price do you want?");
    expect(summarizeConciergeMessage({ parts: [{ type: "text", text: "Ready for a quote." }] }, "m").question).toBeNull();
  });

  it("returns an empty reply for a message without parts", () => {
    expect(summarizeConciergeMessage({ parts: [] }, "m")).toMatchObject({ message: "", agents: [], proposal: null, steps: [] });
  });
});
