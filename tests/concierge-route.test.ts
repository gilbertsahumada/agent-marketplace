import type { UIMessageChunk } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarketplaceDataUnavailableError, MarketplaceRateLimitError } from "../src/business/errors/marketplace-errors.ts";

const conciergeApi = vi.hoisted(() => ({
  askConcierge: { stream: vi.fn() },
}));

vi.mock("@/src/business/composition", () => conciergeApi);

const route = await import("../app/api/marketplace/concierge/route.ts");

const validBody = () => ({
  schemaVersion: 1,
  messages: [{ role: "user", content: "I need a grid bot for BNB/USDT" }],
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  route.POST(new Request("http://local/api/marketplace/concierge", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://local", "x-forwarded-for": "203.0.113.2", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

function chunkStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("concierge route controller", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-JSON content type before reading the body", async () => {
    const response = await route.POST(new Request("http://local/api/marketplace/concierge", {
      method: "POST",
      body: "plain",
    }));
    expect(response.status).toBe(400);
    expect(conciergeApi.askConcierge.stream).not.toHaveBeenCalled();
  });

  it("rejects an invalid JSON body", async () => {
    const response = await post("not json");
    expect(response.status).toBe(400);
    expect(conciergeApi.askConcierge.stream).not.toHaveBeenCalled();
  });

  it("rejects a body larger than 64 KiB", async () => {
    const response = await post({
      schemaVersion: 1,
      messages: [{ role: "user", content: "x".repeat(70_000) }],
    });
    expect(response.status).toBe(413);
    expect(conciergeApi.askConcierge.stream).not.toHaveBeenCalled();
  });

  it("rejects an unsupported schema version", async () => {
    const response = await post({ schemaVersion: 2, messages: [{ role: "user", content: "hi" }] });
    expect(response.status).toBe(400);
    expect(conciergeApi.askConcierge.stream).not.toHaveBeenCalled();
  });

  it("rejects invalid messages", async () => {
    const response = await post({ schemaVersion: 1, messages: [{ role: "assistant", content: "hi" }] });
    expect(response.status).toBe(400);
    expect(conciergeApi.askConcierge.stream).not.toHaveBeenCalled();
  });

  it("streams the concierge turn as an uncached UI message stream and forwards the caller fingerprint", async () => {
    conciergeApi.askConcierge.stream.mockReturnValue(chunkStream([
      { type: "start" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Here is what I found." },
      { type: "text-end", id: "t1" },
      { type: "finish" },
    ]));

    const response = await post(validBody());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    const body = await response.text();
    expect(body).toContain('"type":"text-delta"');
    expect(body).toContain("Here is what I found.");
    expect(conciergeApi.askConcierge.stream).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: "user", content: "I need a grid bot for BNB/USDT" }],
      caller: "203.0.113.2|http://local",
      abortSignal: expect.any(AbortSignal),
    }));
  });

  it("maps a rate limit error to 429 with retry-after", async () => {
    conciergeApi.askConcierge.stream.mockImplementation(() => {
      throw new MarketplaceRateLimitError(12, "The concierge is temporarily at capacity");
    });

    const response = await post(validBody());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
  });

  it("maps a data-unavailable error to 503", async () => {
    conciergeApi.askConcierge.stream.mockImplementation(() => {
      throw new MarketplaceDataUnavailableError("concierge model");
    });

    const response = await post(validBody());

    expect(response.status).toBe(503);
  });

  it("rejects GET with 405 and an allow header", async () => {
    const response = await route.GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toEqual({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } });
  });
});
