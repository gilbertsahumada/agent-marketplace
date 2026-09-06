// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement, StrictMode, type AnchorHTMLAttributes } from "react";
import axe from "axe-core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConciergeChat } from "../components/marketplace/concierge-chat.tsx";
import { CONCIERGE_LIMITS, type ConciergeReply } from "../src/business/entities/concierge.ts";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  routerPush.mockClear();
  window.sessionStorage.clear();
});

const CONTRACT_HASH = "f".repeat(64);

const FULL_REPLY: ConciergeReply = {
  schemaVersion: 1,
  message: "Here is a verified agent for that.",
  question: null,
  brief: {
    objective: "Run a grid strategy on BNB/USDT",
    deliverable: "A configured grid bot watching the range",
    acceptanceCriteria: "Grid stays within range and rebalances as configured",
  },
  agents: [
    {
      agentId: "303779",
      name: "Grid Planner",
      categories: ["grid_trading"],
      hireability: "quote_verified",
      canHire: true,
      summary: "Runs grid strategies",
      href: "/hire/303779",
    },
    {
      agentId: "9999",
      name: "Rebalancer",
      categories: ["rebalancing"],
      hireability: "mcp_only",
      canHire: false,
      summary: null,
      href: "/hire/9999",
    },
  ],
  proposal: {
    agentId: "303779",
    parameters: { pair: "BNBUSDT", lowerPrice: "500", upperPrice: "700", capital: "1000", gridCount: "20" },
    contractHash: CONTRACT_HASH,
    fields: [
      { key: "pair", title: "Pair", value: "BNB/USDT" },
      { key: "lowerPrice", title: "Lower price", value: "500" },
      { key: "upperPrice", title: "Upper price", value: "700" },
      { key: "capital", title: "Capital", value: "1000" },
      { key: "gridCount", title: "Grid count", value: "20" },
    ],
  },
  steps: [
    { tool: "search_agents", summary: '3 agents for "grid"' },
    { tool: "get_quote_input", summary: "quote input for 303779" },
  ],
  model: "qwen-test",
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

async function typeAndAsk(message: string) {
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: message } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

describe("ConciergeChat", () => {
  it("shows the no-match state without a brief form when nothing in the catalog fits", async () => {
    const reply = {
      ...FULL_REPLY,
      message: "No agents plan trips; the marketplace covers trading and DeFi monitoring.",
      brief: { objective: "Plan a trip", deliverable: "An itinerary", acceptanceCriteria: "Five days" },
      agents: [],
      proposal: null,
      steps: [{ tool: "search_agents", summary: '0 agents for "trip"' }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(reply)));
    render(<ConciergeChat />);

    await typeAndAsk("necesito una ruta de viaje de 5 días en Marruecos");
    await screen.findByText(reply.message);

    const empty = screen.getByRole("region", { name: "No matching agents" });
    expect(empty).toHaveTextContent(/grid trading, rebalancing, yield optimisation and health-factor monitoring/);
    expect(screen.getByRole("link", { name: "Browse verified agents" })).toHaveAttribute("href", "/agents?view=marketplace");
    expect(screen.queryByRole("region", { name: "Your brief" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Agents for this brief" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Steps" })).toHaveTextContent('Searched the catalog · 0 agents for "trip"');
    expect(document.body.textContent).not.toMatch(/search_agents/);
  });

  it("asks the concierge and renders steps, editable brief, agents and the proposal", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(FULL_REPLY));
    vi.stubGlobal("fetch", fetcher);
    render(<ConciergeChat />);

    await typeAndAsk("Quiero un grid en BNB/USDT entre 500 y 700");
    await screen.findByText(FULL_REPLY.message);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0]!;
    expect(JSON.parse(String(init!.body))).toEqual({
      schemaVersion: 1,
      messages: [{ role: "user", content: "Quiero un grid en BNB/USDT entre 500 y 700" }],
    });

    expect(screen.getByRole("list", { name: "Steps" })).toHaveTextContent('Searched the catalog · 3 agents for "grid"');
    expect(screen.getByLabelText("Objective")).toHaveValue(FULL_REPLY.brief!.objective);
    expect(screen.getByLabelText("Deliverable")).toHaveValue(FULL_REPLY.brief!.deliverable);
    expect(screen.getByLabelText("Acceptance criteria")).toHaveValue(FULL_REPLY.brief!.acceptanceCriteria);

    const agentsList = screen.getByRole("list", { name: "Agents for this brief" });
    expect(agentsList).toHaveTextContent("Grid Planner");
    expect(agentsList).toHaveTextContent("verified");
    expect(agentsList).toHaveTextContent("ready to quote");
    expect(agentsList).toHaveTextContent("Rebalancer");
    expect(agentsList).toHaveTextContent("listed");
    expect(agentsList).toHaveTextContent("MCP only");

    const proposal = screen.getByRole("region", { name: "Proposed parameters" });
    expect(proposal).toHaveTextContent("Pair");
    expect(proposal).toHaveTextContent("BNB/USDT");
    expect(screen.getByRole("button", { name: "Continue to quote with Grid Planner" })).toBeInTheDocument();
  });

  it("sends the full conversation history on the second turn", async () => {
    const secondReply: ConciergeReply = { ...FULL_REPLY, message: "Adjusted the range.", steps: [] };
    const fetcher = vi.fn();
    fetcher.mockImplementationOnce(async () => jsonResponse(FULL_REPLY));
    fetcher.mockImplementationOnce(async () => jsonResponse(secondReply));
    vi.stubGlobal("fetch", fetcher);
    render(<ConciergeChat />);

    await typeAndAsk("Quiero un grid en BNB/USDT");
    await screen.findByText(FULL_REPLY.message);

    await typeAndAsk("Baja el rango a 480");
    await screen.findByText("Adjusted the range.");

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetcher.mock.calls[1]!;
    expect(JSON.parse(String(secondInit!.body))).toEqual({
      schemaVersion: 1,
      messages: [
        { role: "user", content: "Quiero un grid en BNB/USDT" },
        { role: "assistant", content: FULL_REPLY.message },
        { role: "user", content: "Baja el rango a 480" },
      ],
    });
  });

  it("stores the concierge hand-off with the edited brief and navigates to the quote panel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(FULL_REPLY)));
    render(<ConciergeChat />);

    await typeAndAsk("Quiero un grid en BNB/USDT");
    await screen.findByText(FULL_REPLY.message);

    fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "Run a tighter grid" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to quote with Grid Planner" }));

    expect(routerPush).toHaveBeenCalledWith("/hire/303779#quote-request");
    const stored = JSON.parse(window.sessionStorage.getItem("concierge:303779") ?? "null");
    expect(stored).toMatchObject({
      schemaVersion: 1,
      agentId: "303779",
      contractHash: CONTRACT_HASH,
      parameters: FULL_REPLY.proposal!.parameters,
      brief: {
        objective: "Run a tighter grid",
        deliverable: FULL_REPLY.brief!.deliverable,
        acceptanceCriteria: FULL_REPLY.brief!.acceptanceCriteria,
      },
    });
    expect(typeof stored.savedAt).toBe("number");
  });

  it("shows the busy message using the retry-after header on a 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "5" } })));
    render(<ConciergeChat />);

    await typeAndAsk("Quiero un grid en BNB/USDT");
    await screen.findByText("The concierge is busy. Try again in 5 s.");
  });

  it("shows the offline message on a 503", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    render(<ConciergeChat />);

    await typeAndAsk("Quiero un grid en BNB/USDT");
    await screen.findByText("The concierge is offline right now.");
  });

  it("shows the generic error copy for any other failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    render(<ConciergeChat />);

    await typeAndAsk("Quiero un grid en BNB/USDT");
    await screen.findByText("The concierge could not answer. Try again.");
  });

  it("auto-sends the initial prompt once on mount", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ ...FULL_REPLY, brief: null, agents: [], proposal: null, steps: [] })
    );
    vi.stubGlobal("fetch", fetcher);
    render(<ConciergeChat initialPrompt="Grid on BNB/USDT between 500 and 700" />);

    await screen.findByText(FULL_REPLY.message);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0]!;
    expect(JSON.parse(String(init!.body))).toEqual({
      schemaVersion: 1,
      messages: [{ role: "user", content: "Grid on BNB/USDT between 500 and 700" }],
    });
  });

  it("has no accessibility violations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(FULL_REPLY)));
    // Wrapped in <main> because axe's landmark-coverage rule expects the
    // page shell this component is always mounted inside; the component
    // itself only owns the sub-landmarks it renders.
    render(createElement("main", {}, createElement(ConciergeChat)));

    await typeAndAsk("Quiero un grid en BNB/USDT");
    await screen.findByText(FULL_REPLY.message);

    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("never renders banned marketing copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(FULL_REPLY)));
    render(<ConciergeChat />);

    await typeAndAsk("Quiero un grid en BNB/USDT");
    await screen.findByText(FULL_REPLY.message);

    expect(document.body.textContent ?? "").not.toMatch(/proven|track record/i);
  });

  it("saves a null brief instead of dropping the parameters when a brief field is edited past the shared limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(FULL_REPLY)));
    render(<ConciergeChat />);

    await typeAndAsk("Quiero un grid en BNB/USDT");
    await screen.findByText(FULL_REPLY.message);

    expect(screen.getByLabelText("Objective")).toHaveAttribute("maxlength", String(CONCIERGE_LIMITS.briefChars));

    // Bypasses the native maxlength clamp the way a paste into an
    // uncontrolled DOM value could, so the JS-side guard is what's on test.
    fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "a".repeat(CONCIERGE_LIMITS.briefChars + 1) } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to quote with Grid Planner" }));

    expect(routerPush).toHaveBeenCalledWith("/hire/303779#quote-request");
    const stored = JSON.parse(window.sessionStorage.getItem("concierge:303779") ?? "null");
    expect(stored.brief).toBeNull();
    // The parameters must survive even though the brief was dropped — this
    // is what breaks if takeConciergeHandoff ever receives an over-limit
    // brief instead of null and rejects the whole hand-off.
    expect(stored.parameters).toEqual(FULL_REPLY.proposal!.parameters);
  });

  it("rolls back the optimistic user turn on a failed request so the next send stays alternating", async () => {
    const fetcher = vi.fn();
    fetcher.mockImplementationOnce(async () => new Response(null, { status: 429, headers: { "retry-after": "1" } }));
    fetcher.mockImplementationOnce(async () => jsonResponse({ ...FULL_REPLY, message: "Recovered." }));
    vi.stubGlobal("fetch", fetcher);
    render(<ConciergeChat />);

    await typeAndAsk("Quiero un grid en BNB/USDT");
    await screen.findByText("The concierge is busy. Try again in 1 s.");

    // A message the route would reject (two consecutive "user" turns) would
    // never reach the model, so the fix is proven by this second send
    // succeeding with a single-user-message body, not by a UI assertion.
    await typeAndAsk("Quiero un grid en BNB/USDT");
    await screen.findByText("Recovered.");

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetcher.mock.calls[1]!;
    expect(JSON.parse(String(secondInit!.body))).toEqual({
      schemaVersion: 1,
      messages: [{ role: "user", content: "Quiero un grid en BNB/USDT" }],
    });
  });

  it("windows the conversation sent to the route to the shared message cap on a later turn", async () => {
    let callCount = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      callCount += 1;
      // A distinct message per turn, so each findByText below waits for its
      // own turn's round trip instead of matching an earlier turn's reply
      // that (with an identical message) would already be in the DOM.
      return jsonResponse({ ...FULL_REPLY, message: `Reply ${callCount}`, brief: null, agents: [], proposal: null, steps: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<ConciergeChat />);

    // Six round trips build a full local history of 12 messages (6 user, 6
    // assistant) — the largest even count parseConciergeMessages will ever
    // see, since it also requires the last turn to be "user".
    for (let turn = 1; turn <= 6; turn += 1) {
      await typeAndAsk(`Turn ${turn}`);
      await screen.findByText(`Reply ${turn}`);
    }
    expect(fetcher).toHaveBeenCalledTimes(6);

    // The 7th turn would push the full history to 13 messages; the client
    // must window it to the newest 11 (dropping the oldest user/assistant
    // pair) instead of letting the route's 400 (>12 messages) break the chat.
    await typeAndAsk("Turn 7");
    await screen.findByText("Reply 7");

    const [, seventhInit] = fetcher.mock.calls[6]!;
    const body = JSON.parse(String(seventhInit!.body));
    expect(body.messages).toHaveLength(CONCIERGE_LIMITS.messages - 1);
    expect(body.messages[0]).toEqual({ role: "user", content: "Turn 2" });
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Turn 7" });
  });

  it("recovers from React StrictMode aborting the initial /ask prompt instead of getting stuck on 'sending'", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(FULL_REPLY));
    vi.stubGlobal("fetch", fetcher);
    render(
      createElement(StrictMode, null, createElement(ConciergeChat, { initialPrompt: "Grid on BNB/USDT between 500 and 700" }))
    );

    // StrictMode's mount → cleanup → mount runs the effect (and its abort
    // cleanup) twice; the first attempt is cancelled, so the fix is that the
    // second one still lands instead of leaving the chat stuck on "sending".
    await screen.findByText(FULL_REPLY.message);
    await waitFor(() => expect(screen.queryByText("Asking the concierge…")).not.toBeInTheDocument());
    // "sending" would also disable the textarea (the "Ask" button is
    // separately gated on the draft being non-empty, which is unrelated here).
    expect(screen.getByLabelText("Message")).not.toBeDisabled();
    // Exactly one assistant turn, not one per StrictMode invocation.
    expect(screen.getAllByText(FULL_REPLY.message)).toHaveLength(1);
    // Confirms StrictMode's double-invoke actually happened in this
    // environment — without it this test would pass even without the fix.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
