import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import type { D1DatabaseLike } from "../../src/db/client";
import { createDatabase, readCatalogProjectionMismatches } from "../../src/db/orm";
import { catalogAgentEndpoints, catalogAgents, catalogEndpoints } from "../../src/db/schema";
import { createD1CatalogProbePersistence } from "../../src/phases/catalog-probe-d1";
import { clearCatalogFixtures } from "./catalog-fixtures";

const NOW = 1_788_000_000_000;

beforeEach(async () => {
  await clearCatalogFixtures();
});

describe("catalog probe D1 persistence", () => {
  it("prioritizes operational endpoints and never selects generic web pages", async () => {
    const db = createDatabase(env.DB as unknown as D1DatabaseLike);
    await db.insert(catalogAgents).values({
      agentKey: "eip155:56:45422", agentId: "45422", chainId: 56,
      metadataState: "ok", firstSeenAt: NOW, lastSeenAt: NOW, priority: 0,
    });
    await db.insert(catalogEndpoints).values([
      {
        endpointKey: "a".repeat(64), representativeAgentKey: "eip155:56:45422", protocol: "web",
        endpoint: "https://seller.example", originKey: "web-origin", safety: "safe",
        safetyReason: null, nextProbeAt: null, consecutiveFailures: 0,
        declaredProtocol: "web", role: "external", validationProtocol: null,
        externalKind: "website", eligibility: "unsupported",
      },
      {
        endpointKey: "b".repeat(64), representativeAgentKey: "eip155:56:45422", protocol: "a2a",
        endpoint: "https://seller.example/a2a", originKey: "a2a-origin", safety: "safe",
        safetyReason: null, nextProbeAt: 0, consecutiveFailures: 0,
        declaredProtocol: "a2a", role: "operational", validationProtocol: "a2a", eligibility: "eligible",
      },
      {
        endpointKey: "c".repeat(64), representativeAgentKey: "eip155:56:45422", protocol: "mcp",
        endpoint: "https://seller.example/mcp", originKey: "mcp-origin", safety: "safe",
        safetyReason: null, nextProbeAt: 0, consecutiveFailures: 0,
        declaredProtocol: "mcp", role: "operational", validationProtocol: "mcp", eligibility: "eligible",
      },
      {
        endpointKey: "d".repeat(64), representativeAgentKey: "eip155:56:45422", protocol: "erc8183_http",
        endpoint: "https://seller.example/quote", originKey: "erc-origin", safety: "safe",
        safetyReason: null, nextProbeAt: 0, consecutiveFailures: 0,
        declaredProtocol: "erc8183_http", role: "operational", validationProtocol: "erc8183_http", eligibility: "eligible",
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
      .toEqual(["erc8183_http", "mcp", "a2a"]);
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
        declaredProtocol: "mcp", role: "operational", validationProtocol: "mcp", eligibility: "eligible",
      },
      {
        endpointKey: "b".repeat(64), representativeAgentKey: null, protocol: "mcp",
        endpoint: "https://seller.example/other", originKey: "origin", safety: "safe",
        safetyReason: null, nextProbeAt: 0, consecutiveFailures: 0,
        declaredProtocol: "mcp", role: "operational", validationProtocol: "mcp", eligibility: "eligible",
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
    expect(await persistence.selectTargets({ limit: 1, nowMs: NOW })).toHaveLength(0);
    await persistence.commit(targets[0]!, {
      outcome: "protocol_valid", observedAt: NOW, expiresAt: NOW + 900_000,
      httpStatus: 200, errorCode: null, durationMs: 25, capabilityCount: 2, method: "POST",
    });

    expect(await env.DB.prepare("SELECT source, outcome, detailsJson FROM catalog_observations").first())
      .toMatchObject({
        source: "worker_probe",
        outcome: "protocol_valid",
        detailsJson: '{"capabilityCount":2,"method":"POST","stageDurationsMs":{},"commerceCapability":null}',
      });
    expect(await env.DB.prepare("SELECT lastProbedAt, nextProbeAt, consecutiveFailures FROM catalog_endpoints WHERE endpointKey = ?")
      .bind("a".repeat(64)).first()).toMatchObject({
        lastProbedAt: NOW,
        nextProbeAt: NOW + 24 * 60 * 60_000,
        consecutiveFailures: 0,
      });
    expect(await readCatalogProjectionMismatches(db)).toEqual([]);
    await db.update(catalogEndpoints).set({ lastAttemptOutcome: "timeout" })
      .where(eq(catalogEndpoints.endpointKey, "a".repeat(64)));
    expect(await readCatalogProjectionMismatches(db)).toMatchObject([{
      endpointKey: "a".repeat(64),
      projectedAttemptOutcome: "timeout",
      ledgerAttemptOutcome: "protocol_valid",
    }]);
    await db.update(catalogEndpoints).set({ lastAttemptOutcome: "protocol_valid" })
      .where(eq(catalogEndpoints.endpointKey, "a".repeat(64)));
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
      declaredProtocol: "a2a", role: "operational", validationProtocol: "a2a", eligibility: "eligible",
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

  it("uses the configured refresh and failure schedule", async () => {
    const db = createDatabase(env.DB as unknown as D1DatabaseLike);
    await db.insert(catalogEndpoints).values({
      endpointKey: "d".repeat(64), representativeAgentKey: "eip155:56:2", protocol: "a2a",
      endpoint: "https://seller.example/a2a-two", originKey: "origin-two", safety: "safe",
      safetyReason: null, nextProbeAt: 0, consecutiveFailures: 1,
      declaredProtocol: "a2a", role: "operational", validationProtocol: "a2a", eligibility: "eligible",
    });
    await db.insert(catalogAgentEndpoints).values({
      agentKey: "eip155:56:2", endpointKey: "d".repeat(64), declarationState: "current",
      firstSeenAt: NOW, lastSeenAt: NOW, priority: 60,
    });
    const persistence = createD1CatalogProbePersistence(env.DB as unknown as D1DatabaseLike, {
      priorityRefreshMs: 10_000,
      refreshMsByProtocol: { a2a: 20_000, mcp: 30_000, erc8183_http: 40_000 },
      failureBackoffMs: [5_000, 15_000],
    });
    const target = (await persistence.selectTargets({ limit: 1, nowMs: NOW }))[0]!;
    await persistence.commit(target, {
      outcome: "network_error", observedAt: NOW, expiresAt: null,
      httpStatus: null, errorCode: "CATALOG_NETWORK_ERROR", durationMs: 5,
      capabilityCount: 0, method: "GET",
    });
    expect(await env.DB.prepare("SELECT nextProbeAt FROM catalog_endpoints WHERE endpointKey = ?")
      .bind("d".repeat(64)).first()).toMatchObject({ nextProbeAt: NOW + 15_000 });
  });
});
