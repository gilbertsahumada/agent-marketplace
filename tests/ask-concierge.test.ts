import { APICallError, type LanguageModelV4Prompt, type LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { readUIMessageStream, simulateReadableStream, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import {
  AskConcierge,
  CONCIERGE_SYSTEM_PROMPT,
  CONCIERGE_TOOL_DESCRIPTIONS,
  LANGUAGE_REMINDER,
  STREAM_ERROR_COPY,
  type AskConciergeDependencies,
} from "../src/business/use-cases/ask-concierge.ts";
import { BANNED_COPY, CONCIERGE_LIMITS, type ConciergeUIMessage } from "../src/business/entities/concierge.ts";
import type { HireabilityStatus, MarketplaceAgent, MarketplaceAgentPage } from "../src/business/entities/marketplace-agent.ts";
import { MarketplaceDataUnavailableError, MarketplaceRateLimitError } from "../src/business/errors/marketplace-errors.ts";
import { gridSellerAgentCard } from "../src/business/policies/grid-seller-policy.ts";

// --- scripted model ---------------------------------------------------------

function usage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
}

interface ScriptedCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function toolCallsTurn(...calls: ScriptedCall[]): LanguageModelV4StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    ...calls.map((call): LanguageModelV4StreamPart => ({
      type: "tool-call",
      toolCallId: call.id,
      toolName: call.name,
      input: JSON.stringify(call.input),
    })),
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: usage() },
  ];
}

function textTurn(...deltas: string[]): LanguageModelV4StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    ...deltas.map((delta): LanguageModelV4StreamPart => ({ type: "text-delta", id: "t1", delta })),
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: usage() },
  ];
}

function scriptedModel(turns: LanguageModelV4StreamPart[][]): MockLanguageModelV4 {
  const queue = [...turns];
  return new MockLanguageModelV4({
    modelId: "scripted-model",
    doStream: async () => {
      const chunks = queue.shift();
      if (!chunks) throw new Error("scripted model exhausted");
      return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) };
    },
  });
}

/** The JSON a tool returned to the model, as seen in the prompt of a later call. */
function toolResult(prompt: LanguageModelV4Prompt, toolCallId: string): unknown {
  for (const message of prompt) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type === "tool-result" && part.toolCallId === toolCallId) {
        return part.output.type === "json" ? part.output.value : part.output;
      }
    }
  }
  return undefined;
}

function userTexts(prompt: LanguageModelV4Prompt): string[] {
  return prompt
    .filter((message) => message.role === "user")
    .map((message) => (typeof message.content === "string"
      ? message.content
      : message.content.map((part) => (part.type === "text" ? part.text : "")).join("")));
}

// --- marketplace fixtures ---------------------------------------------------

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

function passportFake() {
  return {
    schemaVersion: 1 as const,
    chainId: 56 as const,
    agentId: "1",
    name: "Grid Planner",
    operator: "third_party" as const,
    state: "verified" as never,
    evidenceSnapshotHash: "0x00" as `0x${string}`,
    generatedAt: "2026-09-01T00:00:00.000Z",
    attentionReasons: [],
    checks: {
      identity: { status: "pass" } as never,
      endpoint: { status: "pass" } as never,
      quote: { status: "pass", hireabilityStatus: "quote_verified" } as never,
      job: { status: "pass" } as never,
      hireActivity: { status: "pass" } as never,
    },
    trackRecord: {
      provenJobs: 1,
      sampleSize: 1,
      submittedJobs: 1,
      completedJobs: 1,
      latestJobId: null,
      latestCapturedAt: null,
      latestDurationSeconds: null,
      latestGasCostWei: null,
    },
    nextRequirements: [],
  };
}

function harness(model: MockLanguageModelV4, overrides: Partial<AskConciergeDependencies> = {}) {
  const release = vi.fn();
  const acquire = vi.fn(() => release);
  const concierge = new AskConcierge({
    model: () => ({ languageModel: model, name: "scripted-model" }),
    admission: { acquire },
    agents: { execute: async () => agentPage([agent1, agent2]) },
    passports: { execute: async () => passportFake() },
    negotiationInput: negotiationInputFake,
    ...overrides,
  });
  return { concierge, acquire, release };
}

const ask = (content: string) => ({ messages: [{ role: "user" as const, content }], caller: "test-caller" });

async function chunksOf(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

function streamedText(chunks: UIMessageChunk[]): string {
  return chunks.map((chunk) => (chunk.type === "text-delta" ? chunk.delta : "")).join("");
}

describe("AskConcierge", () => {
  it("completes search, quote input and propose with valid parameters", async () => {
    const model = scriptedModel([
      toolCallsTurn({ id: "c1", name: "search_agents", input: { q: "grid" } }),
      toolCallsTurn({ id: "c2", name: "get_quote_input", input: { agentId: "1" } }),
      toolCallsTurn({ id: "c3", name: "propose", input: { brief: validBrief, agentId: "1", parameters: validGridParameters } }),
      textTurn("Here is ", "a grid plan."),
    ]);
    const { concierge, acquire, release } = harness(model);

    const reply = await concierge.execute(ask("Quiero un grid en BNB/USDT entre 500 y 700"));

    expect(reply.message).toBe("Here is a grid plan.");
    expect(reply.proposal).toMatchObject({ agentId: "1", contractHash: "f".repeat(64), parameters: validGridParameters });
    expect(reply.proposal?.fields.map((field) => field.key)).toEqual(["pair", "lowerPrice", "upperPrice", "capital", "gridCount"]);
    expect(reply.brief).toEqual(validBrief);
    expect(reply.agents.map((card) => card.agentId)).toEqual(["1", "2"]);
    expect(reply.steps).toEqual([
      { tool: "search_agents", summary: "2 agents for “grid”" },
      { tool: "get_quote_input", summary: "quote input for 1" },
    ]);
    expect(reply.model).toBe("scripted-model");

    // Each model call sees the earlier tool results, and the step after
    // propose is text-only.
    expect(model.doStreamCalls).toHaveLength(4);
    expect(model.doStreamCalls[2]!.toolChoice).toEqual({ type: "auto" });
    expect(model.doStreamCalls[3]!.toolChoice).toEqual({ type: "none" });
    expect(toolResult(model.doStreamCalls[1]!.prompt, "c1")).toMatchObject({ label: "grid" });
    expect(toolResult(model.doStreamCalls[2]!.prompt, "c2")).toMatchObject({ agentId: "1" });
    // The model gets the compact propose summary, not the cards.
    expect(toolResult(model.doStreamCalls[3]!.prompt, "c3")).toEqual({
      ok: true,
      rejected: [],
      brief: true,
      proposal: { agentId: "1", fields: reply.proposal?.fields },
    });
    expect(acquire).toHaveBeenCalledWith("test-caller");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("streams the tool calls and their outputs as typed UI message parts", async () => {
    const model = scriptedModel([
      toolCallsTurn({ id: "c1", name: "search_agents", input: { q: "grid" } }),
      toolCallsTurn({ id: "c2", name: "get_quote_input", input: { agentId: "1" } }),
      toolCallsTurn({ id: "c3", name: "propose", input: { brief: validBrief, agentId: "1", parameters: validGridParameters } }),
      textTurn("Done."),
    ]);
    const { concierge } = harness(model);

    let last: ConciergeUIMessage | undefined;
    for await (const message of readUIMessageStream<ConciergeUIMessage>({ stream: concierge.stream(ask("grid")) })) {
      last = message;
    }

    const types = last!.parts.map((part) => part.type);
    expect(types).toContain("tool-search_agents");
    expect(types).toContain("tool-get_quote_input");
    expect(types).toContain("tool-propose");
    expect(types).toContain("text");
    const search = last!.parts.find((part) => part.type === "tool-search_agents");
    expect(search).toMatchObject({ state: "output-available", input: { q: "grid" }, output: { label: "grid" } });
    const propose = last!.parts.find((part) => part.type === "tool-propose");
    expect(propose).toMatchObject({ state: "output-available", output: { proposal: { agentId: "1" }, agents: [{ agentId: "1" }, { agentId: "2" }] } });
  });

  it("drops a proposal for an agent that no search returned", async () => {
    const model = scriptedModel([
      toolCallsTurn({ id: "c1", name: "search_agents", input: { q: "grid" } }),
      toolCallsTurn({ id: "c2", name: "propose", input: { brief: validBrief, agentId: "99", parameters: validGridParameters } }),
      textTurn("Reply."),
    ]);
    const { concierge } = harness(model);

    const reply = await concierge.execute(ask("grid"));

    expect(reply.proposal).toBeNull();
    expect(reply.brief).toEqual(validBrief);
    expect(reply.agents.map((card) => card.agentId)).toEqual(["1", "2"]);
    expect(toolResult(model.doStreamCalls[2]!.prompt, "c2")).toMatchObject({ ok: false, rejected: ["unknown_agent"] });
  });

  it("drops parameters that do not validate against the seller's schema", async () => {
    const model = scriptedModel([
      toolCallsTurn({ id: "c1", name: "search_agents", input: { q: "grid" } }),
      toolCallsTurn({ id: "c2", name: "get_quote_input", input: { agentId: "1" } }),
      toolCallsTurn({ id: "c3", name: "propose", input: { brief: validBrief, agentId: "1", parameters: { ...validGridParameters, gridCount: 500 } } }),
      textTurn("Reply."),
    ]);
    const { concierge } = harness(model);

    const reply = await concierge.execute(ask("grid"));

    expect(reply.proposal).toBeNull();
    expect(reply.brief).toEqual(validBrief);
    expect(toolResult(model.doStreamCalls[3]!.prompt, "c3")).toMatchObject({ rejected: ["invalid_parameters"] });
  });

  it("requires get_quote_input before parameters are accepted", async () => {
    const model = scriptedModel([
      toolCallsTurn({ id: "c1", name: "search_agents", input: { q: "grid" } }),
      toolCallsTurn({ id: "c2", name: "propose", input: { agentId: "1", parameters: validGridParameters } }),
      textTurn("Reply."),
    ]);
    const { concierge } = harness(model);

    const reply = await concierge.execute(ask("grid"));

    expect(reply.proposal).toBeNull();
    expect(toolResult(model.doStreamCalls[2]!.prompt, "c2")).toMatchObject({ rejected: ["missing_quote_input"] });
  });

  it("refuses passports and quote input for agents outside the search results", async () => {
    const model = scriptedModel([
      toolCallsTurn({ id: "c1", name: "get_passport", input: { agentId: "1" } }, { id: "c2", name: "get_quote_input", input: { agentId: "1" } }),
      textTurn("Reply."),
    ]);
    const { concierge } = harness(model);

    await concierge.execute(ask("grid"));

    expect(toolResult(model.doStreamCalls[1]!.prompt, "c1")).toEqual({ error: "UNKNOWN_AGENT" });
    expect(toolResult(model.doStreamCalls[1]!.prompt, "c2")).toEqual({ error: "UNKNOWN_AGENT" });
  });

  it("reads a passport only after a search returned the agent", async () => {
    const model = scriptedModel([
      toolCallsTurn({ id: "c1", name: "search_agents", input: { category: "grid_trading" } }),
      toolCallsTurn({ id: "c2", name: "get_passport", input: { agentId: "1" } }),
      textTurn("Reply."),
    ]);
    const { concierge } = harness(model);

    const reply = await concierge.execute(ask("grid"));

    expect(toolResult(model.doStreamCalls[2]!.prompt, "c2")).toMatchObject({ agentId: "1", provenJobs: 1, checks: { quote: { status: "pass" } } });
    expect(reply.steps).toEqual([
      { tool: "search_agents", summary: "2 agents for “grid_trading”" },
      { tool: "get_passport", summary: "passport for 1" },
    ]);
  });

  it("returns plain text when the model answers without tools", async () => {
    const model = scriptedModel([textTurn("The marketplace covers grid trading and DeFi monitoring.")]);
    const { concierge } = harness(model);

    const reply = await concierge.execute(ask("plan my holiday"));

    expect(reply).toMatchObject({ message: "The marketplace covers grid trading and DeFi monitoring.", brief: null, proposal: null, agents: [], steps: [] });
  });

  it("forces the last step to plain text so the turn always ends in a reply", async () => {
    const searching = (index: number) => toolCallsTurn({ id: `s${index}`, name: "search_agents", input: { q: "grid" } });
    const model = scriptedModel([searching(1), searching(2), searching(3), searching(4), textTurn("Final.")]);
    const { concierge } = harness(model);

    const reply = await concierge.execute(ask("grid"));

    expect(reply.message).toBe("Final.");
    expect(model.doStreamCalls).toHaveLength(CONCIERGE_LIMITS.modelSteps);
    expect(model.doStreamCalls[0]!.toolChoice).toEqual({ type: "auto" });
    expect(model.doStreamCalls[CONCIERGE_LIMITS.modelSteps - 1]!.toolChoice).toEqual({ type: "none" });
  });

  it("caps catalog lookups per request", async () => {
    const calls = Array.from({ length: CONCIERGE_LIMITS.toolCalls + 1 }, (_, index) => ({ id: `c${index}`, name: "search_agents", input: { q: "grid" } }));
    const model = scriptedModel([toolCallsTurn(...calls), textTurn("Reply.")]);
    const { concierge } = harness(model);

    await concierge.execute(ask("grid"));

    const prompt = model.doStreamCalls[1]!.prompt;
    expect(toolResult(prompt, `c${CONCIERGE_LIMITS.toolCalls - 1}`)).toMatchObject({ label: "grid" });
    expect(toolResult(prompt, `c${CONCIERGE_LIMITS.toolCalls}`)).toEqual({ error: "TOOL_BUDGET_EXCEEDED" });
  });

  it("rewrites banned marketing copy in the streamed text, even when a phrase spans two deltas", async () => {
    const model = scriptedModel([
      textTurn("This agent has a proven track ", "record and guarantees results; the strategy was applied last week.", " Nothing else to add here."),
    ]);
    const { concierge } = harness(model);

    const reply = await concierge.execute(ask("grid"));

    expect(reply.message).not.toMatch(BANNED_COPY);
    expect(reply.message).toBe("This agent has a indexed activity history and promises results; the strategy was used last week. Nothing else to add here.");
  });

  it("propagates admission rejections without calling the model", async () => {
    const model = scriptedModel([textTurn("never")]);
    const { concierge } = harness(model, {
      admission: {
        acquire: () => {
          throw new MarketplaceRateLimitError(9, "The concierge is temporarily at capacity");
        },
      },
    });

    expect(() => concierge.stream(ask("grid"))).toThrow(MarketplaceRateLimitError);
    await expect(concierge.execute(ask("grid"))).rejects.toBeInstanceOf(MarketplaceRateLimitError);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("releases admission and reports unavailability when the model fails", async () => {
    const model = new MockLanguageModelV4({
      modelId: "broken",
      doStream: async () => {
        throw new Error("upstream exploded");
      },
    });
    const { concierge, release } = harness(model);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(concierge.execute(ask("grid"))).rejects.toBeInstanceOf(MarketplaceDataUnavailableError);

    expect(release).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
    expect(String(consoleError.mock.calls[0])).not.toContain("upstream exploded");
    consoleError.mockRestore();
  });

  it("fails fast when the model is not configured", async () => {
    const { concierge, acquire } = harness(scriptedModel([]), {
      model: () => {
        throw new MarketplaceDataUnavailableError("concierge model");
      },
    });

    expect(() => concierge.stream(ask("grid"))).toThrow(MarketplaceDataUnavailableError);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("sends the system prompt, the tool descriptions and a language reminder on the latest user turn only", async () => {
    const model = scriptedModel([textTurn("Reply.")]);
    const { concierge } = harness(model);

    await concierge.execute({
      messages: [
        { role: "user", content: "Quiero un grid" },
        { role: "assistant", content: "¿En qué par?" },
        { role: "user", content: "BNB/USDT please" },
      ],
      caller: "test-caller",
    });

    const call = model.doStreamCalls[0]!;
    expect(call.prompt[0]).toEqual({ role: "system", content: CONCIERGE_SYSTEM_PROMPT });
    const texts = userTexts(call.prompt);
    expect(texts[0]).toBe("Quiero un grid");
    expect(texts[1]).toBe(`BNB/USDT please${LANGUAGE_REMINDER}`);
    const toolNames = (call.tools ?? []).map((definition) => definition.name);
    expect(toolNames).toEqual(["search_agents", "get_passport", "get_quote_input", "propose"]);
    const propose = (call.tools ?? []).find((definition) => definition.name === "propose");
    expect(propose).toMatchObject({ description: CONCIERGE_TOOL_DESCRIPTIONS.propose });
  });

  it("keeps the system prompt free of banned copy outside the prohibition sentence", () => {
    expect(CONCIERGE_SYSTEM_PROMPT).toContain("propose");
    expect(CONCIERGE_SYSTEM_PROMPT).toContain("search_agents");
    expect(CONCIERGE_SYSTEM_PROMPT).toContain("Never");
    const withoutProhibition = CONCIERGE_SYSTEM_PROMPT.replace("Never use the words proven, track record or guarantee.", "");
    expect(withoutProhibition).not.toMatch(BANNED_COPY);
  });

  // --- review findings (PR #116) ------------------------------------------

  it("filters a banned phrase when every word is its own delta", async () => {
    const sentence = "The agent shows a track record of many grid jobs run on chain.";
    const deltas = sentence.split(" ").map((word, index, all) => (index < all.length - 1 ? `${word} ` : word));
    const { concierge } = harness(scriptedModel([textTurn(...deltas)]));

    const text = streamedText(await chunksOf(concierge.stream(ask("grid"))));

    expect(text).not.toMatch(BANNED_COPY);
    expect(text).toContain("activity history");
  });

  it("filters a banned phrase followed by a long unbroken token", async () => {
    const { concierge } = harness(scriptedModel([
      textTurn("This agent has a ", "track ", "record ", "https://example.com/hire/303779/evidence-passport ", "and more."),
    ]));

    const text = streamedText(await chunksOf(concierge.stream(ask("grid"))));

    expect(text).not.toMatch(BANNED_COPY);
    expect(text).toContain("https://example.com/hire/303779/evidence-passport");
  });

  it("tells the user when the deadline expires instead of ending in silence", async () => {
    const model = new MockLanguageModelV4({
      modelId: "slow",
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "t1" });
            abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
          },
        }),
      }),
    });
    const { concierge, release } = harness(model, { deadlineMs: 50 });

    const chunks = await chunksOf(concierge.stream(ask("grid")));

    expect(chunks.at(-1)).toEqual({ type: "error", errorText: STREAM_ERROR_COPY.timeout });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("lets the model retry propose after a rejection while budget remains", async () => {
    const bad = { ...validGridParameters, gridCount: "20" };
    const model = scriptedModel([
      toolCallsTurn({ id: "c1", name: "search_agents", input: { q: "grid" } }),
      toolCallsTurn({ id: "c2", name: "get_quote_input", input: { agentId: "1" } }),
      toolCallsTurn({ id: "c3", name: "propose", input: { brief: validBrief, agentId: "1", parameters: bad } }),
      toolCallsTurn({ id: "c4", name: "propose", input: { brief: validBrief, agentId: "1", parameters: validGridParameters } }),
      textTurn("Done."),
    ]);
    const { concierge } = harness(model);

    const reply = await concierge.execute(ask("grid"));

    expect(toolResult(model.doStreamCalls[3]!.prompt, "c3")).toMatchObject({ ok: false, rejected: ["invalid_parameters"] });
    // A rejected propose leaves the tools open; an accepted one closes them.
    expect(model.doStreamCalls[3]!.toolChoice).toEqual({ type: "auto" });
    expect(model.doStreamCalls[4]!.toolChoice).toEqual({ type: "none" });
    expect(reply.proposal?.parameters).toEqual(validGridParameters);
  });

  it("lets propose see a contract fetched by a sibling get_quote_input in the same step", async () => {
    const model = scriptedModel([
      toolCallsTurn({ id: "c1", name: "search_agents", input: { q: "grid" } }),
      toolCallsTurn(
        { id: "c2", name: "get_quote_input", input: { agentId: "1" } },
        { id: "c3", name: "propose", input: { brief: validBrief, agentId: "1", parameters: validGridParameters } },
      ),
      textTurn("Done."),
    ]);
    const { concierge } = harness(model, {
      negotiationInput: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return negotiationInputFake();
      },
    });

    const reply = await concierge.execute(ask("grid"));

    expect(reply.proposal?.parameters).toEqual(validGridParameters);
    expect(toolResult(model.doStreamCalls[2]!.prompt, "c3")).toMatchObject({ ok: true, rejected: [] });
  });

  it("maps a rate-limited upstream to the capacity copy after the retry", async () => {
    const model = new MockLanguageModelV4({
      modelId: "busy",
      doStream: async () => {
        throw new APICallError({
          message: "rate limited",
          url: "https://model.example/v1/chat/completions",
          requestBodyValues: {},
          statusCode: 429,
          isRetryable: true,
          responseHeaders: { "retry-after-ms": "0" },
        });
      },
    });
    const { concierge } = harness(model);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const chunks = await chunksOf(concierge.stream(ask("grid")));

    consoleError.mockRestore();
    expect(model.doStreamCalls.length).toBeGreaterThanOrEqual(2);
    expect(chunks.at(-1)).toEqual({ type: "error", errorText: STREAM_ERROR_COPY.capacity });
  });

  it("takes admission under the admission key when the route provides one", async () => {
    const { concierge, acquire } = harness(scriptedModel([textTurn("Hi.")]));

    await concierge.execute({ ...ask("grid"), admissionKey: "203.0.113.2" });

    expect(acquire).toHaveBeenCalledWith("203.0.113.2");
  });

  it("rewrites banned copy inside a model-authored brief", async () => {
    const dirty = {
      objective: "Hire a bot with a proven track record",
      deliverable: "A plan that guarantees 5% yield",
      acceptanceCriteria: "Strategy applied daily",
    };
    const model = scriptedModel([
      toolCallsTurn({ id: "c1", name: "search_agents", input: { q: "grid" } }),
      toolCallsTurn({ id: "c2", name: "propose", input: { brief: dirty } }),
      textTurn("Which range?"),
    ]);
    const { concierge } = harness(model);

    const reply = await concierge.execute(ask("grid"));

    expect(reply.brief).not.toBeNull();
    for (const value of Object.values(reply.brief!)) expect(value).not.toMatch(BANNED_COPY);
    expect(reply.brief!.objective).toBe("Hire a bot with a indexed activity history");
  });

  it("does not forward reasoning parts to the client", async () => {
    const model = scriptedModel([[
      { type: "stream-start", warnings: [] },
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "The rules say never use proven." },
      { type: "reasoning-end", id: "r1" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Reply." },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: usage() },
    ]]);
    const { concierge } = harness(model);

    const chunks = await chunksOf(concierge.stream(ask("grid")));

    expect(chunks.some((chunk) => chunk.type.startsWith("reasoning"))).toBe(false);
    expect(streamedText(chunks)).toBe("Reply.");
  });

  it("streams unbroken CJK text before the block ends", async () => {
    const reply = "我们为您找到了一个网格交易代理，它会在您设定的价格区间内自动挂单并持续运行，直到您停止它为止。价格和交付时间由签署的报价决定，托管账户保管您的资金。";
    const { concierge } = harness(scriptedModel([textTurn(reply)]));

    const chunks = await chunksOf(concierge.stream(ask("网格")));

    const deltas = chunks.filter((chunk) => chunk.type === "text-delta");
    const textEnd = chunks.findIndex((chunk) => chunk.type === "text-end");
    // At least one delta reaches the client before the block closes.
    expect(chunks.findIndex((chunk) => chunk.type === "text-delta")).toBeLessThan(textEnd);
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    expect(streamedText(chunks)).toBe(reply);
  });
});
