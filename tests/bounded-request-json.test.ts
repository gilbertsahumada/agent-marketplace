import { describe, expect, it } from "vitest";
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
});
