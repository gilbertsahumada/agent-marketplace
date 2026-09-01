import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { D1DatabaseLike } from "../../src/db/client";
import {
  catalogIngestTaskLimitForBudget,
  enqueueCatalogDiscoveryPage,
  processNextCatalogIngestTask,
} from "../../src/phases/catalog-ingest";
import { CatalogHttpError } from "../../src/trust8004/client";
import type { CatalogAgent } from "../../src/trust8004/types";
import { clearCatalogFixtures } from "./catalog-fixtures";

const NOW = 1_788_000_000_000;

function agent(agentId: string, endpoints = 1, version = 1): CatalogAgent {
  return {
    chainId: 56,
    agentId,
    owner: `0x${agentId.padStart(40, "0")}`,
    metadataUri: `ipfs://metadata/${agentId}/${version}`,
    blockNumber: String(1_000 + Number(agentId)),
    name: `Agent ${agentId} v${version}`,
    description: null,
    imageUrl: null,
    registeredAt: NOW + Number(agentId),
    metadataUpdatedAt: NOW + version,
    metadataAvailable: true,
    declarations: { a2a: true, erc8183: false },
    declaredEndpoints: [],
    indexEndpoints: Array.from({ length: endpoints }, (_, index) => index === endpoints - 1
      ? {
          protocol: "web" as const,
          endpoint: `https://agent-${agentId}.example.com/about-${version}`,
          rawProtocol: "website",
          source: "services" as const,
          sourceIndex: index,
        }
      : {
          protocol: index % 2 === 0 ? "a2a" as const : "mcp" as const,
          endpoint: `https://agent-${agentId}.example.com/${version}/endpoint-${index}`,
          rawProtocol: index % 2 === 0 ? "A2A" : "MCP",
          source: "services" as const,
          sourceIndex: index,
        }),
  };
}

function sharedOriginAgent(agentId: string, endpoint: string): CatalogAgent {
  const candidate = agent(agentId, 1);
  candidate.indexEndpoints = [{
    protocol: "a2a",
    endpoint,
    rawProtocol: "A2A",
    source: "services",
    sourceIndex: 0,
  }];
  return candidate;
}

beforeEach(async () => {
  await clearCatalogFixtures();
  await env.DB.prepare("DELETE FROM runtime_state").run();
});

describe("resumable catalog discovery ingest", () => {
  it("defers whole ingest tasks when the remaining D1 query budget cannot cover their worst case", () => {
    expect(catalogIngestTaskLimitForBudget({
      remainingQueries: 18,
      maxDeclarations: 4,
      requestedTasks: 2,
      reserveQueries: 1,
    })).toBe(1);
    expect(catalogIngestTaskLimitForBudget({
      remainingQueries: 19,
      maxDeclarations: 4,
      requestedTasks: 2,
      reserveQueries: 1,
    })).toBe(2);
  });

  it("makes every identity visible and commits the sweep cursor with its worklist", async () => {
    const agents = Array.from({ length: 8 }, (_, index) => agent(String(index + 1)));
    const summary = await enqueueCatalogDiscoveryPage(
      env.DB as unknown as D1DatabaseLike,
      agents,
      { nowMs: NOW, source: "sweep", cursor: 8, cursorKey: "catalog_sweep_offset" },
    );

    expect(summary).toMatchObject({
      agentsSeen: 8,
      identitiesWritten: 8,
      tasksQueued: 8,
      cursor: 8,
      d1RowsWritten: 17,
    });
    expect(summary.d1Queries).toBeLessThanOrEqual(40);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_agents").first())
      .toMatchObject({ count: 8 });
    expect(await env.DB.prepare("SELECT owner, metadataUri, blockNumber FROM catalog_agents WHERE agentId = '1'").first())
      .toEqual({ owner: `0x${"1".padStart(40, "0")}`, metadataUri: "ipfs://metadata/1/1", blockNumber: "1001" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_ingest_tasks WHERE status = 'pending'").first())
      .toMatchObject({ count: 8 });
    expect(await env.DB.prepare("SELECT integerValue FROM runtime_state WHERE key = 'catalog_sweep_offset'").first())
      .toMatchObject({ integerValue: 8 });
  });

  it("commits the trust8004 header high-water marker with the discovery page", async () => {
    const summary = await enqueueCatalogDiscoveryPage(
      env.DB as unknown as D1DatabaseLike,
      [agent("8")],
      { nowMs: NOW, source: "header", headerHighWater: `${NOW + 8}:8` },
    );

    expect(summary.d1RowsWritten).toBe(3);
    expect(await env.DB.prepare("SELECT textValue, integerValue FROM runtime_state WHERE key = 'header_high_water'").first())
      .toEqual({ textValue: `${NOW + 8}:8`, integerValue: null });
  });

  it("does not assign an origin representative to a different declared path", async () => {
    const first = sharedOriginAgent("100", "https://shared.example.com/first");
    await enqueueCatalogDiscoveryPage(env.DB as unknown as D1DatabaseLike, [first], {
      nowMs: NOW,
      source: "header",
    });
    await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 1,
      maxDeclarations: 4,
      fetchAgent: async () => first,
    });
    await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 2,
      maxDeclarations: 4,
      fetchAgent: async () => first,
    });

    const second = sharedOriginAgent("101", "https://shared.example.com/second");
    await enqueueCatalogDiscoveryPage(env.DB as unknown as D1DatabaseLike, [second], {
      nowMs: NOW + 3,
      source: "sweep",
    });
    await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 4,
      maxDeclarations: 4,
      fetchAgent: async () => second,
    });

    expect(await env.DB.prepare(`SELECT e.endpoint, e.representativeAgentKey
      FROM catalog_endpoints e
      WHERE e.endpoint IN ('https://shared.example.com/first', 'https://shared.example.com/second')
      ORDER BY e.endpoint`).all()).toMatchObject({
      results: [
        { endpoint: "https://shared.example.com/first", representativeAgentKey: "eip155:56:100" },
        { endpoint: "https://shared.example.com/second", representativeAgentKey: null },
      ],
    });
  });

  it("reassigns a shared endpoint when its representative declaration is retired", async () => {
    const representative = sharedOriginAgent("100", "https://shared.example.com/agent-card");
    const fallback = sharedOriginAgent("101", "https://shared.example.com/agent-card");
    await enqueueCatalogDiscoveryPage(env.DB as unknown as D1DatabaseLike, [representative], {
      nowMs: NOW,
      source: "header",
    });
    await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 1,
      maxDeclarations: 4,
      fetchAgent: async () => representative,
    });
    await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 2,
      maxDeclarations: 4,
      fetchAgent: async () => representative,
    });

    await enqueueCatalogDiscoveryPage(env.DB as unknown as D1DatabaseLike, [fallback], {
      nowMs: NOW + 3,
      source: "sweep",
    });
    await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 4,
      maxDeclarations: 4,
      fetchAgent: async () => fallback,
    });
    await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 4.5,
      maxDeclarations: 4,
      fetchAgent: async () => fallback,
    });

    const retired = { ...representative, metadataUri: "ipfs://metadata/100/2", metadataUpdatedAt: NOW + 2, indexEndpoints: [] };
    await enqueueCatalogDiscoveryPage(env.DB as unknown as D1DatabaseLike, [retired], {
      nowMs: NOW + 5,
      source: "reconciliation",
    });
    const retirement = await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 6,
      maxDeclarations: 4,
      fetchAgent: async () => retired,
    });
    expect(retirement).toMatchObject({ status: "completed", declarationsRetired: 1, d1Queries: 7 });

    expect(await env.DB.prepare(`SELECT representativeAgentKey
      FROM catalog_endpoints WHERE endpoint = 'https://shared.example.com/agent-card'`).first())
      .toEqual({ representativeAgentKey: "eip155:56:101" });
    expect(await env.DB.prepare(`SELECT declarationState
      FROM catalog_agent_endpoints WHERE agentKey = 'eip155:56:100'`).first())
      .toEqual({ declarationState: "removed" });
  });

  it("processes every declaration in bounded resumable batches and never schedules external links", async () => {
    const large = agent("42", 30);
    await enqueueCatalogDiscoveryPage(env.DB as unknown as D1DatabaseLike, [large], {
      nowMs: NOW,
      source: "header",
    });
    const fetchAgent = async () => large;
    const summaries = [];
    for (let index = 0; index < 4; index += 1) {
      summaries.push(await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
        nowMs: NOW + index + 1,
        maxDeclarations: 12,
        fetchAgent,
        leaseOwner: `test-${index}`,
      }));
    }

    expect(summaries.map(({ status }) => status)).toEqual(["partial", "partial", "retiring", "completed"]);
    expect(summaries.every(({ d1Queries }) => d1Queries <= 40)).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_agent_endpoints").first())
      .toMatchObject({ count: 30 });
    expect(await env.DB.prepare("SELECT nextDeclarationIndex, declarationCount, status FROM catalog_ingest_tasks").first())
      .toMatchObject({ nextDeclarationIndex: 30, declarationCount: 30, status: "completed" });
    expect(await env.DB.prepare(`SELECT role, externalKind, eligibility, representativeAgentKey, nextProbeAt
      FROM catalog_endpoints WHERE declaredProtocol = 'web'`).first()).toMatchObject({
      role: "external",
      externalKind: "website",
      eligibility: "unsupported",
      representativeAgentKey: null,
      nextProbeAt: null,
    });
  });

  it("retires replaced declarations in bounded batches without deleting their history", async () => {
    const original = agent("42", 30, 1);
    await enqueueCatalogDiscoveryPage(env.DB as unknown as D1DatabaseLike, [original], { nowMs: NOW, source: "header" });
    for (let index = 0; index < 4; index += 1) {
      await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
        nowMs: NOW + index + 1,
        maxDeclarations: 12,
        fetchAgent: async () => original,
      });
    }
    const replacement = agent("42", 1, 2);
    await enqueueCatalogDiscoveryPage(env.DB as unknown as D1DatabaseLike, [replacement], {
      nowMs: NOW + 100,
      source: "reconciliation",
    });
    const states = [];
    for (let index = 0; index < 5; index += 1) {
      states.push((await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
        nowMs: NOW + 101 + index,
        maxDeclarations: 12,
        fetchAgent: async () => replacement,
      })).status);
    }

    expect(states).toEqual(["retiring", "retiring", "retiring", "completed", "idle"]);
    expect(await env.DB.prepare(`SELECT declarationState, COUNT(*) AS count
      FROM catalog_agent_endpoints GROUP BY declarationState ORDER BY declarationState`).all()).toMatchObject({
      results: [
        { declarationState: "current", count: 1 },
        { declarationState: "removed", count: 30 },
      ],
    });
  });

  it("suspends a previous commerce admission when metadata removes the commerce endpoint", async () => {
    const original = agent("77", 2, 1);
    original.indexEndpoints![0] = {
      protocol: "erc8183_http",
      endpoint: "https://agent-77.example.com/1/commerce",
      rawProtocol: "ERC-8183",
      source: "services",
      sourceIndex: 0,
    };
    await enqueueCatalogDiscoveryPage(env.DB as unknown as D1DatabaseLike, [original], { nowMs: NOW, source: "header" });
    await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 1, maxDeclarations: 4, fetchAgent: async () => original,
    });
    await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 2, maxDeclarations: 4, fetchAgent: async () => original,
    });
    expect(await env.DB.prepare("SELECT state FROM catalog_agent_admission WHERE agentKey = 'eip155:56:77'").first())
      .toEqual({ state: "candidate" });

    const replacement = agent("77", 1, 2);
    await enqueueCatalogDiscoveryPage(env.DB as unknown as D1DatabaseLike, [replacement], {
      nowMs: NOW + 100, source: "reconciliation",
    });
    await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 101, maxDeclarations: 4, fetchAgent: async () => replacement,
    });
    await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 102, maxDeclarations: 4, fetchAgent: async () => replacement,
    });

    expect(await env.DB.prepare(`SELECT state, endpointKey, reasonCode
      FROM catalog_agent_admission WHERE agentKey = 'eip155:56:77'`).first()).toEqual({
      state: "suspended", endpointKey: null, reasonCode: "NO_COMMERCE_ENDPOINT",
    });
  });

  it("backs off directed tracking while trust8004 has not indexed the registration", async () => {
    await env.DB.prepare(`INSERT INTO catalog_directed_tracking (
      agentKey, chainId, agentId, txHash, blockNumber, status, registeredAt, createdAt, updatedAt
    ) VALUES ('eip155:56:99', 56, '99', ?, '123', 'registered', ?, ?, ?)`)
      .bind(`0x${"9".repeat(64)}`, NOW, NOW, NOW).run();
    await env.DB.prepare(`INSERT INTO catalog_ingest_tasks (
      agentKey, metadataVersion, nextDeclarationIndex, declarationCount, status, requestedBy,
      priority, generationStartedAt, updatedAt, attemptCount, retryAt
    ) VALUES ('eip155:56:99', 'directed:pending', 0, 0, 'pending', 'directed', 100, ?, ?, 0, 0)`)
      .bind(NOW, NOW).run();

    const missing = await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW,
      maxDeclarations: 4,
      fetchAgent: async () => { throw new CatalogHttpError(404, "https://trust8004.example/agents/56:99"); },
    });
    expect(missing).toMatchObject({ status: "failed", errorCode: "TRUST8004_NOT_INDEXED" });
    expect(await env.DB.prepare(`SELECT status, attemptCount, retryAt, errorCode
      FROM catalog_ingest_tasks WHERE agentKey = 'eip155:56:99'`).first()).toMatchObject({
      status: "failed",
      attemptCount: 1,
      retryAt: NOW + 10_000,
      errorCode: "TRUST8004_NOT_INDEXED",
    });
    expect(await env.DB.prepare(`SELECT errorCode FROM catalog_directed_tracking
      WHERE agentKey = 'eip155:56:99'`).first()).toEqual({ errorCode: "TRUST8004_NOT_INDEXED" });

    const beforeRetry = await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 9_999,
      maxDeclarations: 4,
      fetchAgent: async () => agent("99"),
    });
    expect(beforeRetry.status).toBe("idle");

    const indexed = agent("99");
    const ingested = await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 10_000,
      maxDeclarations: 4,
      fetchAgent: async () => indexed,
    });
    expect(ingested.status).toBe("retiring");
    const completed = await processNextCatalogIngestTask(env.DB as unknown as D1DatabaseLike, {
      nowMs: NOW + 10_001,
      maxDeclarations: 4,
      fetchAgent: async () => indexed,
    });
    expect(completed.status).toBe("completed");
    expect(await env.DB.prepare(`SELECT status, listedAt, errorCode FROM catalog_directed_tracking
      WHERE agentKey = 'eip155:56:99'`).first()).toMatchObject({
      status: "listed",
      listedAt: NOW + 10_001,
      errorCode: null,
    });
  });
});
