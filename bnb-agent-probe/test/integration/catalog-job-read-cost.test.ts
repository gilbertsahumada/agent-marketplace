import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { catalogAgentsResponse } from "../../src/routes/catalog-agents";
import { metered, type ReadRecord } from "./d1-meter";
import { clearCatalogFixtures } from "./catalog-fixtures";

const NOW = 1_800_000_000_000;
beforeAll(async () => {
  await clearCatalogFixtures();
  await env.DB.prepare(`INSERT INTO catalog_agents
    (agentKey, agentId, chainId, name, metadataState, indexState, firstSeenAt, lastSeenAt)
    VALUES ('eip155:56:123', '123', 56, 'Read cost fixture', 'ok', 'current', ?, ?)`)
    .bind(NOW, NOW).run();
  for (const chain of [56, 97]) {
    await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20000)
      INSERT INTO commerce_jobs (chainId,jobId,client,provider,evaluator,budget,expiredAt,status,hook,firstSeenAt,updatedAt)
      SELECT ?,x,'client','provider','evaluator','1',?,3,'hook',?,? FROM n`)
      .bind(chain, NOW, NOW, NOW).run();
  }
  for (const [index, job] of ['1', '1', '2', '0003', '4x', ' 5', '6.0', '7e0', null].entries()) {
    await env.DB.prepare(`INSERT INTO hire_events
      (eventKey,agentId,chainId,phase,provenance,jobId,occurredAt)
      VALUES (?, '123', 56, 'funded', 'chain_verified', ?, ?)`)
      .bind(`event-${index}`,job,NOW).run();
  }
}, 60_000);

it('uses indexed job lookups without changing canonical text ID matching or counting duplicate events', async () => {
  const log: ReadRecord[] = [];
  const response = await catalogAgentsResponse(new Request('https://worker.test/catalog-agents?chain=56&inventory=registry'), metered(env.DB,log),NOW,2);
  expect(response.status).toBe(200);
  await response.json();
  const entry = log.find(row => row.sql.includes('COUNT(DISTINCT CASE') && row.sql.includes('commerce_jobs'))!;
  expect(entry).toBeDefined();
  const current = await env.DB.prepare(entry.sql).bind(...entry.values).all();
  const reference = await env.DB.prepare(`SELECT h.agentId, COUNT(DISTINCT CAST(j.jobId AS TEXT)) AS total,
    COUNT(DISTINCT CASE WHEN j.status=3 THEN CAST(j.jobId AS TEXT) END) AS completed,
    COUNT(DISTINCT CASE WHEN j.status=1 THEN CAST(j.jobId AS TEXT) END) AS funded,
    COUNT(DISTINCT CASE WHEN j.status=2 THEN CAST(j.jobId AS TEXT) END) AS submitted
    FROM hire_events h JOIN commerce_jobs j ON h.chainId=j.chainId AND h.jobId=CAST(j.jobId AS TEXT)
    WHERE h.chainId=56 AND h.agentId='123' AND h.provenance='chain_verified' GROUP BY h.agentId`).all();
  expect(current.results?.map(Object.values)).toEqual(reference.results?.map(Object.values));
  expect(reference.results?.[0]).toMatchObject({total:2,completed:2});
  console.log(JSON.stringify({rowsRead:entry.rowsRead,rowsWritten:entry.rowsWritten,plan:(await env.DB.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).bind(...entry.values).all()).results}));
  expect(entry.rowsRead).toBeLessThan(200);
  expect(entry.rowsWritten).toBe(0);
});
