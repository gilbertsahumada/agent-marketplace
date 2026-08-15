import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildBscCandidateInventory, KNOWN_HEYANON_AGENT_IDS } from "../src/trust8004/inventory.js";
import { Trust8004Provider } from "../src/trust8004/provider.js";
import { parseServices, Trust8004SchemaError } from "../src/trust8004/schemas.js";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`./fixtures/trust8004/${name}`, import.meta.url), "utf8")) as unknown;
}

function fixtureFetch(
  list: unknown,
  profiles: Record<string, unknown>,
  scores: Record<string, unknown>,
  onRequest?: (url: URL) => Promise<void> | void,
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    await onRequest?.(url);
    let body: unknown;
    if (url.pathname === "/api/v2/agents") body = list;
    else if (url.pathname === "/api/v2/agents/profile") body = profiles[url.searchParams.get("agentId") ?? ""];
    else {
      const match = url.pathname.match(/^\/api\/v2\/agents\/(\d+)\/score$/);
      body = match ? scores[match[1]!] : undefined;
    }
    return body === undefined
      ? new Response("not found", { status: 404 })
      : Response.json(body);
  }) as typeof fetch;
}

async function allFixtures(): Promise<{
  list: unknown;
  profiles: Record<string, unknown>;
  scores: Record<string, unknown>;
}> {
  return {
    list: await fixture("list.json"),
    profiles: await fixture("profiles.json") as Record<string, unknown>,
    scores: await fixture("scores.json") as Record<string, unknown>,
  };
}

describe("Trust8004Provider", () => {
  it("normalizes services supplied as a JSON string or an array", () => {
    const service = { name: "MCP", endpoint: "https://fixture.invalid/mcp", tools: ["quote"] };
    expect(parseServices(JSON.stringify([service]))).toEqual(parseServices([service]));
  });

  it("lists only BSC agents with explicit pagination and partial coverage", async () => {
    const data = await allFixtures();
    let requestedUrl: URL | undefined;
    const provider = new Trust8004Provider({
      fetch: fixtureFetch(data.list, data.profiles, data.scores, (url) => { requestedUrl = url; }),
      minimumRequestIntervalMs: 0,
      now: () => 1_754_000_300_000,
    });
    const page = await provider.listAgents({ limit: 50, offset: 0, search: "grid", active: true });

    expect(page.catalogCoverage).toBe("partial");
    expect(requestedUrl?.searchParams.get("chainId")).toBe("56");
    expect(requestedUrl?.searchParams.get("limit")).toBe("50");
    expect(requestedUrl?.searchParams.get("offset")).toBe("0");
    expect(requestedUrl?.searchParams.get("search")).toBe("grid");
  });

  it("deduplicates identical requests and serializes distinct requests", async () => {
    const data = await allFixtures();
    let requestCount = 0;
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const provider = new Trust8004Provider({
      fetch: fixtureFetch(data.list, data.profiles, data.scores, async () => {
        requestCount += 1;
        activeRequests += 1;
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeRequests -= 1;
      }),
      minimumRequestIntervalMs: 0,
    });

    await Promise.all([provider.listAgents(), provider.listAgents()]);
    expect(requestCount).toBe(1);
    await Promise.all([provider.getProfile("45650"), provider.getTrustScore("45650")]);
    expect(maximumActiveRequests).toBe(1);
  });

  it("builds a deterministic partial inventory containing all four known HeyAnon agents", async () => {
    const data = await allFixtures();
    const provider = new Trust8004Provider({
      fetch: fixtureFetch(data.list, data.profiles, data.scores),
      minimumRequestIntervalMs: 0,
    });
    const inventory = await buildBscCandidateInventory(provider, () => 1_754_000_300_000);

    expect(inventory.chainId).toBe(56);
    expect(inventory.source.catalogCoverage).toBe("partial");
    expect(inventory.agents.map((agent) => agent.agentId)).toEqual(KNOWN_HEYANON_AGENT_IDS);
    expect(inventory.categories.rebalancing.agentIds).toContain("45650");
    expect(inventory.categories.yield_optimisation.agentIds).toEqual(expect.arrayContaining(["45422", "43129"]));
    expect(inventory.categories.health_factor_monitoring.agentIds).toEqual(expect.arrayContaining(["45381", "43129"]));
    expect(inventory.categories.grid_trading).toMatchObject({ status: "unverified", agentIds: [] });
    expect(inventory.agents.every((agent) => agent.endpointObservation.status === "not_observed")).toBe(true);
    expect(inventory.agents.every((agent) => agent.provenance.services.kind === "declared")).toBe(true);
    expect(inventory.agents.every((agent) => agent.categories.every((category) => !category.verified))).toBe(true);
  });

  it("fails visibly with a diagnostic path when a response violates the schema", async () => {
    const data = await allFixtures();
    const invalidProfiles = structuredClone(data.profiles);
    const invalid = invalidProfiles["45650"] as { agent: { services: unknown } };
    invalid.agent.services = "not-json";
    const provider = new Trust8004Provider({
      fetch: fixtureFetch(data.list, invalidProfiles, data.scores),
      minimumRequestIntervalMs: 0,
    });

    await expect(provider.getProfile("45650")).rejects.toThrow(/response\.agent\.services: invalid JSON string/);
  });

  it("rejects a non-BSC response instead of silently accepting it", async () => {
    const data = await allFixtures();
    const invalidProfiles = structuredClone(data.profiles);
    const invalid = invalidProfiles["45650"] as { agent: { chainId: unknown } };
    invalid.agent.chainId = 97;
    const provider = new Trust8004Provider({
      fetch: fixtureFetch(data.list, invalidProfiles, data.scores),
      minimumRequestIntervalMs: 0,
    });

    await expect(provider.getProfile("45650")).rejects.toBeInstanceOf(Trust8004SchemaError);
  });
});
