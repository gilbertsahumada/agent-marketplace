import { describe, expect, it, vi } from "vitest";
import {
  CONCIERGE_DEFAULT_BASE_URL,
  CONCIERGE_DEFAULT_MODEL,
  isConciergeConfigured,
  OpenAiCompatibleModel,
} from "../src/data/llm/openai-compatible-model.ts";
import { MarketplaceDataUnavailableError, MarketplaceRateLimitError } from "../src/business/errors/marketplace-errors.ts";
import type { ModelChatMessage, ModelToolDefinition } from "../src/business/entities/concierge.ts";

const TOOLS: ModelToolDefinition[] = [
  { name: "search_agents", description: "Search agents", parameters: { type: "object", properties: {} } },
];

const MESSAGES: ModelChatMessage[] = [
  { role: "system", content: "You are the concierge." },
  { role: "user", content: "I need a grid trading bot." },
];

function textReply(content = "Sure, let me help.") {
  return Response.json({ choices: [{ message: { content } }] });
}

describe("isConciergeConfigured", () => {
  it("is true only when CONCIERGE_API_KEY is a non-empty string", () => {
    expect(isConciergeConfigured({ CONCIERGE_API_KEY: "sk-live" })).toBe(true);
    expect(isConciergeConfigured({ CONCIERGE_API_KEY: "  " })).toBe(false);
    expect(isConciergeConfigured({ CONCIERGE_API_KEY: "" })).toBe(false);
    expect(isConciergeConfigured({})).toBe(false);
  });
});

describe("OpenAiCompatibleModel", () => {
  it("sends the OpenAI-compatible request shape with defaults, tools, forced tool_choice and serialised history", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => textReply());
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    const history: ModelChatMessage[] = [
      ...MESSAGES,
      { role: "assistant", content: null, toolCalls: [{ id: "call_1", name: "search_agents", arguments: "{}" }] },
      { role: "tool", toolCallId: "call_1", content: "{\"agents\":[]}" },
    ];

    await model.complete({ messages: history, tools: TOOLS, forceTool: "propose" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`${CONCIERGE_DEFAULT_BASE_URL}/chat/completions`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ authorization: "Bearer sk-secret", "content-type": "application/json" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: CONCIERGE_DEFAULT_MODEL,
      temperature: 0.2,
      max_tokens: 1_500,
      stream: false,
      tool_choice: { type: "function", function: { name: "propose" } },
      tools: [{ type: "function", function: { name: "search_agents", description: "Search agents", parameters: { type: "object", properties: {} } } }],
    });
    expect(body.messages).toEqual([
      { role: "system", content: "You are the concierge." },
      { role: "user", content: "I need a grid trading bot." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "search_agents", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "{\"agents\":[]}" },
    ]);
  });

  it("defaults tool_choice to auto when forceTool is not given", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => textReply());
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    await model.complete({ messages: MESSAGES, tools: TOOLS });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.tool_choice).toBe("auto");
  });

  it("uses CONCIERGE_BASE_URL (stripped of a trailing slash) and CONCIERGE_MODEL when set", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => textReply());
    const model = new OpenAiCompatibleModel({
      env: { CONCIERGE_API_KEY: "sk-secret", CONCIERGE_BASE_URL: "https://api.deepseek.com/v1/", CONCIERGE_MODEL: "deepseek-chat" },
      fetchImpl,
    });

    await model.complete({ messages: MESSAGES, tools: TOOLS });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://api.deepseek.com/v1/chat/completions");
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.model).toBe("deepseek-chat");
    expect(model.name).toBe("deepseek-chat");
  });

  it("returns a text ModelTurn for a plain content reply", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => textReply("Here is what I found."));
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    await expect(model.complete({ messages: MESSAGES, tools: TOOLS })).resolves.toEqual({
      kind: "text",
      text: "Here is what I found.",
    });
  });

  it("returns a tool_calls ModelTurn, carrying along any accompanying text", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      choices: [{
        message: {
          content: "Looking that up.",
          tool_calls: [{ id: "call_9", type: "function", function: { name: "search_agents", arguments: "{\"q\":\"grid\"}" } }],
        },
      }],
    }));
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    await expect(model.complete({ messages: MESSAGES, tools: TOOLS })).resolves.toEqual({
      kind: "tool_calls",
      text: "Looking that up.",
      calls: [{ id: "call_9", name: "search_agents", arguments: "{\"q\":\"grid\"}" }],
    });
  });

  it("throws MarketplaceDataUnavailableError('concierge model') when no key is configured, without calling fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => textReply());
    const model = new OpenAiCompatibleModel({ env: {}, fetchImpl });

    const error = await model.complete({ messages: MESSAGES, tools: TOOLS }).catch((caught) => caught);
    expect(error).toBeInstanceOf(MarketplaceDataUnavailableError);
    expect((error as InstanceType<typeof MarketplaceDataUnavailableError>).operation).toBe("concierge model");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a blank CONCIERGE_API_KEY as not configured", async () => {
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "   " } });
    await expect(model.complete({ messages: MESSAGES, tools: TOOLS })).rejects.toBeInstanceOf(MarketplaceDataUnavailableError);
  });

  it("wraps a non-2xx upstream response as MarketplaceDataUnavailableError, without leaking response detail", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "server exploded" }), { status: 500 }));
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    const error = await model.complete({ messages: MESSAGES, tools: TOOLS }).catch((caught) => caught);
    expect(error).toBeInstanceOf(MarketplaceDataUnavailableError);
    expect(String((error as Error).message)).not.toContain("server exploded");
  });

  it("wraps an invalid JSON body as MarketplaceDataUnavailableError", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("not json", { status: 200, headers: { "content-type": "application/json" } }));
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    await expect(model.complete({ messages: MESSAGES, tools: TOOLS })).rejects.toBeInstanceOf(MarketplaceDataUnavailableError);
  });

  it("rejects a reply shaped as neither tool_calls nor string content", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: null } }] }));
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    await expect(model.complete({ messages: MESSAGES, tools: TOOLS })).rejects.toBeInstanceOf(MarketplaceDataUnavailableError);
  });

  it("rejects a malformed tool_calls entry (missing function.name)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      choices: [{ message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { arguments: "{}" } }] } }],
    }));
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    await expect(model.complete({ messages: MESSAGES, tools: TOOLS })).rejects.toBeInstanceOf(MarketplaceDataUnavailableError);
  });

  it("raises MarketplaceRateLimitError(retryAfterSeconds, ...) on a 429, defaulting retryAfter to 10 when the header is absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 429 }));
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    const error = await model.complete({ messages: MESSAGES, tools: TOOLS }).catch((caught) => caught);
    expect(error).toBeInstanceOf(MarketplaceRateLimitError);
    expect((error as InstanceType<typeof MarketplaceRateLimitError>).retryAfterSeconds).toBe(10);
    expect((error as Error).message).toBe("The concierge is temporarily at capacity");
  });

  it("honours a numeric retry-after header on 429", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 429, headers: { "retry-after": "42" } }));
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    const error = await model.complete({ messages: MESSAGES, tools: TOOLS }).catch((caught) => caught);
    expect(error).toBeInstanceOf(MarketplaceRateLimitError);
    expect((error as InstanceType<typeof MarketplaceRateLimitError>).retryAfterSeconds).toBe(42);
  });

  it("falls back to 10 seconds when retry-after is not a positive number", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 429, headers: { "retry-after": "not-a-number" } }));
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    const error = await model.complete({ messages: MESSAGES, tools: TOOLS }).catch((caught) => caught);
    expect((error as InstanceType<typeof MarketplaceRateLimitError>).retryAfterSeconds).toBe(10);
  });

  it("wraps an oversized response body as MarketplaceDataUnavailableError", async () => {
    const hugeContent = "x".repeat(300);
    const fetchImpl = vi.fn<typeof fetch>(async () => textReply(hugeContent));
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl, maxResponseBytes: 64 });

    await expect(model.complete({ messages: MESSAGES, tools: TOOLS })).rejects.toBeInstanceOf(MarketplaceDataUnavailableError);
  });

  it("rejects early via content-length without reading an oversized body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200, headers: { "content-length": "999999" } }));
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl, maxResponseBytes: 64 });

    await expect(model.complete({ messages: MESSAGES, tools: TOOLS })).rejects.toBeInstanceOf(MarketplaceDataUnavailableError);
  });

  it("wraps a timeout/abort from fetch as MarketplaceDataUnavailableError", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
      });
    });
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl, timeoutMs: 5 });

    await expect(model.complete({ messages: MESSAGES, tools: TOOLS })).rejects.toBeInstanceOf(MarketplaceDataUnavailableError);
  });

  it("wraps a raw network failure from fetch as MarketplaceDataUnavailableError, never leaking the key", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error("connect ECONNREFUSED sk-secret leak"); });
    const model = new OpenAiCompatibleModel({ env: { CONCIERGE_API_KEY: "sk-secret" }, fetchImpl });

    const error = await model.complete({ messages: MESSAGES, tools: TOOLS }).catch((caught) => caught);
    expect(error).toBeInstanceOf(MarketplaceDataUnavailableError);
    expect(String((error as Error).message)).not.toContain("sk-secret");
  });
});
