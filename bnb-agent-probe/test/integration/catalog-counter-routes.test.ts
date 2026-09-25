import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { catalogAgentsResponse, catalogFacetsResponse, catalogSummaryResponse } from "../../src/routes/catalog-agents";
import { clearCatalogFixtures } from "./catalog-fixtures";
import { metered, type ReadRecord } from "./d1-meter";

const NOW = 1_800_000_000_000;
const SHARED_ENDPOINT = "a".repeat(64);

beforeEach(async () => {
  await clearCatalogFixtures();
  for (const [chain, id, endpointKey, protocol, compatible, state] of [
    [56, "101", SHARED_ENDPOINT, "a2a", true, "current"],
    [56, "102", SHARED_ENDPOINT, "a2a", false, "current"],
    [56, "103", "b".repeat(64), "mcp", true, "current"],
    [56, "104", null, "a2a", false, "current"],
    [56, "105", "c".repeat(64), "a2a", true, "removed"],
    [97, "101", "d".repeat(64), "a2a", true, "current"],
  ] as const) {
    const agentKey = `eip155:${chain}:${id}`;
    await env.DB.prepare(`INSERT INTO catalog_agents
      (agentKey,agentId,chainId,name,categoriesJson,metadataState,indexState,firstSeenAt,lastSeenAt)
      VALUES (?,?,?,?,?,'ok',?,?,?)`)
      .bind(agentKey,id,chain,`Seller ${id}`,JSON.stringify([id === "103" ? "rebalancing" : "grid_trading"]),state,NOW,NOW).run();
    if (!endpointKey) continue;
    await env.DB.prepare(`INSERT OR IGNORE INTO catalog_endpoints
      (endpointKey,protocol,endpoint,safety,declaredProtocol,role,validationProtocol,eligibility,nextProbeAt)
      VALUES (?,?,?,'safe',?,'operational',?,'eligible',0)`)
      .bind(endpointKey,protocol,`https://${endpointKey}.example`,protocol,protocol).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints
      (agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt) VALUES (?,?,'current',?,?)`)
      .bind(agentKey,endpointKey,NOW,NOW).run();
    if (compatible) {
      await env.DB.prepare(`INSERT INTO catalog_seller_capabilities
        (agentKey,endpointKey,transport,state,createdAt,updatedAt,compatibilityState,schemaHash,compatibilityCheckedAt,compatibilityExpiresAt)
        VALUES (?,?,?,'discovered',?,?,'compatible','schema',?,?)`)
        .bind(agentKey,endpointKey,protocol,NOW,NOW,NOW-100,NOW+1000).run();
      await env.DB.prepare(`INSERT INTO catalog_observations
        (agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel)
        VALUES (?,?,?,'worker_probe',?,?,?,?, 'protocol','platform_observed')`)
        .bind(agentKey,endpointKey,protocol,id === "103" ? "timeout" : "protocol_valid",NOW,NOW+1000,1).run();
    }
  }
});

function request(path: string, query = ""): Request {
  return new Request(`https://worker.test/${path}${query ? `?${query}` : ""}`);
}

function assertAggregateOnly(log: ReadRecord[]): void {
  expect(log).toHaveLength(1);
  expect(log[0]!.rowsWritten).toBe(0);
  expect(log[0]!.sql).not.toMatch(/\bLIMIT\b|\bORDER BY\b|ROW_NUMBER/i);
}

describe("aggregate-only public counters", () => {
  it.each([
    [56, false, { hiring: 1, evaluation: 2 }],
    [97, false, { hiring: 0, evaluation: 1 }],
    [97, true, { hiring: 1, evaluation: 0 }],
  ] as const)("matches both legacy scope totals for chain %i and enabled=%s", async (chain, enabled, counts) => {
    const log: ReadRecord[] = [];
    const response = await catalogSummaryResponse(request("catalog-summary",`chain=${chain}`),metered(env.DB,log),NOW,enabled);
    const body = await response.json() as { counts: { hiring: number; evaluation: number } };
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ schemaVersion: 2, chainId: chain, generatedAt: NOW, counts });
    expect(body).not.toHaveProperty("items");
    expect(body).not.toHaveProperty("total");
    assertAggregateOnly(log);
    for (const scope of ["hiring", "evaluation"] as const) {
      const legacy = await catalogAgentsResponse(request("catalog-agents",`chain=${chain}&scope=${scope}&status=declared&limit=1`),env.DB,NOW,2,enabled);
      expect((await legacy.json() as { total: number }).total).toBe(body.counts[scope]);
    }
  });

  it("expires compatibility at the exact deadline without writing state", async () => {
    const log: ReadRecord[] = [];
    const response = await catalogSummaryResponse(request("catalog-summary"),metered(env.DB,log),NOW+1000);
    expect(await response.json()).toMatchObject({ counts: { hiring: 0, evaluation: 3 } });
    assertAggregateOnly(log);
  });

  it("returns zero counts for an empty catalogue without page or enrichment work", async () => {
    await clearCatalogFixtures();
    const summaryLog: ReadRecord[] = [];
    const facetsLog: ReadRecord[] = [];
    expect(await (await catalogSummaryResponse(request("catalog-summary"),metered(env.DB,summaryLog),NOW)).json())
      .toMatchObject({ counts: { hiring: 0, evaluation: 0 } });
    expect(await (await catalogFacetsResponse(request("catalog-facets"),metered(env.DB,facetsLog),NOW)).json())
      .toMatchObject({ facets: { statuses: { declared: 0, requestable: 0, completed_jobs: 0 }, reachability: { live: 0, never: 0 } } });
    assertAggregateOnly(summaryLog);
    assertAggregateOnly(facetsLog);
  });

  it("seeks completed jobs by the numeric primary key while preserving canonical text IDs", async () => {
    for (const chain of [56, 97]) {
      await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20000)
        INSERT INTO commerce_jobs (chainId,jobId,client,provider,evaluator,budget,expiredAt,status,hook,firstSeenAt,updatedAt)
        SELECT ?,x,'client','provider','evaluator','1',?,CASE WHEN x=4 THEN 1 ELSE 3 END,'hook',?,? FROM n`)
        .bind(chain,NOW,NOW,NOW).run();
    }
    for (const [index, [id, job]] of [
      ["101", "1"], ["101", "1"], ["102", "0002"], ["102", "3x"],
      ["102", " 5"], ["102", "6.0"], ["102", "7e0"], ["102", null], ["103", "4"],
    ].entries()) {
      await env.DB.prepare(`INSERT INTO hire_events
        (eventKey,agentId,chainId,phase,provenance,jobId,occurredAt)
        VALUES (?, ?, 56, 'funded', 'chain_verified', ?, ?)`)
        .bind(`counter-event-${index}`,id,job,NOW).run();
    }
    for (const analyzed of [false, true]) {
      if (analyzed) await env.DB.prepare("ANALYZE").run();
      const log: ReadRecord[] = [];
      const result = await catalogFacetsResponse(request("catalog-facets","status=completed_jobs"),metered(env.DB,log),NOW);
      expect(await result.json()).toMatchObject({ facets: { statuses: { completed_jobs: 1 }, categories: { grid_trading: 1, rebalancing: 0 } } });
      assertAggregateOnly(log);
      const entry = log[0]!;
      const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).bind(...entry.values).all<{ detail: string }>();
      const jobPlans = plan.results?.filter(row => row.detail.includes("commerce_jobs"));
      console.log(JSON.stringify({ operation: "completed-job-facets", analyzed, rowsRead: entry.rowsRead, rowsWritten: entry.rowsWritten, d1DurationMs: entry.durationMs, plan: jobPlans }));
      expect(jobPlans?.some(row => row.detail.startsWith("SEARCH commerce_jobs ") && row.detail.includes("chainId=?") && row.detail.includes("jobId=?")),JSON.stringify(jobPlans)).toBe(true);
      expect(entry.rowsRead).toBeLessThan(200);
      if (!analyzed) {
        // Execute the frozen pre-fix predicate too: its text guard must have
        // identical results, but it cannot seek directly by the numeric key.
        const referenceSql = entry.sql.replaceAll('"commerce_jobs"."jobId" = CAST("hire_events"."jobId" AS INTEGER) and ', "");
        expect(referenceSql).not.toBe(entry.sql);
        const referenceLog: ReadRecord[] = [];
        const reference = await metered(env.DB,referenceLog).prepare(referenceSql).bind(...entry.values).all();
        const current = await env.DB.prepare(entry.sql).bind(...entry.values).all();
        expect(current.results).toEqual(reference.results);
        console.log(JSON.stringify({ operation: "completed-job-facets-reference", rowsRead: referenceLog[0]!.rowsRead, rowsWritten: referenceLog[0]!.rowsWritten, d1DurationMs: referenceLog[0]!.durationMs }));
        expect(referenceLog[0]!.rowsRead).toBeGreaterThan(entry.rowsRead);
      }
      const legacy = await catalogAgentsResponse(request("catalog-agents","status=completed_jobs"),env.DB,NOW);
      expect(await legacy.json()).toMatchObject({ total: 1, items: [{ agentId: "101" }] });
    }
  }, 60_000);

  it.each([
    "", "scope=hiring", "scope=evaluation", "q=101", "q=missing",
    "status=requestable&protocol=a2a&protocol=mcp", "reachability=live",
    "category=grid_trading&category=rebalancing&protocol=mcp", "chain=97",
    "commerce=none&quote=missing&latestFailure=false",
  ])("preserves all facet families and filter semantics for %s", async query => {
    const log: ReadRecord[] = [];
    const current = await catalogFacetsResponse(request("catalog-facets",query),metered(env.DB,log),NOW);
    const legacy = await catalogAgentsResponse(request("catalog-agents",`${query}${query ? "&" : ""}facets=true&limit=1`),env.DB,NOW);
    const body = await current.json() as { facets: unknown };
    expect(current.status).toBe(200);
    expect(body.facets).toEqual((await legacy.json() as { facets: unknown }).facets);
    expect(body).not.toHaveProperty("items");
    expect(body).not.toHaveProperty("total");
    assertAggregateOnly(log);
  });

  it.each(["page=1", "scope=hiring", "q=101", "status=declared", "facets=true", "chain=1", "chain=56&chain=97"])
    ("rejects non-chain or malformed summary parameters before D1: %s", async query => {
      const log: ReadRecord[] = [];
      expect((await catalogSummaryResponse(request("catalog-summary",query),metered(env.DB,log),NOW)).status).toBe(400);
      expect(log).toEqual([]);
    });

  it.each(["page=1", "limit=1", "cursor=abc", "facets=true", "protocol=invalid", "chain=56&chain=97"])
    ("rejects pagination or malformed facet parameters before D1: %s", async query => {
      const log: ReadRecord[] = [];
      expect((await catalogFacetsResponse(request("catalog-facets",query),metered(env.DB,log),NOW)).status).toBe(400);
      expect(log).toEqual([]);
    });
});
