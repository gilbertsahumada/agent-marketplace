import { generateText } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  CONCIERGE_DEFAULT_BASE_URL,
  CONCIERGE_DEFAULT_MODEL,
  createConciergeModel,
  isConciergeConfigured,
} from "../src/data/llm/concierge-model.ts";
import { MarketplaceDataUnavailableError } from "../src/business/errors/marketplace-errors.ts";

function chatCompletion(content: string): Response {
  return Response.json({
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

describe("createConciergeModel", () => {
  it("reports configuration from CONCIERGE_API_KEY only", () => {
    expect(isConciergeConfigured({})).toBe(false);
    expect(isConciergeConfigured({ CONCIERGE_API_KEY: "  " })).toBe(false);
    expect(isConciergeConfigured({ CONCIERGE_API_KEY: "sk-test" })).toBe(true);
  });

  it("throws the marketplace unavailability error without a key", () => {
    expect(() => createConciergeModel({ env: {} })).toThrow(MarketplaceDataUnavailableError);
  });

  it("defaults to DashScope with thinking disabled and sends the bearer key", async () => {
    const fetchImpl = vi.fn(async () => chatCompletion("hi"));
    const handle = createConciergeModel({ env: { CONCIERGE_API_KEY: "sk-test" }, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(handle.name).toBe(CONCIERGE_DEFAULT_MODEL);
    expect(handle.providerOptions).toEqual({ concierge: { enable_thinking: false } });

    await generateText({ model: handle.languageModel, prompt: "ping", providerOptions: handle.providerOptions });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${CONCIERGE_DEFAULT_BASE_URL}/chat/completions`);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-test");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe(CONCIERGE_DEFAULT_MODEL);
    expect(body.enable_thinking).toBe(false);
  });

  it("honours a custom host and model and leaves the DashScope flag out", async () => {
    const fetchImpl = vi.fn(async () => chatCompletion("hi"));
    const handle = createConciergeModel({
      env: { CONCIERGE_API_KEY: "sk-test", CONCIERGE_BASE_URL: "https://api.deepseek.com/v1/", CONCIERGE_MODEL: "deepseek-chat" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(handle.name).toBe("deepseek-chat");
    expect(handle.providerOptions).toEqual({});

    await generateText({ model: handle.languageModel, prompt: "ping", providerOptions: handle.providerOptions });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe("deepseek-chat");
    expect(body).not.toHaveProperty("enable_thinking");
  });
});
