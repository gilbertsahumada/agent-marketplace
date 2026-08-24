import { describe, expect, it, vi } from "vitest";
import { readBoundedRequestJson } from "../src/presentation/http/bounded-request-json.js";
import { spikeJsonBody } from "../src/presentation/http/erc8183-spike-http.js";
import { parseHostedSellerRequest } from "../src/presentation/http/hosted-seller-http.js";

function oversizedStreamingRequest(url: string): { request: Request; canceled: () => boolean } {
  let chunk = 0;
  let wasCanceled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunk += 1;
      controller.enqueue(new Uint8Array(chunk === 1 ? 16 * 1_024 : 9 * 1_024).fill(0x20));
    },
    cancel() {
      wasCanceled = true;
    },
  });
  const request = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, canceled: () => wasCanceled };
}

describe("streaming HTTP request limits", () => {
  it("cancels an oversized spike body before parsing or unbounded buffering", async () => {
    const streamed = oversizedStreamingRequest("https://marketplace.example/api/quote");
    await expect(spikeJsonBody(streamed.request)).rejects.toThrow("Request body is too large");
    expect(streamed.canceled()).toBe(true);
  });

  it("cancels an oversized hosted-seller body before parsing or unbounded buffering", async () => {
    const streamed = oversizedStreamingRequest("https://marketplace.example/api/seller");
    await expect(parseHostedSellerRequest(streamed.request)).rejects.toThrow("Request body is too large");
    expect(streamed.canceled()).toBe(true);
  });

  it("cancels a stalled body at the explicit read deadline", async () => {
    let canceled = false;
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!pulled) {
          pulled = true;
          controller.enqueue(new TextEncoder().encode("{"));
        }
      },
      cancel() { canceled = true; },
    });
    const request = new Request("https://marketplace.example/api/quote", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedRequestJson(request, 24 * 1_024, 20))
      .rejects.toMatchObject({ code: "BODY_TIMEOUT", message: "Request body timed out" });
    expect(canceled).toBe(true);
  });

  it("clears the deadline timer after a successful read", async () => {
    vi.useFakeTimers();
    try {
      const request = new Request("https://marketplace.example/api/quote", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      });
      await expect(readBoundedRequestJson(request, 1_024)).resolves.toEqual({ ok: true });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
