import { beforeEach, describe, expect, it, vi } from "vitest";

const executeCard = vi.fn();
const executeMessage = vi.fn();
const executeDeliverable = vi.fn();

vi.mock("@/src/business/hosted-seller-composition", () => ({
  getHostedSellerAgentCard: { execute: executeCard },
  handleHostedSellerMessage: { execute: executeMessage },
  getHostedSellerDeliverable: { execute: executeDeliverable },
}));

const cardRoute = await import("../app/.well-known/agent-card.json/route.js");
const a2aRoute = await import("../app/api/fixtures/erc8183/a2a/route.js");
const responseRoute = await import(
  "../app/api/fixtures/erc8183/job/[jobId]/response/route.js"
);

function messageRequest(): Request {
  return new Request("https://seller.example/api/fixtures/erc8183/a2a", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "request-1",
      method: "message/send",
      params: {
        message: {
          parts: [{
            kind: "data",
            data: {
              skill: "negotiate-erc8183-job",
              task_description: "echo",
              terms: {},
            },
          }],
        },
      },
    }),
  });
}

describe("hosted seller thin controllers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes one use case per public endpoint", async () => {
    executeCard.mockResolvedValue({ name: "fixture" });
    executeMessage.mockResolvedValue({ accepted: true });
    executeDeliverable.mockResolvedValue({ success: true });
    expect((await cardRoute.GET()).status).toBe(200);
    expect((await a2aRoute.POST(messageRequest())).status).toBe(200);
    expect((await responseRoute.GET(new Request("https://seller.example"), {
      params: Promise.resolve({ jobId: "900" }),
    })).status).toBe(200);
    expect(executeCard).toHaveBeenCalledOnce();
    expect(executeMessage).toHaveBeenCalledOnce();
    expect(executeDeliverable).toHaveBeenCalledOnce();
  });

  it("rejects malformed A2A input before business", async () => {
    const response = await a2aRoute.POST(new Request("https://seller.example", {
      method: "POST",
      body: "not-json",
    }));
    expect(response.status).toBe(400);
    expect(executeMessage).not.toHaveBeenCalled();
  });

  it("does not expose secrets from infrastructure errors", async () => {
    executeCard.mockRejectedValue(
      new Error("SELLER_PRIVATE_KEY=0xdead /Users/alice/.env.local"),
    );
    const response = await cardRoute.GET();
    const serialized = JSON.stringify(await response.json());
    expect(response.status).toBe(500);
    expect(serialized).not.toMatch(/private|0xdead|Users|\.env/i);
  });
});
