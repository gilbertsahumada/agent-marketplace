import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarketplaceDataUnavailableError, MarketplaceRateLimitError } from "../src/business/errors/marketplace-errors.ts";

const conciergeApi = vi.hoisted(() => ({
  askConcierge: { execute: vi.fn() },
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

describe("concierge route controller", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-JSON content type before reading the body", async () => {
    const response = await route.POST(new Request("http://local/api/marketplace/concierge", {
      method: "POST",
      body: "plain",
    }));
    expect(response.status).toBe(400);
    expect(conciergeApi.askConcierge.execute).not.toHaveBeenCalled();
  });

  it("rejects an invalid JSON body", async () => {
    const response = await post("not json");
    expect(response.status).toBe(400);
    expect(conciergeApi.askConcierge.execute).not.toHaveBeenCalled();
  });

  it("rejects a body larger than 16 KiB", async () => {
    const response = await post({
      schemaVersion: 1,
      messages: [{ role: "user", content: "x".repeat(20_000) }],
    });
    expect(response.status).toBe(413);
    expect(conciergeApi.askConcierge.execute).not.toHaveBeenCalled();
  });

  it("rejects an unsupported schema version", async () => {
    const response = await post({ schemaVersion: 2, messages: [{ role: "user", content: "hi" }] });
    expect(response.status).toBe(400);
    expect(conciergeApi.askConcierge.execute).not.toHaveBeenCalled();
  });

  it("rejects invalid messages", async () => {
    const response = await post({ schemaVersion: 1, messages: [{ role: "assistant", content: "hi" }] });
    expect(response.status).toBe(400);
    expect(conciergeApi.askConcierge.execute).not.toHaveBeenCalled();
  });

  it("returns the concierge reply uncached and forwards the caller fingerprint", async () => {
    const reply = { schemaVersion: 1, message: "Here is what I found.", question: null, brief: null, agents: [], proposal: null, steps: [], model: "qwen-plus" };
    conciergeApi.askConcierge.execute.mockResolvedValue(reply);

    const response = await post(validBody());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(reply);
    expect(conciergeApi.askConcierge.execute).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "I need a grid bot for BNB/USDT" }],
      caller: "203.0.113.2|http://local",
    });
  });

  it("maps a rate limit error to 429 with retry-after", async () => {
    conciergeApi.askConcierge.execute.mockRejectedValue(new MarketplaceRateLimitError(12, "The concierge is temporarily at capacity"));

    const response = await post(validBody());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
  });

  it("maps a data-unavailable error to 503", async () => {
    conciergeApi.askConcierge.execute.mockRejectedValue(new MarketplaceDataUnavailableError("concierge model"));

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
