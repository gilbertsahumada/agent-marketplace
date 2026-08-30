import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import type { D1DatabaseLike } from "../../src/db/client";
import { createDatabase } from "../../src/db/orm";
import { catalogAgentEndpoints, catalogAgents, catalogEndpoints } from "../../src/db/schema";
import { createD1CatalogProbePersistence } from "../../src/phases/catalog-probe-d1";

const NOW = 1_788_000_000_000;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM catalog_observations").run();
  await env.DB.prepare("DELETE FROM catalog_agent_endpoints").run();
  await env.DB.prepare("DELETE FROM catalog_endpoints").run();
  await env.DB.prepare("DELETE FROM catalog_agents").run();
});

describe("catalog probe D1 persistence", () => {
  it("prioritizes contract and protocol endpoints before generic web pages", async () => {
    const db = createDatabase(env.DB as unknown as D1DatabaseLike);
    await db.insert(catalogAgents).values({
      agentKey: "eip155:56:45422", agentId: "45422", chainId: 56,
      metadataState: "ok", firstSeenAt: NOW, lastSeenAt: NOW, priority: 0,
    });
    await db.insert(catalogEndpoints).values([
      {
        endpointKey: "a".repeat(64), representativeAgentKey: "eip155:56:45422", protocol: "web",
        endpoint: "https://seller.example", originKey: "web-origin", safety: "safe",
        safetyReason: null, nextProbeAt: 0, consecutiveFailures: 0,
      },
      {
        endpointKey: "b".repeat(64), representativeAgentKey: "eip155:56:45422", protocol: "a2a",
        endpoint: "https://seller.example/a2a", originKey: "a2a-origin", safety: "safe",
        safetyReason: null, nextProbeAt: 0, consecutiveFailures: 0,
      },
      {
        endpointKey: "c".repeat(64), representativeAgentKey: "eip155:56:45422", protocol: "mcp",
        endpoint: "https://seller.example/mcp", originKey: "mcp-origin", safety: "safe",
        safetyReason: null, nextProbeAt: 0, consecutiveFailures: 0,
      },
      {
        endpointKey: "d".repeat(64), representativeAgentKey: "eip155:56:45422", protocol: "erc8183_http",
        endpoint: "https://seller.example/quote", originKey: "erc-origin", safety: "safe",
        safetyReason: null, nextProbeAt: 0, consecutiveFailures: 0,
      },
    ]);
    await db.insert(catalogAgentEndpoints).values(["a", "b", "c", "d"].map((prefix) => ({
      agentKey: "eip155:56:45422",
      endpointKey: prefix.repeat(64),
      declarationState: "current" as const,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      priority: 40,
    })));

    const targets = await createD1CatalogProbePersistence(env.DB as unknown as D1DatabaseLike)
      .selectTargets({ limit: 4, nowMs: NOW });

    expect(targets.map((target) => target.protocol))
      .toEqual(["erc8183_http", "mcp", "a2a", "web"]);
  });

  it("selects only due origin representatives and applies success cadence atomically", async () => {
    const db = createDatabase(env.DB as unknown as D1DatabaseLike);
    await db.insert(catalogAgents).values({
      agentKey: "eip155:56:45422", agentId: "45422", chainId: 56,
      metadataState: "ok", firstSeenAt: NOW, lastSeenAt: NOW, priority: 0,
    });
    await db.insert(catalogEndpoints).values([
      {
        endpointKey: "a".repeat(64), representativeAgentKey: "eip155:56:45422", protocol: "mcp",
        endpoint: "https://seller.example/mcp", originKey: "origin", safety: "safe",
        safetyReason: null, nextProbeAt: 0, consecutiveFailures: 0,
      },
      {
        endpointKey: "b".repeat(64), representativeAgentKey: null, protocol: "mcp",
        endpoint: "https://seller.example/other", originKey: "origin", safety: "safe",
        safetyReason: null, nextProbeAt: 0, consecutiveFailures: 0,
      },
    ]);
    await db.insert(catalogAgentEndpoints).values([
      { agentKey: "eip155:56:45422", endpointKey: "a".repeat(64), declarationState: "current",
        firstSeenAt: NOW, lastSeenAt: NOW, priority: 40 },
      { agentKey: "eip155:56:45422", endpointKey: "b".repeat(64), declarationState: "current",
        firstSeenAt: NOW, lastSeenAt: NOW, priority: 99 },
    ]);
    const persistence = createD1CatalogProbePersistence(env.DB as unknown as D1DatabaseLike);

    const targets = await persistence.selectTargets({ limit: 1, nowMs: NOW });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.endpointKey).toBe("a".repeat(64));
    await persistence.commit(targets[0]!, {
      outcome: "protocol_valid", observedAt: NOW, expiresAt: NOW + 900_000,
      httpStatus: 200, errorCode: null, durationMs: 25, capabilityCount: 2, method: "POST",
    });

    expect(await env.DB.prepare("SELECT source, outcome, detailsJson FROM catalog_observations").first())
      .toMatchObject({ source: "worker_probe", outcome: "protocol_valid", detailsJson: '{"capabilityCount":2,"method":"POST"}' });
    expect(await env.DB.prepare("SELECT lastProbedAt, nextProbeAt, consecutiveFailures FROM catalog_endpoints WHERE endpointKey = ?")
      .bind("a".repeat(64)).first()).toMatchObject({
        lastProbedAt: NOW,
        nextProbeAt: NOW + 24 * 60 * 60_000,
        consecutiveFailures: 0,
      });
    await db.update(catalogEndpoints).set({ representativeAgentKey: "eip155:56:45422" })
      .where(eq(catalogEndpoints.endpointKey, "b".repeat(64)));
    expect((await persistence.selectTargets({ limit: 1, nowMs: NOW }))[0]?.endpointKey)
      .toBe("b".repeat(64));
  });

  it("backs failures off progressively", async () => {
    const db = createDatabase(env.DB as unknown as D1DatabaseLike);
    await db.insert(catalogEndpoints).values({
      endpointKey: "c".repeat(64), representativeAgentKey: "eip155:56:1", protocol: "a2a",
      endpoint: "https://seller.example/a2a", originKey: "origin", safety: "safe",
      safetyReason: null, nextProbeAt: 0, consecutiveFailures: 2,
    });
    await db.insert(catalogAgentEndpoints).values({
      agentKey: "eip155:56:1", endpointKey: "c".repeat(64), declarationState: "current",
      firstSeenAt: NOW, lastSeenAt: NOW, priority: 60,
    });
    const persistence = createD1CatalogProbePersistence(env.DB as unknown as D1DatabaseLike);
    const target = (await persistence.selectTargets({ limit: 1, nowMs: NOW }))[0]!;
    await persistence.commit(target, {
      outcome: "network_error", observedAt: NOW, expiresAt: null,
      httpStatus: null, errorCode: "CATALOG_NETWORK_ERROR", durationMs: 5,
      capabilityCount: 0, method: "GET",
    });
    expect(await env.DB.prepare("SELECT nextProbeAt, consecutiveFailures FROM catalog_endpoints WHERE endpointKey = ?")
      .bind("c".repeat(64)).first()).toMatchObject({
        nextProbeAt: NOW + 24 * 60 * 60_000,
        consecutiveFailures: 3,
      });
  });
});
