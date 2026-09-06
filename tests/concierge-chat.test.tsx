// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import type { ChatTransport, UIMessageChunk } from "ai";
import axe from "axe-core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type AnchorHTMLAttributes } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ConciergeChat } from "../components/marketplace/concierge-chat.tsx";
import { CONCIERGE_ERROR_COPY } from "../components/marketplace/concierge-request.ts";
import { BANNED_COPY, type ConciergeAgentCard, type ConciergeUIMessage } from "../src/business/entities/concierge.ts";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ prefetch, ...anchorProps }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) =>
      createElement("a", anchorProps),
  };
});

// Streamdown pulls a markdown pipeline the DOM tests do not need; the chat's
// behaviour under test is which parts render where, not how markdown parses.
vi.mock("streamdown", async () => {
  const { createElement } = await import("react");
  return {
    Streamdown: ({ children, className }: { children?: string; className?: string }) => createElement("div", { className }, children),
  };
});

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.scrollTo ??= () => {};
});

afterEach(() => {
  cleanup();
  routerPush.mockClear();
  window.sessionStorage.clear();
});

const CONTRACT_HASH = "f".repeat(64);

const gridPlanner: ConciergeAgentCard = {
  agentId: "303779",
  name: "Grid Planner",
  categories: ["grid_trading"],
  hireability: "quote_verified",
  canHire: true,
  summary: "Runs grid strategies",
  href: "/hire/303779",
};

const rebalancer: ConciergeAgentCard = {
  agentId: "9999",
  name: "Rebalancer",
  categories: ["rebalancing"],
  hireability: "mcp_only",
  canHire: false,
  summary: null,
  href: "/hire/9999",
};

const brief = {
  objective: "Run a grid strategy on BNB/USDT",
  deliverable: "A configured grid bot watching the range",
  acceptanceCriteria: "Grid stays within range and rebalances as configured",
};

const parameters = { pair: "BNB/USDT", lowerPrice: "500", upperPrice: "700", capital: "1000", gridCount: 20 };

function turn(chunks: UIMessageChunk[]): UIMessageChunk[] {
  return [{ type: "start" }, { type: "start-step" }, ...chunks, { type: "finish-step" }, { type: "finish" }];
}

function textChunks(id: string, ...deltas: string[]): UIMessageChunk[] {
  return [
    { type: "text-start", id },
    ...deltas.map((delta): UIMessageChunk => ({ type: "text-delta", id, delta })),
    { type: "text-end", id },
  ];
}

function toolChunks(toolCallId: string, toolName: string, input: unknown, output: unknown): UIMessageChunk[] {
  return [
    { type: "tool-input-start", toolCallId, toolName },
    { type: "tool-input-available", toolCallId, toolName, input },
    { type: "tool-output-available", toolCallId, output },
  ];
}

const FULL_TURN = turn([
  ...toolChunks("c1", "search_agents", { q: "grid" }, { label: "grid", agents: [gridPlanner, rebalancer] }),
  ...toolChunks("c2", "get_quote_input", { agentId: "303779" }, { agentId: "303779", inputSchema: { type: "object", properties: {} } }),
  ...toolChunks("c3", "propose", { brief, agentId: "303779", parameters }, {
    brief,
    proposal: {
      agentId: "303779",
      parameters,
      contractHash: CONTRACT_HASH,
      fields: [
        { key: "pair", title: "Pair", value: "BNB/USDT" },
        { key: "lowerPrice", title: "Lower price", value: "500" },
        { key: "upperPrice", title: "Upper price", value: "700" },
        { key: "capital", title: "Capital", value: "1000" },
        { key: "gridCount", title: "Grid count", value: "20" },
      ],
    },
    agents: [gridPlanner, rebalancer],
    rejected: [],
  }),
  ...textChunks("t1", "Here is a verified ", "agent for that."),
]);

type SendOptions = Parameters<ChatTransport<ConciergeUIMessage>["sendMessages"]>[0];

function transportOf(chunksPerCall: UIMessageChunk[][] | Error, onSend?: (options: SendOptions) => void): ChatTransport<ConciergeUIMessage> {
  const queue = chunksPerCall instanceof Error ? [] : [...chunksPerCall];
  return {
    sendMessages: async (options) => {
      onSend?.(options);
      if (chunksPerCall instanceof Error) throw chunksPerCall;
      const chunks = queue.shift() ?? [];
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      });
    },
    reconnectToStream: async () => null,
  };
}

function ask(message: string) {
  fireEvent.change(screen.getByLabelText("Your request"), { target: { value: message } });
  fireEvent.keyDown(screen.getByLabelText("Your request"), { key: "Enter" });
}

describe("ConciergeChat", () => {
  it("renders the conversation, the steps and the proposal, then hands the edited brief to the quote panel", async () => {
    const sent: SendOptions[] = [];
    render(<ConciergeChat transport={transportOf([FULL_TURN], (options) => sent.push(options))} />);

    expect(screen.getByRole("heading", { name: "What do you need done?" })).toBeInTheDocument();
    ask("necesito un grid en BNB/USDT entre 500 y 700");
    await screen.findByText("Here is a verified agent for that.");
    // The greeting and the examples make way for the conversation.
    expect(screen.queryByRole("heading", { name: "What do you need done?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Examples" })).not.toBeInTheDocument();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.messages.at(-1)).toMatchObject({ role: "user", parts: [{ type: "text", text: "necesito un grid en BNB/USDT entre 500 y 700" }] });
    expect(screen.getByText("necesito un grid en BNB/USDT entre 500 y 700")).toBeInTheDocument();

    const steps = screen.getByRole("list", { name: "Steps" });
    expect(within(steps).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Searched the catalog · 2 agents for “grid”",
      "Read the seller's parameters of #303779",
      "Drafted the proposal",
    ]);

    const proposal = screen.getByRole("region", { name: "Proposed parameters" });
    expect(proposal).toHaveTextContent("Ready for a quote");
    expect(proposal).toHaveTextContent("Grid Planner");
    expect(proposal).toHaveTextContent("Verified");
    expect(within(proposal).getByText("BNB/USDT")).toBeInTheDocument();
    expect(within(proposal).getByText("20")).toBeInTheDocument();
    // The proposal wins over the plain agents list.
    expect(screen.queryByRole("region", { name: "Agents for this brief" })).not.toBeInTheDocument();

    fireEvent.change(within(proposal).getByLabelText("Objective"), { target: { value: "Run a tighter grid" } });
    fireEvent.click(within(proposal).getByRole("button", { name: "Continue to quote with Grid Planner" }));

    const stored = JSON.parse(window.sessionStorage.getItem("concierge:303779") ?? "null") as Record<string, unknown>;
    expect(stored).toMatchObject({
      schemaVersion: 1,
      agentId: "303779",
      contractHash: CONTRACT_HASH,
      parameters,
      brief: { ...brief, objective: "Run a tighter grid" },
    });
    expect(routerPush).toHaveBeenCalledWith("/hire/303779#quote-request");

    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(BANNED_COPY);

    const results = await axe.run(document.body);
    expect(results.violations).toEqual([]);
  });

  it("shows the no-match state without a brief when the catalog has nothing", async () => {
    render(
      <ConciergeChat
        transport={transportOf([
          turn([
            ...toolChunks("c1", "search_agents", { q: "trip" }, { label: "trip", agents: [] }),
            ...textChunks("t1", "No agents plan trips; the marketplace covers trading and DeFi monitoring."),
          ]),
        ])}
      />,
    );

    ask("necesito una ruta de viaje de 5 días en Marruecos");
    await screen.findByText("No agents plan trips; the marketplace covers trading and DeFi monitoring.");

    const empty = screen.getByRole("region", { name: "No matching agents" });
    expect(screen.getByRole("link", { name: "Browse verified agents" })).toHaveAttribute("href", "/agents?view=marketplace");
    // The reply already explains the coverage; the card must not repeat it.
    expect(empty).not.toHaveTextContent(/grid trading/);
    expect(screen.queryByRole("region", { name: "Your brief" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Proposed parameters" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Steps" })).toHaveTextContent("Searched the catalog · 0 agents for “trip”");
  });

  it("lists the agents with an open link when there is a brief but no parameters", async () => {
    render(
      <ConciergeChat
        transport={transportOf([
          turn([
            ...toolChunks("c1", "search_agents", { q: "grid" }, { label: "grid", agents: [gridPlanner, rebalancer] }),
            ...toolChunks("c2", "propose", { brief }, { brief, proposal: null, agents: [gridPlanner, rebalancer], rejected: [] }),
            ...textChunks("t1", "Which price range do you want?"),
          ]),
        ])}
      />,
    );

    ask("a grid on BNB/USDT");
    await screen.findByText("Which price range do you want?");

    const briefRegion = screen.getByRole("region", { name: "Your brief" });
    expect(within(briefRegion).getByLabelText("Deliverable")).toHaveValue(brief.deliverable);
    expect(within(briefRegion).getByRole("link", { name: "Open Grid Planner" })).toHaveAttribute("href", "/hire/303779");
    const agents = screen.getByRole("region", { name: "Agents for this brief" });
    const rows = within(agents).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Grid Planner");
    expect(rows[0]).toHaveTextContent("Verified");
    expect(rows[1]).toHaveTextContent("Rebalancer");
    expect(rows[1]).toHaveTextContent("Listed");
    expect(rows[1]).toHaveTextContent("MCP only");
  });

  it("sends a starter suggestion as the first message", async () => {
    const sent: SendOptions[] = [];
    render(<ConciergeChat transport={transportOf([turn(textChunks("t1", "Sure."))], (options) => sent.push(options))} />);

    fireEvent.click(screen.getByRole("button", { name: /A grid on BNB\/USDT between 500 and 700/ }));
    await screen.findByText("Sure.");

    expect(sent[0]!.messages[0]!.parts).toEqual([{ type: "text", text: "A grid on BNB/USDT between 500 and 700 with 1,000 USDT and 20 levels" }]);
  });

  it("sends the initial prompt once", async () => {
    const sent: SendOptions[] = [];
    render(<ConciergeChat initialPrompt="grid on BNB/USDT" transport={transportOf([turn(textChunks("t1", "On it."))], (options) => sent.push(options))} />);

    await screen.findByText("On it.");
    expect(sent).toHaveLength(1);
    expect(screen.getByText("grid on BNB/USDT")).toBeInTheDocument();
  });

  it("explains a busy concierge and offers a retry", async () => {
    const error = new Error(JSON.stringify({ error: { code: "MarketplaceRateLimitError", message: "at capacity" } }));
    render(<ConciergeChat transport={transportOf(error)} />);

    ask("grid");
    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(CONCIERGE_ERROR_COPY.busy);
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
  });
});
