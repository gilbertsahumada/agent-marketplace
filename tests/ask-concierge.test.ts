import { describe, expect, it, vi } from "vitest";
import { AskConcierge, CONCIERGE_SYSTEM_PROMPT, CONCIERGE_TOOLS, LANGUAGE_REMINDER } from "../src/business/use-cases/ask-concierge.ts";
import {
  BANNED_COPY,
  type ConciergeModel,
  type ModelChatMessage,
  type ModelToolCall,
  type ModelToolDefinition,
  type ModelTurn,
} from "../src/business/entities/concierge.ts";
import type { HireabilityStatus, MarketplaceAgent, MarketplaceAgentPage } from "../src/business/entities/marketplace-agent.ts";
import { MarketplaceRateLimitError } from "../src/business/errors/marketplace-errors.ts";
import { gridSellerAgentCard } from "../src/business/policies/grid-seller-policy.ts";

// Records every call.complete() receives so tests can assert what the model
// was shown (tool results, forced propose) without a real network call.
class ScriptedModel implements ConciergeModel {
  readonly name = "scripted-model";
  readonly calls: Array<{ messages: ModelChatMessage[]; tools: ModelToolDefinition[]; forceTool?: string }> = [];
  private readonly queue: ModelTurn[];

  constructor(turns: ModelTurn[]) {
    this.queue = [...turns];
  }

  async complete(input: { messages: ModelChatMessage[]; tools: ModelToolDefinition[]; forceTool?: string }): Promise<ModelTurn> {
    this.calls.push(input);
    const turn = this.queue.shift();
    if (!turn) throw new Error("ScriptedModel queue exhausted");
    return turn;
  }
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ModelToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}
function toolCallsTurn(...calls: ModelToolCall[]): ModelTurn {
  return { kind: "tool_calls", text: null, calls };
}
function textTurn(text: string): ModelTurn {
  return { kind: "text", text };
}
function toolContent(turnMessages: ModelChatMessage[] | undefined, toolCallId: string): unknown {
  const message = turnMessages?.find((entry) => entry.role === "tool" && entry.toolCallId === toolCallId);
  return message && message.role === "tool" ? JSON.parse(message.content) : undefined;
}

function evidenceRecord(kind: "declared" | "observed" | "onchain" | "derived", note: string) {
  return { kind, source: "marketplace-inventory" as const, observedAt: "2026-09-01T00:00:00.000Z", verifiedDirectly: false, note };
}

function marketplaceAgent(options: {
  agentId: string;
  name: string;
  description?: string | null;
  hireability: { status: HireabilityStatus; canHire: boolean };
}): MarketplaceAgent {
  return {
    chainId: 56,
    agentId: options.agentId,
    name: options.name,
    description: options.description ?? null,
    owner: null,
    metadataUri: null,
    operator: "third_party",
    indexedIdentity: { owner: null, metadataUri: null, evidence: evidenceRecord("declared", "Declared identity.") },
    onchainIdentity: {
      status: "not_requested",
      owner: null,
      agentWallet: null,
      metadataUri: null,
      registryAddress: null,
      blockNumber: null,
      observedAt: null,
      checks: { ownerMatches: null, metadataUriMatches: null },
      error: null,
      evidence: null,
    },
    categoryEvaluation: "evaluated",
    categories: [{ category: "grid_trading", evidence: evidenceRecord("derived", "Curated category signal.") }],
    services: [],
    endpoints: [],
    tools: [],
    capabilities: [],
    endpointObservation: {
      status: "not_observed",
      protocol: null,
      endpoint: null,
      lastTestedAt: null,
      httpStatus: null,
      capabilitiesCount: 0,
      requiresAuth: null,
      error: null,
    },
    reputation: { totalFeedbacks: 0, averageScore: null, uniqueReviewers: null },
    trustScore: { total: null, tier: null, dimensions: {}, calculatedAt: null, expiresAt: null },
    hireability: {
      status: options.hireability.status,
      canHire: options.hireability.canHire,
      reason: options.hireability.canHire ? "Quote verified." : "No verified seller.",
      evidence: evidenceRecord("derived", "Hireability signal."),
    },
    freshness: { fetchedAt: "2026-09-01T00:00:00.000Z", metadataUpdatedAt: null, indexedUpdatedAt: null },
    catalogCoverage: "partial",
    provenance: {
      identity: evidenceRecord("declared", "Declared identity."),
      services: evidenceRecord("declared", "Declared services."),
      endpointObservation: evidenceRecord("observed", "No persisted observation."),
      reputation: evidenceRecord("declared", "Declared reputation."),
      trustScore: evidenceRecord("derived", "Calculated by trust8004."),
    },
  };
}

function agentPage(items: MarketplaceAgent[]): MarketplaceAgentPage {
  return {
    view: "marketplace",
    items,
    pagination: { page: 1, pageSize: items.length || 1, total: items.length, totalPages: 1 },
    categories: [],
    catalogCoverage: "partial",
    fetchedAt: "2026-09-01T00:00:00.000Z",
  };
}

const agent1 = marketplaceAgent({
  agentId: "1",
  name: "Grid Planner",
  description: "Computes deterministic Grid plans on BNB Chain.",
  hireability: { status: "quote_verified", canHire: true },
});
const agent2 = marketplaceAgent({
  agentId: "2",
  name: "Other Agent",
  hireability: { status: "mcp_only", canHire: false },
});

// The Grid seller's raw params: no `encoding` (defaults to prefixed-json) and
// an extra `skill` field; normalizeNegotiationContract accepts both.
const gridContractParams = gridSellerAgentCard("https://seller.example").capabilities.extensions![0]!.params;
async function negotiationInputFake() {
  return { status: 200, body: { contract: gridContractParams, endpointKey: "a".repeat(64), contractHash: "f".repeat(64) } };
}

const validGridParameters = { pair: "BNB/USDT", lowerPrice: "500", upperPrice: "700", capital: "1000", gridCount: 20 };
const validBrief = { objective: "Run a grid", deliverable: "A funded grid plan", acceptanceCriteria: "Matches the requested range" };

describe("AskConcierge", () => {
  it("completes search, quote input and propose with valid parameters (case 1)", async () => {
    const model = new ScriptedModel([
      toolCallsTurn(toolCall("c1", "search_agents", { q: "grid" })),
      toolCallsTurn(toolCall("c2", "get_quote_input", { agentId: "1" })),
      toolCallsTurn(toolCall("c3", "propose", {
        message: "Here is a grid plan.",
        brief: validBrief,
        agentId: "1",
        parameters: validGridParameters,
      })),
    ]);
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([agent1, agent2]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: negotiationInputFake,
    });

    const reply = await concierge.execute({
      messages: [{ role: "user", content: "I need a grid on BNB/USDT between 500 and 700" }],
      caller: "caller-1",
    });

    expect(reply.proposal?.fields).toHaveLength(5);
    expect(reply.agents[0]?.agentId).toBe("1");
    expect(reply.steps).toHaveLength(2);
    expect(model.calls).toHaveLength(3);
    expect(toolContent(model.calls[1]?.messages, "c1")).toEqual({ agents: [{
      agentId: "1", name: "Grid Planner", categories: ["grid_trading"], hireability: "quote_verified",
      canHire: true, summary: "Computes deterministic Grid plans on BNB Chain.", href: "/hire/1",
    }, {
      agentId: "2", name: "Other Agent", categories: ["grid_trading"], hireability: "mcp_only",
      canHire: false, summary: null, href: "/hire/2",
    }] });
    expect(toolContent(model.calls[2]?.messages, "c2")).toMatchObject({ taskDescriptionPrefix: "GRID_PLAN_V1:" });
  });

  it("discards the proposal when agentId was not seen, but keeps visited agents (case 2)", async () => {
    const model = new ScriptedModel([
      toolCallsTurn(toolCall("c1", "search_agents", { q: "grid" })),
      toolCallsTurn(toolCall("c2", "propose", {
        message: "Here is a plan.",
        agentId: "999",
        parameters: validGridParameters,
      })),
    ]);
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([agent1]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: async () => null,
    });

    const reply = await concierge.execute({ messages: [{ role: "user", content: "need a grid" }], caller: "c" });

    expect(reply.proposal).toBeNull();
    expect(reply.agents.map((card) => card.agentId)).toEqual(["1"]);
  });

  it("discards the proposal when parameters fail contract validation, but keeps the brief (case 3)", async () => {
    const model = new ScriptedModel([
      toolCallsTurn(toolCall("c1", "search_agents", { q: "grid" })),
      toolCallsTurn(toolCall("c2", "get_quote_input", { agentId: "1" })),
      toolCallsTurn(toolCall("c3", "propose", {
        message: "Here is a plan.",
        brief: validBrief,
        agentId: "1",
        parameters: { ...validGridParameters, gridCount: 500 },
      })),
    ]);
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([agent1]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: negotiationInputFake,
    });

    const reply = await concierge.execute({ messages: [{ role: "user", content: "need a grid" }], caller: "c" });

    expect(reply.proposal).toBeNull();
    expect(reply.brief).toEqual(validBrief);
  });

  it("rejects get_passport for an agent outside search_agents results (case 4)", async () => {
    const model = new ScriptedModel([
      toolCallsTurn(toolCall("c1", "get_passport", { agentId: "999" })),
      textTurn("I could not find that agent."),
    ]);
    const passportsExecute = vi.fn();
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([]) },
      passports: { execute: passportsExecute },
      negotiationInput: async () => null,
    });

    await concierge.execute({ messages: [{ role: "user", content: "tell me about agent 999" }], caller: "c" });

    expect(toolContent(model.calls[1]?.messages, "c1")).toEqual({ error: "UNKNOWN_AGENT" });
    expect(passportsExecute).not.toHaveBeenCalled();
  });

  it("returns the model's text reply directly when it never proposes (case 5)", async () => {
    const model = new ScriptedModel([textTurn("Hello, how can I help?")]);
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: async () => null,
    });

    const reply = await concierge.execute({ messages: [{ role: "user", content: "hi" }], caller: "c" });

    expect(reply.message).toBe("Hello, how can I help?");
    expect(reply.brief).toBeNull();
  });

  it("forces propose on the last of the 4 rounds and falls back when it still refuses (case 6)", async () => {
    const model = new ScriptedModel([
      toolCallsTurn(toolCall("c1", "search_agents", { q: "grid" })),
      toolCallsTurn(toolCall("c2", "search_agents", { q: "grid" })),
      toolCallsTurn(toolCall("c3", "search_agents", { q: "grid" })),
      textTurn("Still thinking."),
    ]);
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([agent1]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: async () => null,
    });

    const reply = await concierge.execute({ messages: [{ role: "user", content: "need a grid" }], caller: "c" });

    // At most `modelRounds` (4) model calls total, not modelRounds + 1: the
    // forced propose is folded into the last round instead of tacked on
    // afterwards, keeping worst-case latency inside the route's maxDuration.
    expect(model.calls).toHaveLength(4);
    expect(model.calls[3]?.forceTool).toBe("propose");
    expect(reply.message).toBe("I could not finish this request. Try again with more detail.");
  });

  it("stops before the round budget once the shared deadline has elapsed (case 6b)", async () => {
    const model = new ScriptedModel([
      toolCallsTurn(toolCall("c1", "search_agents", { q: "grid" })),
      toolCallsTurn(toolCall("c2", "search_agents", { q: "grid" })),
    ]);
    // now() is read once for `startedAt` and once per round's deadline
    // check: 0 (startedAt), 0 (round 0 check, within deadline), then 40s
    // (round 1 check, past the 35s deadline) so only round 0 ever runs.
    const clockReadings = [0, 0, 40_000];
    let clockIndex = 0;
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([agent1]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: async () => null,
      now: () => clockReadings[Math.min(clockIndex++, clockReadings.length - 1)]!,
    });

    const reply = await concierge.execute({ messages: [{ role: "user", content: "need a grid" }], caller: "c" });

    expect(model.calls).toHaveLength(1);
    expect(reply.message).toBe("I could not finish this request. Try again with more detail.");
  });

  it("rejects tool calls beyond the per-request budget (case 7)", async () => {
    const searchCalls = Array.from({ length: 7 }, (_, index) => toolCall(`c${index + 1}`, "search_agents", { q: "grid" }));
    const model = new ScriptedModel([
      toolCallsTurn(...searchCalls),
      textTurn("Done for now."),
    ]);
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([agent1]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: async () => null,
    });

    await concierge.execute({ messages: [{ role: "user", content: "need many things" }], caller: "c" });

    expect(toolContent(model.calls[1]?.messages, "c7")).toEqual({ error: "TOOL_BUDGET_EXCEEDED" });
    expect(toolContent(model.calls[1]?.messages, "c6")).not.toEqual({ error: "TOOL_BUDGET_EXCEEDED" });
  });

  it("accepts propose right after 6 lookups already spent the tool budget (case 7b)", async () => {
    // propose must never be budgeted like a lookup: 5 search_agents calls
    // plus one get_quote_input spend the full 6-call budget, and propose
    // still has to go through as the 7th call in the same turn.
    const lookupCalls = [
      ...Array.from({ length: 5 }, (_, index) => toolCall(`c${index + 1}`, "search_agents", { q: "grid" })),
      toolCall("c6", "get_quote_input", { agentId: "1" }),
    ];
    const model = new ScriptedModel([
      toolCallsTurn(...lookupCalls, toolCall("c7", "propose", {
        message: "Here is a grid plan.",
        brief: validBrief,
        agentId: "1",
        parameters: validGridParameters,
      })),
    ]);
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([agent1]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: negotiationInputFake,
    });

    const reply = await concierge.execute({ messages: [{ role: "user", content: "need a grid" }], caller: "c" });

    expect(model.calls).toHaveLength(1);
    expect(reply.proposal?.agentId).toBe("1");
    expect(reply.proposal?.fields).toHaveLength(5);
  });

  it("replaces banned copy in the message and clears a banned question (case 8)", async () => {
    const model = new ScriptedModel([
      toolCallsTurn(toolCall("c1", "propose", {
        message: "Our agents have a proven track record and guarantee results.",
        question: "Can you guarantee delivery?",
      })),
    ]);
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: async () => null,
    });

    const reply = await concierge.execute({ messages: [{ role: "user", content: "hi" }], caller: "c" });

    expect(reply.message).toBe("Here is what I found.");
    expect(reply.question).toBeNull();
  });

  it("lists only the fields the model set, keeps a banned search label out of steps and bounds the message (case 8b)", async () => {
    const gridSchema = (gridContractParams as { inputSchema: { properties: Record<string, unknown> } }).inputSchema;
    const optionalContract = {
      ...(gridContractParams as Record<string, unknown>),
      inputSchema: {
        ...gridSchema,
        required: ["pair"],
        properties: { ...gridSchema.properties, note: { type: "string", title: "Note", maxLength: 40 } },
      },
    };
    const model = new ScriptedModel([
      toolCallsTurn(toolCall("c1", "search_agents", { q: "a proven grid" })),
      toolCallsTurn(toolCall("c2", "get_quote_input", { agentId: "1" })),
      toolCallsTurn(toolCall("c3", "propose", {
        message: "x".repeat(4_500),
        agentId: "1",
        parameters: { pair: "BNB/USDT" },
      })),
    ]);
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([agent1]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: async () => ({ status: 200, body: { contract: optionalContract, endpointKey: "a".repeat(64), contractHash: "f".repeat(64) } }),
    });

    const reply = await concierge.execute({ messages: [{ role: "user", content: "grid" }], caller: "caller-1" });

    expect(reply.proposal?.fields).toEqual([{ key: "pair", title: "Trading pair", value: "BNB/USDT" }]);
    expect(reply.steps[0]?.summary).toBe("1 agents for “the request”");
    expect(reply.message).toHaveLength(4_000);
  });

  it("discards a proposal the quote panel could not encode (case 3b)", async () => {
    // A 1500-char string passes the schema but pushes task_description over
    // buildContractRequest's 1500-char bound once the prefix is added.
    const model = new ScriptedModel([
      toolCallsTurn(toolCall("c1", "search_agents", { q: "grid" })),
      toolCallsTurn(toolCall("c2", "get_quote_input", { agentId: "1" })),
      toolCallsTurn(toolCall("c3", "propose", { message: "Done.", agentId: "1", parameters: { text: "t".repeat(1_500) } })),
    ]);
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([agent1]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: async () => ({ status: 200, body: { contract: {
        ...gridContractParams,
        inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 1_500 } } },
      }, endpointKey: "a".repeat(64), contractHash: "f".repeat(64) } }),
    });

    const reply = await concierge.execute({ messages: [{ role: "user", content: "grid" }], caller: "caller-1" });

    expect(reply.proposal).toBeNull();
    expect(reply.agents).toHaveLength(1);
  });

  it("attaches the language reminder to the latest user turn only", async () => {
    const model = new ScriptedModel([textTurn("Sure.")]);
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => () => {} },
      agents: { execute: async () => agentPage([agent1]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: negotiationInputFake,
    });

    const reply = await concierge.execute({
      messages: [
        { role: "user", content: "Quiero un grid" },
        { role: "assistant", content: "Claro." },
        { role: "user", content: "is there any way to plan a trip?" },
      ],
      caller: "caller-1",
    });

    const prompt = model.calls[0]!.messages;
    expect(prompt[1]).toEqual({ role: "user", content: "Quiero un grid" });
    expect(prompt[3]).toEqual({ role: "user", content: `is there any way to plan a trip?${LANGUAGE_REMINDER}` });
    expect(reply.message).toBe("Sure.");
  });

  it("propagates an admission error without calling the model (case 9a)", async () => {
    const complete = vi.fn(async () => { throw new Error("must not be called"); });
    const model: ConciergeModel = { name: "guarded-model", complete };
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => { throw new MarketplaceRateLimitError(5); } },
      agents: { execute: async () => agentPage([]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: async () => null,
    });

    await expect(concierge.execute({ messages: [{ role: "user", content: "hi" }], caller: "c" }))
      .rejects.toBeInstanceOf(MarketplaceRateLimitError);
    expect(complete).not.toHaveBeenCalled();
  });

  it("releases admission even when the model rejects (case 9b)", async () => {
    const release = vi.fn();
    const model: ConciergeModel = { name: "broken-model", complete: async () => { throw new Error("model failed"); } };
    const concierge = new AskConcierge({
      model,
      admission: { acquire: () => release },
      agents: { execute: async () => agentPage([]) },
      passports: { execute: async () => { throw new Error("not used"); } },
      negotiationInput: async () => null,
    });

    await expect(concierge.execute({ messages: [{ role: "user", content: "hi" }], caller: "c" }))
      .rejects.toThrow("model failed");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("declares four tools with closed JSON-schema parameters", () => {
    expect(CONCIERGE_TOOLS.map((tool) => tool.name)).toEqual(["search_agents", "get_passport", "get_quote_input", "propose"]);
    for (const tool of CONCIERGE_TOOLS) {
      expect(tool.parameters).toMatchObject({ type: "object", additionalProperties: false });
    }
  });
});

describe("CONCIERGE_SYSTEM_PROMPT (case 10)", () => {
  it("names propose, search_agents and never, and bans copy words only in the prohibition sentence", () => {
    expect(CONCIERGE_SYSTEM_PROMPT).toContain("propose");
    expect(CONCIERGE_SYSTEM_PROMPT).toContain("search_agents");
    expect(CONCIERGE_SYSTEM_PROMPT).toContain("never");

    const prohibition = "Never use the words proven, track record or guarantee.";
    expect(CONCIERGE_SYSTEM_PROMPT).toContain(prohibition);

    const remainder = CONCIERGE_SYSTEM_PROMPT.replace(prohibition, "");
    expect(BANNED_COPY.test(remainder)).toBe(false);
  });
});
