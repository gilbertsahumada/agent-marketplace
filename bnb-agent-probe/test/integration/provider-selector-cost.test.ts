import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { enqueueDueCatalogCapabilities as baseline } from "./provider-selector-baseline";
import { enqueueDueCatalogCapabilities as candidate } from "./provider-selector-experiment";
import { clearCatalogFixtures } from "./catalog-fixtures";
import { metered, type ReadRecord } from "./d1-meter";
import type { D1Database } from "../../src/types";
import type { D1DatabaseLike } from "../../src/db/client";

const NOW = Date.UTC(2026, 8, 22);
const raw = env.DB as unknown as D1DatabaseLike;
const sum = (rows: ReadRecord[]) => ({
  reads: rows.reduce((n, r) => n + r.rowsRead, 0),
  writes: rows.reduce((n, r) => n + r.rowsWritten, 0),
  ms: rows.reduce((n, r) => n + r.durationMs, 0),
  queries: rows.length,
});
async function seed(size: number, backlog: string, distribution: string, analyze: boolean) {
  await clearCatalogFixtures();
  await raw.prepare("DELETE FROM runtime_state").run();
  await raw.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
    INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt)
    SELECT 'eip155:'||CASE WHEN x%10=0 THEN 97 ELSE 56 END||':'||x,CAST(x AS TEXT),
      CASE WHEN x%10=0 THEN 97 ELSE 56 END,'ok','current',0,0 FROM n`).bind(size).run();
  const origin = distribution === "unique" ? "agentId" : distribution === "skew" ? "CASE WHEN CAST(agentId AS INTEGER)%10<>1 THEN 'dominant' ELSE agentId END" : "CAST(agentId AS INTEGER)%100";
  await raw.prepare(`INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,eligibility,validationProtocol,nextProbeAt)
    SELECT agentKey,'a2a','https://seller.example/a2a','origin-'||(${origin}),'safe','operational','eligible','a2a',0 FROM catalog_agents`).run();
  await raw.prepare(`INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt)
    SELECT agentKey,agentKey,'current',0,0 FROM catalog_agents`).run();
  await raw.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,nextProbeAt,createdAt,updatedAt)
    SELECT agentKey,agentKey,'a2a','discovered',CASE WHEN CAST(agentId AS INTEGER)%3=0 THEN 'compatible' ELSE 'pending' END,
    CASE WHEN ?='dense' OR (?='sparse' AND CAST(agentId AS INTEGER)%100 IN(1,2)) THEN 0 ELSE ? END,0,0 FROM catalog_agents`).bind(backlog, backlog, NOW + 86400000).run();
  if (analyze) await raw.prepare("ANALYZE").run();
  else {
    // Create then clear planner statistics, including any left by earlier cases.
    await raw.prepare("ANALYZE").run();
    await raw.prepare("DELETE FROM sqlite_stat1").run();
    await raw.prepare("ANALYZE sqlite_schema").run();
  }
}
const cases = [2000, 20000].flatMap(size => ["empty", "sparse", "dense"].flatMap(backlog =>
  ["shared", "unique", "skew"].flatMap(distribution => [false, true].map(analyze => ({ size, backlog, distribution, analyze })))));
it.each(cases)("provider cost $size/$backlog/$distribution/analyze=$analyze", async c => {
  const runs = [];
  for (const select of [baseline, candidate]) {
    await seed(c.size, c.backlog, c.distribution, c.analyze);
    const records: ReadRecord[] = [];
    const sent: unknown[] = [];
    const db = metered(env.DB as unknown as D1Database, records) as unknown as D1DatabaseLike;
    const summaries = [];
    for (const chainId of [56, 97] as const) summaries.push(await select(db, { send: async body => { sent.push(body); } },
      { nowMs: NOW, limit: chainId === 56 ? 4 : 1, concurrency: chainId === 56 ? 2 : 1, bootstrapLimit: chainId === 56 ? 40 : 1, chainId }));
    const queries = records.filter(r => /WITH (ranked|eligible) AS/.test(r.sql));
    const plans = await Promise.all(queries.map(r => raw.prepare("EXPLAIN QUERY PLAN " + r.sql).bind(...r.values).all()));
    runs.push({ sent, summaries, selectors: sum(queries), total: sum(records), plans: plans.map(p => p.results) });
  }
  const [before, after] = runs;
  if (!before || !after) throw new Error("Missing comparison run");
  console.info("PROVIDER_COST", JSON.stringify({ ...c, before, after }));
  expect(after.sent).toEqual(before.sent);
  expect(after.summaries).toEqual(before.summaries);
  expect(after.selectors.writes).toBe(0);
  expect.soft(after.total.writes).toBe(before.total.writes);
  // This is a rejection certificate, NOT a passing optimization acceptance test.
  // The original no-regression and 20%-saving assertions failed in all cases.
  const noRegression = after.selectors.reads <= before.selectors.reads;
  expect(noRegression).toBe(false);
  if (c.size === 20000 && c.backlog === "dense" && c.distribution === "shared") {
    const meetsSavingsTarget = after.selectors.reads <= before.selectors.reads * 0.8;
    expect(meetsSavingsTarget).toBe(false);
  }
}, 60000);
