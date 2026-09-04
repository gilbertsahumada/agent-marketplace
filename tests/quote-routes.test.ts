import { beforeEach, describe, expect, it, vi } from "vitest";

const quoteApi = vi.hoisted(() => ({
  fallbackBuyerQuote: vi.fn(),
  getBuyerQuoteHistory: vi.fn(),
  reportBuyerQuoteFailure: vi.fn(),
  startBuyerQuote: vi.fn(),
  submitBuyerQuoteResult: vi.fn(),
}));

vi.mock("@/src/business/composition", () => quoteApi);

const quoteRoute = await import("../app/api/marketplace/agents/[agentId]/quotes/route.ts");
const resultRoute = await import("../app/api/marketplace/agents/[agentId]/quotes/[attemptId]/result/route.ts");
const fallbackRoute = await import("../app/api/marketplace/agents/[agentId]/quotes/[attemptId]/fallback/route.ts");

const context = (agentId = "303779", attemptId = "03f1b8f1-4384-40b6-b31b-3e29a2f74eb7") => ({
  params: Promise.resolve({ agentId, attemptId }),
});

describe("buyer quote route controllers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers a bounded structured brief and keeps the response private", async () => {
    quoteApi.startBuyerQuote.mockResolvedValue({ status: 201, body: { attemptId: "attempt" } });
    const response = await quoteRoute.POST(new Request("http://local/api/marketplace/agents/303779/quotes", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://local", "x-forwarded-for": "203.0.113.2" },
      body: JSON.stringify({ objective: "Plan", deliverable: "JSON", acceptanceCriteria: "Deterministic" }),
    }), context());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(quoteApi.startBuyerQuote).toHaveBeenCalledWith("303779", {
      objective: "Plan",
      deliverable: "JSON",
      acceptanceCriteria: "Deterministic",
    }, { caller: "203.0.113.2|http://local" });
  });

  it.each([quoteRoute.POST, resultRoute.POST, fallbackRoute.POST])(
    "rejects a non-JSON mutation before contacting the Worker",
    async (handler) => {
      const response = await handler(new Request("http://local/x", { method: "POST", body: "plain" }), context() as never);
      expect(response.status).toBe(400);
    },
  );

  it("forwards a browser result and a sanitized browser failure separately", async () => {
    quoteApi.submitBuyerQuoteResult.mockResolvedValue({ status: 201, body: { status: "succeeded" } });
    quoteApi.reportBuyerQuoteFailure.mockResolvedValue({ status: 201, body: { status: "failed" } });

    const success = await resultRoute.POST(new Request("http://local/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envelope: { quote: "signed" } }),
    }), context());
    expect(success.status).toBe(201);
    expect(quoteApi.submitBuyerQuoteResult).toHaveBeenCalledWith(
      "303779",
      "03f1b8f1-4384-40b6-b31b-3e29a2f74eb7",
      { quote: "signed" },
      { caller: "anonymous" },
    );

    const failure = await resultRoute.POST(new Request("http://local/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ errorCode: "A2A_QUOTE_INVALID" }),
    }), context());
    expect(failure.status).toBe(201);
    expect(quoteApi.reportBuyerQuoteFailure).toHaveBeenCalledWith(
      "303779",
      "03f1b8f1-4384-40b6-b31b-3e29a2f74eb7",
      "A2A_QUOTE_INVALID",
      { caller: "anonymous" },
    );
  });

  it("uses the same canonical request and attempt for the Worker fallback", async () => {
    quoteApi.fallbackBuyerQuote.mockResolvedValue({ status: 201, body: { status: "succeeded" } });
    const canonical = {
      task_description: "Plan\n\nExpected deliverable: JSON\n\nAcceptance criteria: Deterministic",
      terms: {
        deliverables: "JSON",
        quality_standards: "Deterministic",
        evaluation_required: true,
        evaluator_type: "uma_oov3",
      },
    };
    const response = await fallbackRoute.POST(new Request("http://local/fallback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-marketplace-browser-error": "BROWSER_NETWORK_ERROR" },
      body: JSON.stringify(canonical),
    }), context());

    expect(response.status).toBe(201);
    expect(quoteApi.fallbackBuyerQuote).toHaveBeenCalledWith(
      "303779",
      "03f1b8f1-4384-40b6-b31b-3e29a2f74eb7",
      canonical,
      { caller: "anonymous", browserErrorCode: "BROWSER_NETWORK_ERROR" },
    );
  });

  it("serves sanitized history without shared caching", async () => {
    quoteApi.getBuyerQuoteHistory.mockResolvedValue({ status: 200, body: { requests: 2 } });
    const response = await quoteRoute.GET(new Request("http://local/x"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ requests: 2 });
  });
});
