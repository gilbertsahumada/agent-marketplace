import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { catalogAgentsResponse, catalogFacetsResponse, catalogSummaryResponse } from "../../src/routes/catalog-agents";
import { catalogAgentResponse } from "../../src/routes/catalog-agent";
import { catalogAgentsResponse as oldList, catalogFacetsResponse as oldFacets, catalogSummaryResponse as oldSummary } from "../fixtures/public-read-reference/catalog-agents";
import { catalogAgentResponse as oldDetail } from "../fixtures/public-read-reference/catalog-agent";
import { PUBLIC_PROJECTION_CURSOR_KEY } from "../../src/catalog/public-projections";
import { NOW, seedPublicEnriched, completeProjectionFixture } from "./public-enriched-fixture";
import { metered, type ReadRecord } from "./d1-meter";

const req = (path: string) => new Request(`https://worker.test${path}`);
beforeEach(async () => { await seedPublicEnriched(30); });

it.each([null,"evidence","verify_metrics"])("fails closed without historical fallback for coverage %s", async phase => {
  if (phase === null) await env.DB.prepare("DELETE FROM runtime_state WHERE key=?").bind(PUBLIC_PROJECTION_CURSOR_KEY).run();
  else await env.DB.prepare("UPDATE runtime_state SET textValue=? WHERE key=?")
    .bind(JSON.stringify({ version: 1, phase, agentKey: "", endpointScope: "" }),PUBLIC_PROJECTION_CURSOR_KEY).run();
  for (const [path, read] of [["/catalog-agents",catalogAgentsResponse],["/catalog-facets",catalogFacetsResponse],["/catalog-summary",catalogSummaryResponse],["/catalog-agent/100000",catalogAgentResponse]] as const) {
    const log: ReadRecord[] = [];
    const response = await read(req(path),metered(env.DB,log),NOW);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(log).toHaveLength(1);
    expect(log[0]!.sql).toContain("runtime_state");
    expect(log[0]!.rowsWritten).toBe(0);
  }
});

it("preserves all public families, scoped facets, paging and exact expiration", async () => {
  await completeProjectionFixture();
  for (const now of [NOW,NOW+1000,NOW+3600000]) {
    for (const query of ["", "scope=hiring", "scope=evaluation", "status=requestable", "status=quote_capable",
      "status=completed_jobs", "status=quote_failed", "status=failed", "status=pending", "status=mcp_only",
      "protocol=a2a&protocol=mcp&category=grid_trading&category=rebalancing", "reachability=live", "reachability=historical",
      "reachability=browser_observed", "commerce=suspended", "quote=verified", "quote=expired", "quote=missing",
      "latestFailure=true", "q=100000", "q=Agent%201&inventory=registry", "chain=97"]) {
      const [list, reference, facets, referenceFacets] = await Promise.all([
        catalogAgentsResponse(req(`/catalog-agents?${query}&limit=3`),env.DB,now),
        oldList(req(`/catalog-agents?${query}&limit=3`),env.DB,now),
        catalogFacetsResponse(req(`/catalog-facets?${query}`),env.DB,now),
        oldFacets(req(`/catalog-facets?${query}`),env.DB,now),
      ]);
      expect(await list.json(),`${query} at ${now}`).toEqual(await reference.json());
      expect(await facets.json(),`facets ${query} at ${now}`).toEqual(await referenceFacets.json());
    }
    expect(await (await catalogSummaryResponse(req("/catalog-summary"),env.DB,now)).json())
      .toEqual(await (await oldSummary(req("/catalog-summary"),env.DB,now)).json());
    for (const id of ["100000","100004","100006","100022"]) {
      expect(await (await catalogAgentResponse(req(`/catalog-agent/${id}`),env.DB,now)).json())
        .toEqual(await (await oldDetail(req(`/catalog-agent/${id}`),env.DB,now)).json());
    }
  }
}, 120_000);

it("preserves cursor and page ordering with sparse quote/job metrics", async () => {
  await completeProjectionFixture();
  for (const query of ["status=declared", "status=declared&scope=hiring", "inventory=registry", "chain=97"]) {
    const first = await (await catalogAgentsResponse(req(`/catalog-agents?${query}&limit=3`),env.DB,NOW)).json() as { nextCursor: string | null };
    expect(first).toEqual(await (await oldList(req(`/catalog-agents?${query}&limit=3`),env.DB,NOW)).json());
    for (const pagination of ["page=2","page=999", ...(first.nextCursor ? [`cursor=${encodeURIComponent(first.nextCursor)}`] : [])]) {
      const path = `/catalog-agents?${query}&limit=3&${pagination}`;
      expect(await (await catalogAgentsResponse(req(path),env.DB,NOW)).json(),path)
        .toEqual(await (await oldList(req(path),env.DB,NOW)).json());
    }
  }
});

it("deduplicates multiple categories per agent without multiplying endpoint facts", async () => {
  await completeProjectionFixture();
  for (const categories of [[],["grid_trading","grid_trading","rebalancing","unknown"],
    ["rebalancing","grid_trading","yield_optimisation","health_factor_monitoring"]]) {
    await env.DB.prepare("UPDATE catalog_agents SET categoriesJson=? WHERE agentKey='eip155:56:100000'")
      .bind(JSON.stringify(categories)).run();
    for (const query of ["status=declared","category=grid_trading","category=rebalancing&category=grid_trading"]) {
      expect(await (await catalogAgentsResponse(req(`/catalog-agents?${query}&limit=3`),env.DB,NOW)).json())
        .toEqual(await (await oldList(req(`/catalog-agents?${query}&limit=3`),env.DB,NOW)).json());
      expect(await (await catalogFacetsResponse(req(`/catalog-facets?${query}`),env.DB,NOW)).json())
        .toEqual(await (await oldFacets(req(`/catalog-facets?${query}`),env.DB,NOW)).json());
    }
  }
});

it("reflects late events and shared endpoint blocks immediately without projection fan-out", async () => {
  await completeProjectionFixture();
  const declaration = await env.DB.prepare(`SELECT endpointKey FROM catalog_agent_endpoints
    WHERE agentKey='eip155:56:100000' AND endpointKey IN (SELECT endpointKey FROM catalog_endpoints WHERE protocol='a2a')`).first<{ endpointKey: string }>();
  const key = declaration!.endpointKey;
  const assertEquivalent = async () => {
    for (const query of ["status=declared", "scope=hiring", "scope=evaluation", "status=failed", "quote=verified", "latestFailure=true"]) {
      expect(await (await catalogAgentsResponse(req(`/catalog-agents?${query}&limit=3`),env.DB,NOW)).json())
        .toEqual(await (await oldList(req(`/catalog-agents?${query}&limit=3`),env.DB,NOW)).json());
      expect(await (await catalogFacetsResponse(req(`/catalog-facets?${query}`),env.DB,NOW)).json())
        .toEqual(await (await oldFacets(req(`/catalog-facets?${query}`),env.DB,NOW)).json());
    }
    expect(await (await catalogSummaryResponse(req("/catalog-summary"),env.DB,NOW)).json())
      .toEqual(await (await oldSummary(req("/catalog-summary"),env.DB,NOW)).json());
  };
  // Arriving later is not newer evidence. Then an observedAt tie uses the
  // monotonic observation id, exactly like the authoritative historical reader.
  for (const [attempt,outcome,observedAt] of [["late","timeout",NOW-86400000],["new","timeout",NOW],["tie","protocol_valid",NOW]] as const) {
    await env.DB.prepare(`INSERT INTO catalog_observations
      (attemptId,agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel)
      VALUES (?,'eip155:56:100000',?,'a2a','worker_probe',?,?,?,1,'protocol','platform_observed')`)
      .bind(attempt,key,outcome,observedAt,NOW+3600000).run();
    await assertEquivalent();
  }
  await env.DB.prepare("UPDATE catalog_endpoints SET eligibility='unsafe',safety='unsafe' WHERE endpointKey=?").bind(key).run();
  await assertEquivalent();
  await env.DB.prepare("UPDATE catalog_seller_capabilities SET state='suspended' WHERE agentKey='eip155:56:100008'").run();
  await assertEquivalent();
});
