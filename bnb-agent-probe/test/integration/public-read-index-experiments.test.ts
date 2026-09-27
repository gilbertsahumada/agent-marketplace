import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { catalogAgentsResponse, catalogFacetsResponse, catalogSummaryResponse } from "../../src/routes/catalog-agents";
import { metered, type ReadRecord } from "./d1-meter";
import { NOW, seedPublicEnriched, completeProjectionFixture } from "./public-enriched-fixture";

const req = (path: string) => new Request(`https://worker.test${path}`);
const metrics = (log: ReadRecord[]) => ({ queries: log.length, rowsRead: log.reduce((n,r)=>n+r.rowsRead,0),
  rowsWritten: log.reduce((n,r)=>n+r.rowsWritten,0), durationMs: log.reduce((n,r)=>n+r.durationMs,0) });
const meta = (result: unknown) => (result as { meta?: unknown }).meta;

beforeEach(async () => {
  // This file owns these ephemeral diagnostic indexes. Reset them between
  // fixture sizes; production indexes and the source baseline stay untouched.
  for (const name of ["experiment_public_endpoints","experiment_public_capabilities","experiment_public_agents","experiment_public_completed"]) {
    await env.DB.prepare(`DROP INDEX IF EXISTS ${name}`).run();
  }
});

// Diagnostic indexes exist only inside this isolated test database. No index
// is added to the migration until creation and steady-state economics qualify.
it("measures permitted covering indexes at 20000 enriched agents", async () => {
  await seedPublicEnriched(20_000);
  await completeProjectionFixture();
  const installed: string[] = [];
  const rewrite = (query: string) => installed.reduce((text,table) => text.replaceAll(`catalog_${table} ${table === "endpoints" ? "e" : table === "seller_capabilities" ? "c" : "a"}`,
    `catalog_${table} ${table === "endpoints" ? "e" : table === "seller_capabilities" ? "c" : "a"} INDEXED BY experiment_public_${table === "seller_capabilities" ? "capabilities" : table}`),query);
  async function read() {
    const log: ReadRecord[] = [];
    const d1 = metered({ prepare: query => env.DB.prepare(rewrite(query)) },log);
    const list = await (await catalogAgentsResponse(req("/catalog-agents?status=declared&scope=hiring&limit=24"),d1,NOW)).json();
    const facets = await (await catalogFacetsResponse(req("/catalog-facets?status=declared&scope=hiring"),d1,NOW)).json();
    const summary = await (await catalogSummaryResponse(req("/catalog-summary"),d1,NOW)).json();
    return { list,facets,summary,log };
  }
  const before = await read();
  for (const [name,definition] of [
    ["experiment_public_endpoints", "catalog_endpoints(endpointKey,role,eligibility,validationProtocol,declaredProtocol)"],
    ["experiment_public_capabilities", "catalog_seller_capabilities(agentKey,endpointKey,state,compatibilityState,schemaHash,compatibilityExpiresAt,compatibilityCheckedAt,capabilityExpiresAt,lastSuccessAt,consecutiveFailures,lastErrorCode,lastAttemptId)"],
    ["experiment_public_agents", "catalog_agents(chainId,indexState,agentKey,agentId,categoriesJson,priority,registeredAt,name)"],
  ] as const) {
    const created = await env.DB.prepare(`CREATE INDEX ${name} ON ${definition}`).run();
    installed.push(name === "experiment_public_capabilities" ? "seller_capabilities" : name.slice("experiment_public_".length));
    const after = await read();
    expect({ list:after.list,facets:after.facets,summary:after.summary }).toEqual({ list:before.list,facets:before.facets,summary:before.summary });
    expect(metrics(after.log).rowsWritten).toBe(0);
    console.log(JSON.stringify({ operation:"covering-index-experiment", index:name, creation:meta(created),
      before:metrics(before.log),after:metrics(after.log),queries:after.log.filter(r=>r.sql.includes("endpoint_flags")||r.sql.includes("scope_flags")).map(r=>({ rowsRead:r.rowsRead,durationMs:r.durationMs })) }));
    const fact = after.log.find(r=>r.sql.includes("endpoint_flags"))!;
    console.log(JSON.stringify({ operation:"covering-index-plan",index:name,plan:(await env.DB.prepare(`EXPLAIN QUERY PLAN ${rewrite(fact.sql)}`).bind(...fact.values).all()).results }));
  }
  // The schema index is affected by capability writes, not by payload-only
  // platform observations. Record real D1 metadata instead of estimating it.
  console.log(JSON.stringify({ operation:"covering-index-capability-update",meta:meta(await env.DB.prepare("UPDATE catalog_seller_capabilities SET compatibilityExpiresAt=compatibilityExpiresAt+1 WHERE agentKey='eip155:56:100000'").run()) }));
},300_000);

it.each([2_000,20_000])("measures a sparse completed-jobs index at %i enriched agents", async count => {
  await seedPublicEnriched(count);
  await completeProjectionFixture();
  const oldLog: ReadRecord[] = [];
  const before = await (await catalogFacetsResponse(req("/catalog-facets?status=declared"),metered(env.DB,oldLog),NOW)).json();
  const creation = meta(await env.DB.prepare("CREATE UNIQUE INDEX experiment_public_completed ON catalog_public_agent_metrics(agentKey,projectionVersion) WHERE jobCompleted>0").run());
  const afterLog: ReadRecord[] = [];
  const d1 = metered({ prepare: query => env.DB.prepare(query.replaceAll("catalog_public_agent_metrics m", "catalog_public_agent_metrics m INDEXED BY experiment_public_completed")) },afterLog);
  const after = await (await catalogFacetsResponse(req("/catalog-facets?status=declared"),d1,NOW)).json();
  expect(after).toEqual(before);
  console.log(JSON.stringify({ operation:"sparse-completed-index",count,creation,before:metrics(oldLog),after:metrics(afterLog) }));
},300_000);
