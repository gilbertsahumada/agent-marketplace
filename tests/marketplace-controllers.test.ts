import { beforeEach, describe, expect, it, vi } from "vitest";

const executeList = vi.fn();
const executeGet = vi.fn();
const executeCompare = vi.fn();
const executeProof = vi.fn();

vi.mock("@/src/business/composition", () => ({
  listMarketplaceAgents: { execute: executeList },
  getMarketplaceAgent: { execute: executeGet },
  compareMarketplaceAgents: { execute: executeCompare },
  getPublicJobProof: { execute: executeProof },
}));

const agentsRoute = await import("../app/api/marketplace/agents/route.js");
const agentRoute = await import("../app/api/marketplace/agents/[agentId]/route.js");
const compareRoute = await import("../app/api/marketplace/compare/route.js");
const proofRoute = await import("../app/api/marketplace/proofs/jobs/514/route.js");

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

  it("delegates profile, comparison, and proof to one use case each", async () => {
    executeGet.mockResolvedValue({ agentId: "45650" });
    executeCompare.mockResolvedValue({ agents: [] });
    executeProof.mockResolvedValue({ snapshot: { jobId: "514" } });
    await agentRoute.GET(new Request("http://local"), { params: Promise.resolve({ agentId: "45650" }) });
    await compareRoute.GET(new Request("http://local?agentId=45650&agentId=45381"));
    await proofRoute.GET();
    expect(executeGet).toHaveBeenCalledOnce();
    expect(executeCompare).toHaveBeenCalledOnce();
    expect(executeProof).toHaveBeenCalledOnce();
  });
});
