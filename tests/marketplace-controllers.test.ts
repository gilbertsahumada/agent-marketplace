import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarketplaceRateLimitError } from "../src/business/errors/marketplace-errors.ts";

const executeList = vi.fn();
const executeGet = vi.fn();
const executeCompare = vi.fn();
const executeProof = vi.fn();
const executePassport = vi.fn();
const executeValidate = vi.fn();
const executeMainnetProof = vi.fn();
const syncCatalogObservation = vi.fn();

vi.mock("@/src/business/composition", () => ({
  listMarketplaceAgents: { execute: executeList },
  getMarketplaceAgent: { execute: executeGet },
  compareMarketplaceAgents: { execute: executeCompare },
  getPublicJobProof: { execute: executeProof },
  getAgentEvidencePassport: { execute: executePassport },
  validateMarketplaceAgent: { execute: executeValidate },
  getPublicMainnetJobProof: { execute: executeMainnetProof },
  recordCatalogObservation: syncCatalogObservation,
  CatalogValidationRequestError: class CatalogValidationRequestError extends Error {
    readonly code = "CATALOG_VALIDATION_UNAVAILABLE";
    readonly httpStatus = 503;
    readonly retryAfterSeconds = undefined;
  },
  requestCatalogValidation: vi.fn(),
  issueCatalogValidationRequestToken: vi.fn(),
}));

const agentsRoute = await import("../app/api/marketplace/agents/route.ts");
const agentRoute = await import("../app/api/marketplace/agents/[agentId]/route.ts");
const compareRoute = await import("../app/api/marketplace/compare/route.ts");
const proofRoute = await import("../app/api/marketplace/proofs/jobs/514/route.ts");
const passportRoute = await import("../app/api/marketplace/agents/[agentId]/passport/route.ts");
const validationRoute = await import("../app/api/marketplace/validate/route.ts");
const mainnetProofRoute = await import("../app/api/marketplace/proofs/jobs/mainnet/[jobId]/route.ts");
const browserObservationRoute = await import("../app/api/marketplace/agents/[agentId]/observations/browser/route.ts");

describe("marketplace API controllers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates the all view as one paginated use-case call", async () => {
    executeList.mockResolvedValue({ items: [] });
    const response = await agentsRoute.GET(new Request("http://local/api/marketplace/agents?view=all&page=2&limit=24&q=venus&sort=newest"));
    expect(response.status).toBe(200);
    expect(executeList).toHaveBeenCalledOnce();
    expect(executeList).toHaveBeenCalledWith({ view: "all", page: 2, limit: 24, q: "venus", sort: "newest" });
  });

  it("delegates the curated category without global classification", async () => {
    executeList.mockResolvedValue({ items: [] });
    await agentsRoute.GET(new Request("http://local/api/marketplace/agents?view=marketplace&category=grid_trading"));
    expect(executeList).toHaveBeenCalledWith({ view: "marketplace", page: 1, limit: 12, category: "grid_trading" });
  });

  it("delegates the hireable availability filter to the use case", async () => {
    executeList.mockResolvedValue({ items: [] });
    await agentsRoute.GET(new Request("http://local/api/marketplace/agents?view=marketplace&availability=hireable"));
    expect(executeList).toHaveBeenCalledWith({ view: "marketplace", page: 1, limit: 12, availability: "hireable" });
  });

  it("delegates repeated catalog filters as one combined query", async () => {
    executeList.mockResolvedValue({ items: [] });
    await agentsRoute.GET(new Request(
      "http://local/api/marketplace/agents?view=marketplace"
      + "&status=declared&status=hireable"
      + "&category=grid_trading&category=yield_optimisation"
      + "&protocol=a2a&protocol=mcp&reachability=live"
      + "&commerce=admitted&quote=verified&latestFailure=false",
    ));
    expect(executeList).toHaveBeenCalledWith({
      view: "marketplace", page: 1, limit: 12,
      statuses: ["declared", "hireable"],
      categories: ["grid_trading", "yield_optimisation"],
      protocols: ["a2a", "mcp"],
      reachability: ["live"],
      commerce: ["admitted"],
      quote: ["verified"],
      latestFailure: false,
    });
  });

  it("rejects invalid combined catalog filters visibly", async () => {
    const response = await agentsRoute.GET(new Request(
      "http://local/api/marketplace/agents?view=marketplace&protocol=twitter",
    ));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "InvalidMarketplaceInputError" } });
    expect(executeList).not.toHaveBeenCalled();
  });

  it("does not silently ignore marketplace filters in the registry view", async () => {
    const response = await agentsRoute.GET(new Request(
      "http://local/api/marketplace/agents?view=all&status=hireable",
    ));
    expect(response.status).toBe(400);
    expect(executeList).not.toHaveBeenCalled();
  });

  it("rejects an unknown availability value visibly", async () => {
    const response = await agentsRoute.GET(new Request("http://local/api/marketplace/agents?view=marketplace&availability=sometimes"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "InvalidMarketplaceInputError" } });
    expect(executeList).not.toHaveBeenCalled();
  });

  it("rejects invalid controller input visibly", async () => {
    const response = await agentsRoute.GET(new Request("http://local/api/marketplace/agents?view=everything"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "InvalidMarketplaceInputError" } });
    expect(executeList).not.toHaveBeenCalled();
  });

  it("rejects unsupported upstream ordering visibly", async () => {
    const response = await agentsRoute.GET(new Request("http://local/api/marketplace/agents?view=all&sort=magic"));
    expect(response.status).toBe(400);
    expect(executeList).not.toHaveBeenCalled();
  });

  it("delegates profile, passport, comparison, and proof to one use case each", async () => {
    executeGet.mockResolvedValue({ agentId: "45650" });
    executePassport.mockResolvedValue({ agentId: "45650", state: "registered" });
    executeCompare.mockResolvedValue({ agents: [] });
    executeProof.mockResolvedValue({ snapshot: { jobId: "514" } });
    await agentRoute.GET(new Request("http://local"), { params: Promise.resolve({ agentId: "45650" }) });
    const passportResponse = await passportRoute.GET(new Request("http://local"), { params: Promise.resolve({ agentId: "45650" }) });
    await compareRoute.GET(new Request("http://local?agentId=45650&agentId=45381"));
    await proofRoute.GET();
    expect(executeGet).toHaveBeenCalledOnce();
    expect(executePassport).toHaveBeenCalledOnce();
    expect(executePassport).toHaveBeenCalledWith({ agentId: "45650" });
    expect(passportResponse.headers.get("cache-control")).toBe("public, max-age=60, must-revalidate");
    expect(executeCompare).toHaveBeenCalledOnce();
    expect(executeProof).toHaveBeenCalledOnce();
  });

  it("accepts only a bounded JSON Agent ID for read-only validation", async () => {
    executeValidate.mockResolvedValue({
      agent: { agentId: "303779" },
      status: "complete",
      generatedAt: "2026-08-30T00:00:00.000Z",
      evidence: { endpointChecks: [], quote: { status: "not_requested" } },
    });
    const response = await validationRoute.POST(new Request("http://local/api/marketplace/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "303779" }),
    }));

    expect(response.status).toBe(200);
    expect(executeValidate).toHaveBeenCalledWith({ agentId: "303779" });
    expect(response.headers.get("cache-control")).toBe("no-store");

    executeValidate.mockClear();
    const rejected = await validationRoute.POST(new Request("http://local/api/marketplace/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "303779", endpoint: "http://127.0.0.1/private" }),
    }));
    expect(rejected.status).toBe(400);
    expect(executeValidate).not.toHaveBeenCalled();
  });

  it("persists browser evidence only for an endpoint declared by the requested agent", async () => {
    const observedAt = new Date().toISOString();
    executeGet.mockResolvedValue({
      agentId: "45422",
      services: [{ name: "MCP", endpoint: "https://seller.example/mcp" }],
      endpoints: [],
    });
    syncCatalogObservation.mockResolvedValue({ status: "recorded" });
    const body = {
      source: "browser_reported",
      protocol: "mcp",
      endpoint: "https://seller.example/mcp",
      outcome: "protocol_valid",
      observedAt,
      expiresAt: new Date(Date.parse(observedAt) + 15 * 60_000).toISOString(),
      httpStatus: 200,
      durationMs: 42,
      capabilityCount: 2,
      errorCode: null,
      message: "Protocol valid",
      method: "POST",
      cors: true,
    };
    const response = await browserObservationRoute.POST(new Request("http://local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ agentId: "45422" }) });

    expect(response.status).toBe(201);
    expect(executeGet).toHaveBeenCalledWith({ agentId: "45422" });
    expect(syncCatalogObservation).toHaveBeenCalledWith(expect.objectContaining({
      source: "browser_reported",
      agentId: "45422",
      endpoint: "https://seller.example/mcp",
      outcome: "protocol_valid",
    }));

    executeGet.mockResolvedValueOnce({
      agentId: "45422",
      services: [],
      endpoints: [],
    });
    const rejected = await browserObservationRoute.POST(new Request("http://local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ agentId: "45422" }) });
    expect(rejected.status).toBe(400);

    const genericWeb = await browserObservationRoute.POST(new Request("http://local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, protocol: "web", endpoint: "https://seller.example" }),
    }), { params: Promise.resolve({ agentId: "45422" }) });
    expect(genericWeb.status).toBe(400);
    expect(syncCatalogObservation).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized validation bodies before invoking the use case", async () => {
    const declared = await validationRoute.POST(new Request("http://local/api/marketplace/validate", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "257" },
      body: JSON.stringify({ agentId: "303779" }),
    }));
    expect(declared.status).toBe(413);
    expect(executeValidate).not.toHaveBeenCalled();

    const streamed = await validationRoute.POST(new Request("http://local/api/marketplace/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`{"agentId":"${"1".repeat(300)}"}`));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(streamed.status).toBe(413);
    expect(executeValidate).not.toHaveBeenCalled();
  });

  it("returns a diagnostic 429 when validation admission is exhausted", async () => {
    executeValidate.mockRejectedValueOnce(new MarketplaceRateLimitError(42));
    const response = await validationRoute.POST(new Request("http://local/api/marketplace/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "303779" }),
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.json()).toMatchObject({ error: { code: "MarketplaceRateLimitError" } });
  });

  it("delegates a durable Mainnet proof lookup to exactly one use case", async () => {
    executeMainnetProof.mockReturnValue({ chainId: 56, jobId: "700", resultHashVerified: true });
    const response = await mainnetProofRoute.GET(new Request("http://local"), {
      params: Promise.resolve({ jobId: "700" }),
    });
    expect(response.status).toBe(200);
    expect(executeMainnetProof).toHaveBeenCalledOnce();
    expect(executeMainnetProof).toHaveBeenCalledWith({ jobId: "700" });
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
  });
});
