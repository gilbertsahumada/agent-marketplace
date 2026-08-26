import { beforeEach, describe, expect, it, vi } from "vitest";

const executeList = vi.fn();
const executeGet = vi.fn();
const executeCompare = vi.fn();
const executeProof = vi.fn();
const executePassport = vi.fn();
const executeValidate = vi.fn();
const executeMainnetProof = vi.fn();

vi.mock("@/src/business/composition", () => ({
  listMarketplaceAgents: { execute: executeList },
  getMarketplaceAgent: { execute: executeGet },
  compareMarketplaceAgents: { execute: executeCompare },
  getPublicJobProof: { execute: executeProof },
  getAgentEvidencePassport: { execute: executePassport },
  validateMarketplaceAgent: { execute: executeValidate },
  getPublicMainnetJobProof: { execute: executeMainnetProof },
}));

const agentsRoute = await import("../app/api/marketplace/agents/route.js");
const agentRoute = await import("../app/api/marketplace/agents/[agentId]/route.js");
const compareRoute = await import("../app/api/marketplace/compare/route.js");
const proofRoute = await import("../app/api/marketplace/proofs/jobs/514/route.js");
const passportRoute = await import("../app/api/marketplace/agents/[agentId]/passport/route.js");
const validationRoute = await import("../app/api/marketplace/validate/route.js");
const mainnetProofRoute = await import("../app/api/marketplace/proofs/jobs/mainnet/[jobId]/route.js");

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
    expect(passportResponse.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(executeCompare).toHaveBeenCalledOnce();
    expect(executeProof).toHaveBeenCalledOnce();
  });

  it("accepts only a bounded JSON Agent ID for read-only validation", async () => {
    executeValidate.mockResolvedValue({ agent: { agentId: "303779" }, status: "complete" });
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
