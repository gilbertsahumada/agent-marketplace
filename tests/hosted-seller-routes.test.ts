import { beforeEach, describe, expect, it, vi } from "vitest";

const executeCard = vi.fn();
const executeMessage = vi.fn();
const executeDeliverable = vi.fn();
const requested: string[] = [];

vi.mock("@/src/mainnet/hosted-seller-composition", () => ({
  hostedSellerUseCases: (slug: string) => {
    requested.push(slug);
    return {
      getAgentCard: { execute: executeCard },
      handleMessage: { execute: executeMessage },
      getDeliverable: { execute: executeDeliverable },
    };
  },
}));

const a2aRoute = await import("../app/api/sellers/[seller]/a2a/route.ts");
const responseRoute = await import("../app/api/sellers/[seller]/job/[jobId]/response/route.ts");
const rebalanceCard = await import("../app/rebalance/.well-known/agent-card.json/route.ts");
const yieldCard = await import("../app/yield/.well-known/agent-card.json/route.ts");
const loanHealthCard = await import("../app/loan-health/.well-known/agent-card.json/route.ts");

function messageRequest(seller: string): Request {
  return new Request(`https://seller.example/api/sellers/${seller}/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "request-1",
      method: "message/send",
      params: { message: { parts: [{ kind: "data", data: { skill: "negotiate", task_description: "YIELD_PLAN_V1:{}", terms: {} } }] } },
    }),
  });
}

describe("hosted seller dynamic routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requested.length = 0;
  });

  it("serves one Agent Card route per additional seller", async () => {
    executeCard.mockResolvedValue({ name: "card" });
    expect((await rebalanceCard.GET()).status).toBe(200);
    expect((await yieldCard.GET()).status).toBe(200);
    expect((await loanHealthCard.GET()).status).toBe(200);
    expect(requested).toEqual(["rebalance", "yield", "loan-health"]);
  });

  it("dispatches messages and deliverables to the seller named in the path", async () => {
    executeMessage.mockResolvedValue({ accepted: true });
    executeDeliverable.mockResolvedValue({ success: true });
    const message = await a2aRoute.POST(messageRequest("yield"), { params: Promise.resolve({ seller: "yield" }) });
    expect(message.status).toBe(200);
    expect(executeMessage).toHaveBeenCalledWith({ skill: "negotiate", taskDescription: "YIELD_PLAN_V1:{}", terms: {} });
    const deliverable = await responseRoute.GET(new Request("https://seller.example"), { params: Promise.resolve({ seller: "loan-health", jobId: "7" }) });
    expect(deliverable.status).toBe(200);
    expect(executeDeliverable).toHaveBeenCalledWith({ jobId: "7" });
    expect(requested).toEqual(["yield", "loan-health"]);
  });

  it("answers 404 for unknown sellers and for the Grid seller, which keeps its own routes", async () => {
    for (const seller of ["swap", "grid", "GRID", ""]) {
      const message = await a2aRoute.POST(messageRequest(seller), { params: Promise.resolve({ seller }) });
      expect(message.status).toBe(404);
      const deliverable = await responseRoute.GET(new Request("https://seller.example"), { params: Promise.resolve({ seller, jobId: "1" }) });
      expect(deliverable.status).toBe(404);
    }
    expect(executeMessage).not.toHaveBeenCalled();
    expect(executeDeliverable).not.toHaveBeenCalled();
    expect(requested).toEqual([]);
  });
});
