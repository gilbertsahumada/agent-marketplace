import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { catalogAgentsResponse } from "../../src/routes/catalog-agents";
import { metered, type ReadRecord } from "./d1-meter";
import { clearCatalogFixtures } from "./catalog-fixtures";
import { createDatabase, readCatalogAgentEvidence } from "../../src/db/orm";
import { D1AgentIdentityRepository } from "../../src/identity/repository";
import type { D1DatabaseLike } from "../../src/db/client";

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

it('bounds detail job history reads and preserves canonical deduplication', async () => {
  const log: ReadRecord[] = [];
  await readCatalogAgentEvidence(createDatabase(metered(env.DB, log) as unknown as D1DatabaseLike), '123', 50, 56);
  const entry = log.find(row => row.sql.includes('commerce_jobs') && row.sql.includes('count(distinct'))!;
  expect(entry).toBeDefined();
  const result = await env.DB.prepare(entry.sql).bind(...entry.values).all();
  expect(Object.values(result.results![0]!)).toEqual([2, 2, 0, 0]);
  const legacySql = entry.sql.replace('"commerce_jobs"."jobId" = CAST("hire_events"."jobId" AS INTEGER) and ', '');
  expect(legacySql).not.toBe(entry.sql);
  const referenceLog: ReadRecord[] = [];
  const reference = await metered(env.DB, referenceLog).prepare(legacySql).bind(...entry.values).all();
  expect(reference.results).toEqual(result.results);
  console.log(JSON.stringify({ operation: 'detail-job-history', rowsRead: entry.rowsRead,
    rowsWritten: entry.rowsWritten, durationMs: entry.durationMs, before: referenceLog.map(({ rowsRead, rowsWritten, durationMs }) => ({ rowsRead, rowsWritten, durationMs })),
    plan: (await env.DB.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).bind(...entry.values).all()).results }));
  expect(entry.rowsRead).toBeLessThan(200);
  expect(entry.rowsWritten).toBe(0);
});

it.each([20_000, 50_000])('bounds provider lookups for 25 jobs in a %i-job history', async size => {
  if (size > 20_000) await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 20001 UNION ALL SELECT x+1 FROM n WHERE x<?)
    INSERT INTO commerce_jobs (chainId,jobId,client,provider,evaluator,budget,expiredAt,status,hook,firstSeenAt,updatedAt)
    SELECT 56,x,'client','provider','evaluator','1',?,3,'hook',?,? FROM n`)
    .bind(size, NOW, NOW, NOW).run();
  const ids = Array.from({ length: 25 }, (_, i) => String(size - i));
  for (const statistics of ['absent', 'complete', 'partial']) {
    await env.DB.prepare('ANALYZE').run();
    if (statistics !== 'complete') {
      await env.DB.prepare(statistics === 'absent' ? 'DELETE FROM sqlite_stat1'
        : "DELETE FROM sqlite_stat1 WHERE idx <> 'sqlite_autoindex_commerce_jobs_1'").run();
      await env.DB.prepare('ANALYZE sqlite_schema').run();
    }
    const log: ReadRecord[] = [];
    const result = await new D1AgentIdentityRepository(metered(env.DB, log) as unknown as D1DatabaseLike).readJobEvidence(56, ids);
    expect(result.jobs.map(row => row.jobId).sort((a, b) => a - b)).toEqual(ids.map(Number).sort((a, b) => a - b));
    const entry = log.find(row => row.sql.includes('commerce_jobs'))!;
    const referenceLog: ReadRecord[] = [];
    const reference = await metered(env.DB, referenceLog).prepare(entry.sql.replace(' INDEXED BY sqlite_autoindex_commerce_jobs_1', '')).bind(...entry.values).all<{ jobId: number; provider: string }>();
    expect(reference.results?.map(row => row.jobId).sort((a, b) => a - b)).toEqual(result.jobs.map(row => row.jobId).sort((a, b) => a - b));
    console.log(JSON.stringify({ operation: 'job-providers', size, statistics, rowsRead: entry.rowsRead,
      rowsWritten: entry.rowsWritten, durationMs: entry.durationMs, before: referenceLog.map(({ rowsRead, rowsWritten, durationMs }) => ({ rowsRead, rowsWritten, durationMs })),
      plan: (await env.DB.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).bind(...entry.values).all()).results }));
    expect(entry.rowsRead).toBeLessThanOrEqual(200);
    expect(entry.rowsWritten).toBe(0);
  }
});
