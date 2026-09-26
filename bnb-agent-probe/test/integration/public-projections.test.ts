import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { clearCatalogFixtures } from "./catalog-fixtures";
import { backfillPublicProjections, PUBLIC_PROJECTION_CURSOR_KEY, readPublicAgentMetrics,
  readPublicProjectedObservations, readPublicProjectionCoverage, publicProjectionsReady } from "../../src/catalog/public-projections";
import { createDatabase, readEffectiveCatalogObservationsForAgents,
  readEffectiveAgentObservations, readLatestBrowserObservationsForAgents } from "../../src/db/orm";
import { metered, type ReadRecord } from "./d1-meter";
import type { D1Database } from "../../src/types";
import type { D1DatabaseLike } from "../../src/db/client";
import { agentMetricsUpsert } from "../../src/catalog/public-projection-sql";

const AGENT = "eip155:56:123";
const ENDPOINT = "endpoint-123";
const NOW = 1_800_000_000_000;

beforeEach(async () => {
  await clearCatalogFixtures();
  await env.DB.prepare("DELETE FROM catalog_public_endpoint_evidence").run();
  await env.DB.prepare("DELETE FROM catalog_public_agent_metrics").run();
  await env.DB.prepare("UPDATE runtime_state SET textValue=? WHERE key=?")
    .bind(JSON.stringify({ version: 1, phase: "evidence", agentKey: "", endpointScope: "" }), PUBLIC_PROJECTION_CURSOR_KEY).run();
});

async function observation(options: { agent?: string; endpoint?: string | null; at?: number; outcome?: string; source?: string; kind?: string; level?: string; details?: string } = {}) {
  const result = await env.DB.prepare(`INSERT INTO catalog_observations
    (agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel,detailsJson)
    VALUES (?,?,'a2a',?,?,?,?,0,?,?,?) RETURNING id`)
    .bind(options.agent ?? AGENT, options.endpoint === undefined ? ENDPOINT : options.endpoint,
      options.source ?? "worker_probe", options.outcome ?? "protocol_valid", options.at ?? NOW,
      (options.at ?? NOW) + 1000, options.kind ?? "protocol", options.level ?? "platform_observed", options.details ?? "{}").first<{ id: number }>();
  return result!.id;
}

async function evidence(agent = AGENT, endpoint = ENDPOINT) {
  return env.DB.prepare("SELECT * FROM catalog_public_endpoint_evidence WHERE agentKey=? AND endpointScope=?")
    .bind(agent, endpoint).first();
}

async function fullBackfillCost(label: string, indexName?: string, expectedBatches = 1004) {
  const ddlLog: ReadRecord[] = [];
  if (indexName) {
    const index = await env.DB.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?").bind(indexName).first<{ sql: string }>();
    await env.DB.prepare(`DROP INDEX ${indexName}`).run();
    await metered(env.DB,ddlLog).prepare(index!.sql).run();
  }
  await env.DB.prepare("UPDATE runtime_state SET textValue=? WHERE key=?")
    .bind(JSON.stringify({ version: 1, phase: "evidence", agentKey: "", endpointScope: "" }), PUBLIC_PROJECTION_CURSOR_KEY).run();
  // Start with empty target tables; index creation is metered separately above.
  await env.DB.prepare("DELETE FROM catalog_public_endpoint_evidence").run();
  await env.DB.prepare("DELETE FROM catalog_public_agent_metrics").run();
  const log: ReadRecord[] = [];
  let batches = 0, cursor;
  do {
    cursor = (await backfillPublicProjections(metered(env.DB,log),{ batchSize: 40, nowMs: NOW })).cursor;
    batches++;
  } while (cursor.phase !== 'complete' && batches < 1010);
  expect(cursor.phase).toBe('complete');
  const totals = (records: ReadRecord[]) => ({ queries: records.length,
    reads: records.reduce((sum,row)=>sum+row.rowsRead,0), writes: records.reduce((sum,row)=>sum+row.rowsWritten,0) });
  console.log('PUBLIC_PROJECTION_FULL_20K_COST',JSON.stringify({ label, batches, index: totals(ddlLog), backfillAndValidation: totals(log) }));
  expect(batches).toBe(expectedBatches);
  expect(totals(log).writes).toBeLessThanOrEqual(21_004);
  return { batches, index: totals(ddlLog), backfillAndValidation: totals(log) };
}

it("projects the latest platform attempt and historical success by observedAt then id", async () => {
  const success = await observation();
  await observation({ at: NOW - 1, outcome: "timeout" });
  const latest = await observation({ outcome: "timeout" });
  expect(await evidence()).toMatchObject({ latestPlatformId: latest, latestPlatformSuccessId: success,
    latestPlatformOutcome: "timeout", platformAttemptCount: 3, projectionVersion: 1 });
  await observation({ agent: "eip155:56:999" });
  expect(await evidence()).toMatchObject({ platformAttemptCount: 3 });
});

it("keeps browser validation families and quote capability probes distinct", async () => {
  const browserProtocol = await observation({ source: "browser_reported", level: "user_observed" });
  const browserReachability = await observation({ source: "browser_reported", level: "user_observed", kind: "reachability", outcome: "cors_blocked" });
  const buyer = await observation({ source: "browser_reported", level: "cryptographic", kind: "quote", outcome: "quote_verified" });
  const probe = await observation({ kind: "quote", level: "cryptographic", outcome: "quote_verified", details: '{"quoteKind":"capability_probe"}' });
  const chain = await observation({ endpoint: null, source: "chain_read", kind: "chain", level: "onchain", outcome: "erc8183_detected" });
  expect(await evidence()).toMatchObject({ browserProtocolId: browserProtocol, browserReachabilityId: browserReachability,
    browserQuoteId: buyer, latestQuoteId: probe, latestQuoteIsBuyer: 0, hasBuyerVerifiedQuoteEver: 1,
    hasBrowserProtocolSuccessEver: 1, platformAttemptCount: 0 });
  expect(await evidence(AGENT, "")).toMatchObject({ latestChainId: chain });
});

it("rebuilds only affected tuples for corrections and deletes without stale winners", async () => {
  const first = await observation();
  const second = await observation({ at: NOW + 1, outcome: "timeout" });
  await env.DB.prepare("DROP TRIGGER catalog_observations_no_update").run();
  await env.DB.prepare("DROP TRIGGER catalog_observations_no_delete").run();
  await env.DB.prepare("UPDATE catalog_observations SET agentKey=? WHERE id=?").bind("eip155:97:123", second).run();
  expect(await evidence()).toMatchObject({ latestPlatformId: first, platformAttemptCount: 1 });
  expect(await evidence("eip155:97:123")).toMatchObject({ latestPlatformId: second, platformAttemptCount: 1 });
  await env.DB.prepare("DELETE FROM catalog_observations WHERE id=?").bind(first).run();
  expect(await evidence()).toBeNull();
});

it("keeps ignored duplicate inserts from inflating observation counts", async () => {
  const id = await observation();
  await env.DB.prepare(`INSERT OR IGNORE INTO catalog_observations
    SELECT * FROM catalog_observations WHERE id=?`).bind(id).run();
  expect(await evidence()).toMatchObject({ platformAttemptCount: 1 });
});

it("keeps legacy malformed observation details readable through the existing serializer", async () => {
  const id = await observation({ kind: "quote", level: "cryptographic", outcome: "quote_verified", details: "legacy-not-json" });
  expect(await evidence()).toMatchObject({ latestQuoteId: id, latestQuoteIsBuyer: 1, hasBuyerVerifiedQuoteEver: 1 });
  expect((await readPublicProjectedObservations(env.DB,[AGENT],"agent"))[0]?.detailsJson).toBe("legacy-not-json");
});

it("preserves append-only source guards and corrects quote-family history when repair is explicitly permitted", async () => {
  const buyer = await observation({ kind: "quote", level: "cryptographic", outcome: "quote_verified" });
  const probe = await observation({ kind: "quote", level: "cryptographic", outcome: "quote_verified", at: NOW + 1,
    details: '{"quoteKind":"capability_probe"}' });
  await expect(env.DB.prepare("DELETE FROM catalog_observations WHERE id=?").bind(buyer).run()).rejects.toThrow("append-only");
  await expect(env.DB.prepare("UPDATE catalog_observations SET outcome='quote_rejected' WHERE id=?").bind(probe).run()).rejects.toThrow("append-only");
  await env.DB.prepare("DROP TRIGGER catalog_observations_no_update").run();
  await env.DB.prepare("DROP TRIGGER catalog_observations_no_delete").run();
  await env.DB.prepare("DELETE FROM catalog_observations WHERE id=?").bind(buyer).run();
  expect(await evidence()).toMatchObject({ latestQuoteId: probe, latestQuoteIsBuyer: 0, hasBuyerVerifiedQuoteEver: 0 });
  await env.DB.prepare("UPDATE catalog_observations SET detailsJson='{}' WHERE id=?").bind(probe).run();
  expect(await evidence()).toMatchObject({ latestQuoteId: probe, latestQuoteIsBuyer: 1, hasBuyerVerifiedQuoteEver: 1 });
});

async function request(options: { agent?: string; kind?: string; caller?: string; status?: string } = {}) {
  const result = await env.DB.prepare(`INSERT INTO catalog_quote_requests
    (requestHash,agentKey,endpointKey,transport,kind,status,callerKey,createdAt)
    VALUES (lower(hex(randomblob(16))),?,?,'a2a',?,?,?,?) RETURNING id`)
    .bind(options.agent ?? AGENT, ENDPOINT, options.kind ?? "buyer_quote", options.status ?? "queued", options.caller ?? "buyer", NOW)
    .first<{ id: number }>();
  return result!.id;
}

async function attempt(requestId: number, id: string, startedAt: number) {
  await env.DB.prepare(`INSERT INTO catalog_quote_attempts(id,requestId,executor,status,startedAt)
    VALUES (?,?,'worker','pending',?)`).bind(id, requestId, startedAt).run();
}

async function job(chain: number, id: number, status = 3) {
  await env.DB.prepare(`INSERT INTO commerce_jobs
    (chainId,jobId,client,provider,evaluator,budget,expiredAt,status,hook,firstSeenAt,updatedAt)
    VALUES (?,?,'client','provider','evaluator','1',?,?,'hook',?,?)`).bind(chain,id,NOW,status,NOW,NOW).run();
}

async function hire(key: string, jobId: string, chain = 56, provenance = "chain_verified", agent = "123") {
  await env.DB.prepare(`INSERT INTO hire_events(eventKey,agentId,chainId,phase,provenance,jobId,occurredAt)
    VALUES (?,?,?,'funded',?,?,?)`).bind(key,agent,chain,provenance,jobId,NOW).run();
}

it("counts logical buyer requests and derives lastAttemptAt from attempts, including corrections", async () => {
  const first = await request({ status: "succeeded" });
  const second = await request();
  const probe = await request({ kind: "capability_probe", status: "succeeded" });
  const migration = await request({ caller: "migration", status: "succeeded" });
  await attempt(first, "first", 1);
  await attempt(first, "fallback", 9);
  await attempt(second, "second", 5);
  await attempt(probe, "probe", 999);
  await attempt(migration, "migration", 9999);
  expect((await readPublicAgentMetrics(env.DB, [AGENT]))[0]).toMatchObject({ buyerQuoteRequestCount: 2,
    buyerQuoteSuccessCount: 1, buyerQuoteLastAttemptAt: 9 });
  await env.DB.prepare("DELETE FROM catalog_quote_attempts WHERE id='fallback'").run();
  expect((await readPublicAgentMetrics(env.DB, [AGENT]))[0]).toMatchObject({ buyerQuoteLastAttemptAt: 5 });
  await env.DB.prepare("UPDATE catalog_quote_requests SET agentKey=?,status='succeeded' WHERE id=?")
    .bind("eip155:97:123", second).run();
  expect((await readPublicAgentMetrics(env.DB, [AGENT]))[0]).toMatchObject({ buyerQuoteRequestCount: 1, buyerQuoteLastAttemptAt: 1 });
  expect((await readPublicAgentMetrics(env.DB, ["eip155:97:123"]))[0]).toMatchObject({ buyerQuoteRequestCount: 1,
    buyerQuoteSuccessCount: 1, buyerQuoteLastAttemptAt: 5 });
  await env.DB.prepare("UPDATE catalog_quote_attempts SET startedAt=12 WHERE id='second'").run();
  expect((await readPublicAgentMetrics(env.DB, ["eip155:97:123"]))[0]).toMatchObject({ buyerQuoteLastAttemptAt: 12 });
  await env.DB.prepare("DELETE FROM catalog_quote_requests WHERE id=?").bind(first).run();
  expect((await readPublicAgentMetrics(env.DB, [AGENT]))[0]).toMatchObject({ buyerQuoteRequestCount: 0,
    buyerQuoteSuccessCount: 0, buyerQuoteLastAttemptAt: null });
});

it("counts distinct canonical chain-verified jobs regardless of event/job arrival order", async () => {
  await hire("before-job", "1");
  expect((await readPublicAgentMetrics(env.DB, [AGENT]))[0]).toMatchObject({ jobCount: 0 });
  await job(56, 1);
  await job(97, 1, 2);
  await job(56, 2, 1);
  await hire("duplicate", "1");
  await hire("other-chain", "1", 97);
  await hire("after-job", "2");
  for (const [i,id] of ["0001", "1x", " 1", "1.0", "1e0"].entries()) await hire(`noncanonical-${i}`,id);
  await hire("unverified", "2", 56, "marketplace_observed", "999");
  expect((await readPublicAgentMetrics(env.DB, [AGENT]))[0]).toMatchObject({ jobCount: 2, jobCompleted: 1, jobFunded: 1, jobSubmitted: 0 });
  expect((await readPublicAgentMetrics(env.DB, ["eip155:97:123"]))[0]).toMatchObject({ jobCount: 1, jobCompleted: 0, jobSubmitted: 1 });
  // The older global commerce counter has different noncanonical-ID semantics;
  // remove these fixtures before moving status so its unrelated cleanup balances.
  await env.DB.prepare("DELETE FROM hire_events WHERE eventKey LIKE 'noncanonical-%'").run();
  await env.DB.prepare("UPDATE commerce_jobs SET status=2 WHERE chainId=56 AND jobId=1").run();
  await env.DB.prepare("DELETE FROM hire_events WHERE eventKey='duplicate'").run();
  expect((await readPublicAgentMetrics(env.DB, [AGENT]))[0]).toMatchObject({ jobCount: 2, jobCompleted: 0, jobSubmitted: 1 });
  await env.DB.prepare("UPDATE hire_events SET provenance='marketplace_observed' WHERE eventKey='before-job'").run();
  expect((await readPublicAgentMetrics(env.DB, [AGENT]))[0]).toMatchObject({ jobCount: 1, jobSubmitted: 0 });
  await env.DB.prepare("UPDATE hire_events SET provenance='chain_verified' WHERE eventKey='before-job'").run();
  await env.DB.prepare("DELETE FROM hire_events WHERE eventKey='before-job'").run();
  await env.DB.prepare("DELETE FROM commerce_jobs WHERE chainId=56 AND jobId=2").run();
  expect((await readPublicAgentMetrics(env.DB, [AGENT]))[0]).toMatchObject({ jobCount: 0, jobFunded: 0 });
});

it("returns exactly the old observation families without reading historical partitions", async () => {
  for (let index = 0; index < 30; index += 1) await observation({ at: NOW + index, outcome: index % 2 ? "timeout" : "protocol_valid" });
  await observation({ source: "browser_reported", level: "user_observed" });
  await observation({ source: "browser_reported", level: "user_observed", kind: "reachability" });
  await observation({ kind: "quote", level: "cryptographic", outcome: "quote_verified" });
  await observation({ endpoint: null, source: "chain_read", kind: "chain", level: "onchain", outcome: "erc8183_detected" });
  const db = createDatabase(env.DB as unknown as D1DatabaseLike);
  const logs: ReadRecord[] = [];
  const measured = metered(env.DB, logs);
  expect(await readPublicProjectedObservations(measured,[AGENT],"platform",[ENDPOINT]))
    .toEqual(await readEffectiveCatalogObservationsForAgents(db,[AGENT],[ENDPOINT]));
  expect(await readPublicProjectedObservations(measured,[AGENT],"browser"))
    .toEqual(await readLatestBrowserObservationsForAgents(db,[AGENT]));
  expect(await readPublicProjectedObservations(measured,[AGENT],"agent"))
    .toEqual(await readEffectiveAgentObservations(db,[AGENT]));
  expect(logs.reduce((sum,row) => sum+row.rowsWritten,0)).toBe(0);
  expect(logs.reduce((sum,row) => sum+row.rowsRead,0)).toBeLessThan(60);
});

it("backfills absolute historical tuples including retired declarations, and resumes between batches", async () => {
  await observation();
  await observation({ at: NOW - 10 });
  await observation({ agent: "eip155:97:123", endpoint: null, source: "chain_read", kind: "chain", level: "onchain", outcome: "erc8183_detected" });
  await request({ status: "succeeded" });
  // Simulate an upgrade: sources exist, projections have not yet been built.
  await env.DB.prepare("DELETE FROM catalog_public_endpoint_evidence").run();
  await env.DB.prepare("DELETE FROM catalog_public_agent_metrics").run();
  const first = await backfillPublicProjections(env.DB,{ batchSize: 1, nowMs: NOW });
  expect(first).toMatchObject({ processed: 1, applied: true, cursor: { phase: "evidence" } });
  await observation({ at: NOW + 1, outcome: "timeout" });
  for (let i = 0; i < 20 && (await readPublicProjectionCoverage(env.DB))?.phase !== "complete"; i += 1)
    await backfillPublicProjections(env.DB,{ batchSize: 1, nowMs: NOW + i + 1 });
  expect(await readPublicProjectionCoverage(env.DB)).toMatchObject({ phase: "complete" });
  expect(await evidence()).toMatchObject({ platformAttemptCount: 3, latestPlatformOutcome: "timeout" });
  expect(await evidence("eip155:97:123", "")).toMatchObject({ latestChainId: expect.any(Number) });
  expect((await readPublicAgentMetrics(env.DB,[AGENT]))[0]).toMatchObject({ buyerQuoteRequestCount: 1, buyerQuoteSuccessCount: 1 });
  expect(await backfillPublicProjections(env.DB,{ nowMs: NOW })).toMatchObject({ processed: 0, applied: false });
});

it("sees a concurrent event inside backfill's SQL transaction and cannot regress another runner's cursor", async () => {
  await observation();
  await observation({ agent: "eip155:97:123" });
  await env.DB.prepare("DELETE FROM catalog_public_endpoint_evidence").run();
  let beforeBatch = true;
  const concurrent: D1Database = { prepare: env.DB.prepare.bind(env.DB), async batch(statements) {
    if (beforeBatch) {
      beforeBatch = false;
      await observation({ at: NOW + 1, outcome: "timeout" });
      await backfillPublicProjections(env.DB,{ batchSize: 2, nowMs: NOW + 1 });
    }
    return env.DB.batch!(statements);
  } };
  const stale = await backfillPublicProjections(concurrent,{ batchSize: 1, nowMs: NOW });
  expect(stale).toMatchObject({ processed: 0, applied: false, cursor: { agentKey: "eip155:97:123" } });
  expect(await evidence()).toMatchObject({ platformAttemptCount: 2, latestPlatformOutcome: "timeout" });
});

it("rolls back projection reconstruction and cursor together if a batch fails", async () => {
  await observation();
  await env.DB.prepare("DELETE FROM catalog_public_endpoint_evidence").run();
  const before = await readPublicProjectionCoverage(env.DB);
  const failing: D1Database = { prepare: env.DB.prepare.bind(env.DB), async batch(statements) {
    return env.DB.batch!([...statements, env.DB.prepare("SELECT * FROM nonexistent_failure_table")]);
  } };
  await expect(backfillPublicProjections(failing,{ nowMs: NOW })).rejects.toThrow();
  expect(await evidence()).toBeNull();
  expect(await readPublicProjectionCoverage(env.DB)).toEqual(before);
});

it.each(["changed", "missing", "orphan"])("refuses readiness when source equivalence finds %s evidence", async (fault) => {
  await observation();
  if (fault === "changed") await env.DB.prepare("UPDATE catalog_public_endpoint_evidence SET platformAttemptCount=999").run();
  if (fault === "missing") await env.DB.prepare("DELETE FROM catalog_public_endpoint_evidence").run();
  if (fault === "orphan") await env.DB.prepare("INSERT INTO catalog_public_endpoint_evidence(agentKey,endpointScope) VALUES ('orphan','retired')").run();
  const cursor = { version: 1, phase: "verify_evidence", agentKey: "", endpointScope: "" };
  await env.DB.prepare("UPDATE runtime_state SET textValue=? WHERE key=?").bind(JSON.stringify(cursor), PUBLIC_PROJECTION_CURSOR_KEY).run();
  await expect(backfillPublicProjections(env.DB,{ nowMs: NOW })).rejects.toThrow("equivalence validation failed");
  expect(await readPublicProjectionCoverage(env.DB)).toEqual(cursor);
  expect(await publicProjectionsReady(env.DB)).toBe(false);
});

it("refuses readiness when metrics disagree and rechecks equivalence atomically at checkpoint", async () => {
  await request();
  const cursor = { version: 1, phase: "verify_metrics", agentKey: "", endpointScope: "" };
  await env.DB.prepare("UPDATE runtime_state SET textValue=? WHERE key=?").bind(JSON.stringify(cursor), PUBLIC_PROJECTION_CURSOR_KEY).run();
  const concurrent: D1Database = { prepare: env.DB.prepare.bind(env.DB), async batch(statements) {
    await env.DB.prepare("UPDATE catalog_public_agent_metrics SET buyerQuoteRequestCount=999 WHERE agentKey=?").bind(AGENT).run();
    return env.DB.batch!(statements);
  } };
  expect(await backfillPublicProjections(concurrent,{ nowMs: NOW })).toMatchObject({ applied: false, processed: 0 });
  expect(await readPublicProjectionCoverage(env.DB)).toEqual(cursor);
  expect(await publicProjectionsReady(env.DB)).toBe(false);
  await expect(backfillPublicProjections(env.DB,{ nowMs: NOW })).rejects.toThrow("equivalence validation failed");
});

it("keeps validated coverage ready after trigger-maintained late inserts and fails closed on missing metadata", async () => {
  await observation();
  expect(await publicProjectionsReady(env.DB)).toBe(false);
  for (let i = 0; i < 12 && !await publicProjectionsReady(env.DB); i++) await backfillPublicProjections(env.DB,{ nowMs: NOW });
  expect(await publicProjectionsReady(env.DB)).toBe(true);
  await observation({ at: NOW - 1 });
  await observation({ agent: "eip155:56:001", endpoint: null });
  expect(await publicProjectionsReady(env.DB)).toBe(true);
  expect(await evidence()).toMatchObject({ platformAttemptCount: 2 });
  await env.DB.prepare("UPDATE runtime_state SET textValue='invalid' WHERE key=?").bind(PUBLIC_PROJECTION_CURSOR_KEY).run();
  expect(await publicProjectionsReady(env.DB)).toBe(false);
  await env.DB.prepare("DELETE FROM runtime_state WHERE key=?").bind(PUBLIC_PROJECTION_CURSOR_KEY).run();
  expect(await publicProjectionsReady(env.DB)).toBe(false);
  await env.DB.prepare("INSERT INTO runtime_state(key,textValue,updatedAt) VALUES (?, '{}', 0)").bind(PUBLIC_PROJECTION_CURSOR_KEY).run();
});

it("meters projection write amplification and bounds the normal insert cost independently of history length", async () => {
  await observation();
  const trigger = await env.DB.prepare("SELECT sql FROM sqlite_schema WHERE name='catalog_public_observation_insert'").first<{ sql: string }>();
  const index = await env.DB.prepare("SELECT sql FROM sqlite_schema WHERE name='idx_catalog_observations_public_tuple'").first<{ sql: string }>();
  const insert = async (db: D1Database, at: number) => db.prepare(`INSERT INTO catalog_observations
    (agentKey,endpointKey,protocol,source,outcome,observedAt,durationMs,validationKind,verificationLevel)
    VALUES (?,?,'a2a','worker_probe','protocol_valid',?,0,'protocol','platform_observed')`).bind(AGENT,ENDPOINT,at).run();
  const before: ReadRecord[] = [];
  await env.DB.prepare("DROP TRIGGER catalog_public_observation_insert").run();
  await env.DB.prepare("DROP INDEX idx_catalog_observations_public_tuple").run();
  try { await insert(metered(env.DB,before),NOW + 1); }
  finally {
    await env.DB.prepare(index!.sql).run();
    await env.DB.prepare(trigger!.sql).run();
  }
  // An absolute backfill reconciles the baseline INSERT made with triggers off.
  await backfillPublicProjections(env.DB,{ nowMs: NOW });
  const short: ReadRecord[] = [];
  await insert(metered(env.DB,short),NOW + 2);
  for (let i = 0; i < 300; i += 1) await insert(env.DB,NOW + 3 + i);
  const long: ReadRecord[] = [];
  await insert(metered(env.DB,long),NOW + 1000);
  console.log("PUBLIC_PROJECTION_INSERT_COST", JSON.stringify({ baseline: before[0], short: short[0], long: long[0] }));
  expect(long[0]!.rowsRead).toBeLessThanOrEqual(short[0]!.rowsRead + 10);
  expect(long[0]!.rowsWritten).toBe(short[0]!.rowsWritten);
  expect(short[0]!.rowsWritten - before[0]!.rowsWritten).toBeLessThanOrEqual(2);
  expect(await evidence()).toMatchObject({ platformAttemptCount: 304 });
});

it("bounds a resumed 40-tuple backfill batch halfway through 20,000 historical tuples", async () => {
  const trigger = await env.DB.prepare("SELECT sql FROM sqlite_schema WHERE name='catalog_public_observation_insert'").first<{ sql: string }>();
  await env.DB.prepare("DROP TRIGGER catalog_public_observation_insert").run();
  try {
    await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<40000)
      INSERT INTO catalog_observations(agentKey,endpointKey,protocol,source,outcome,observedAt,durationMs,validationKind,verificationLevel)
      SELECT 'eip155:56:'||printf('%08d',(x+1)/2),'endpoint','a2a','worker_probe','protocol_valid',?,0,'protocol','platform_observed' FROM n`)
      .bind(NOW).run();
  } finally { await env.DB.prepare(trigger!.sql).run(); }
  await env.DB.prepare("UPDATE runtime_state SET textValue=? WHERE key=?")
    .bind(JSON.stringify({ version: 1, phase: "evidence", agentKey: "eip155:56:00010000", endpointScope: "endpoint" }), PUBLIC_PROJECTION_CURSOR_KEY).run();
  const log: ReadRecord[] = [];
  const result = await backfillPublicProjections(metered(env.DB,log),{ batchSize: 40, nowMs: NOW });
  const reads = log.reduce((sum,row) => sum+row.rowsRead,0), writes = log.reduce((sum,row) => sum+row.rowsWritten,0);
  console.log("PUBLIC_PROJECTION_BACKFILL_COST",JSON.stringify({ processed: result.processed, reads, writes, statements: log.map(row => ({ sql: row.sql.slice(0,90), reads: row.rowsRead, writes: row.rowsWritten })) }));
  expect(result.processed).toBe(40);
  expect(reads).toBeLessThan(10_000);
  expect(writes).toBeLessThanOrEqual(81);
  await env.DB.prepare("UPDATE runtime_state SET textValue=? WHERE key=?")
    .bind(JSON.stringify({ version: 1, phase: "verify_evidence", agentKey: "eip155:56:00010000", endpointScope: "endpoint" }), PUBLIC_PROJECTION_CURSOR_KEY).run();
  const validationLog: ReadRecord[] = [];
  expect(await backfillPublicProjections(metered(env.DB,validationLog),{ batchSize: 40, nowMs: NOW })).toMatchObject({ processed: 40, applied: true });
  const validationReads = validationLog.reduce((sum,row) => sum+row.rowsRead,0);
  const validationWrites = validationLog.reduce((sum,row) => sum+row.rowsWritten,0);
  console.log("PUBLIC_PROJECTION_VALIDATION_COST",JSON.stringify({ processed: 40, reads: validationReads, writes: validationWrites }));
  expect(validationReads).toBeLessThan(10_000);
  expect(validationWrites).toBe(1);
  await fullBackfillCost('evidence', 'idx_catalog_observations_public_tuple');
}, 30_000);

it("bounds metrics cursor and validation cost halfway through 20,000 request/job agents", async () => {
  const triggers = (await env.DB.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name IN ('catalog_public_request_insert','catalog_public_hire_insert')").all<{name:string;sql:string}>()).results!;
  expect(triggers).toHaveLength(2);
  for (const trigger of triggers) await env.DB.prepare(`DROP TRIGGER ${trigger.name}`).run();
  try {
    await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20000)
      INSERT INTO catalog_quote_requests(requestHash,agentKey,endpointKey,transport,kind,status,callerKey,createdAt)
      SELECT 'hash-'||x,'eip155:56:'||printf('%08d',x),'endpoint','a2a','buyer_quote','succeeded','buyer',? FROM n`).bind(NOW).run();
    await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20000)
      INSERT INTO hire_events(eventKey,agentId,chainId,phase,provenance,jobId,occurredAt)
      SELECT 'hire-'||x,printf('%08d',x),56,'funded','chain_verified',CAST(x AS TEXT),? FROM n`).bind(NOW).run();
  } finally { for (const trigger of triggers) await env.DB.prepare(trigger.sql).run(); }
  for (const phase of ['metrics','verify_metrics']) {
    if (phase === 'metrics') {
      const plan = (await env.DB.prepare('EXPLAIN QUERY PLAN '+agentMetricsUpsert("SELECT ? AS agentKey")).bind('eip155:56:00010001').all<{detail:string}>()).results!;
      expect(plan.filter(row=>row.detail.includes('SEARCH r ')).every(row=>row.detail.includes('idx_catalog_quote_requests_agent'))).toBe(true);
    }
    await env.DB.prepare("UPDATE runtime_state SET textValue=? WHERE key=?")
      .bind(JSON.stringify({ version: 1, phase, agentKey: "eip155:56:00010000", endpointScope: "" }), PUBLIC_PROJECTION_CURSOR_KEY).run();
    const log: ReadRecord[] = [];
    const result = await backfillPublicProjections(metered(env.DB,log),{ batchSize: 40, nowMs: NOW });
    const reads = log.reduce((sum,row) => sum+row.rowsRead,0), writes = log.reduce((sum,row) => sum+row.rowsWritten,0);
    console.log("PUBLIC_PROJECTION_METRICS_COST",JSON.stringify({ phase, processed: result.processed, reads, writes, statements: log.map(row=>({sql:row.sql.slice(0,90),reads:row.rowsRead,writes:row.rowsWritten})) }));
    expect(result.processed).toBe(40);
    expect(reads).toBeLessThan(10_000);
    expect(writes).toBeLessThanOrEqual(phase==='metrics'?81:1);
  }
  await fullBackfillCost('metrics');
}, 30_000);

it('profiles the remote cardinalities locally with concentrated history, without fetching source payloads', async () => {
  // Cardinalities captured once on 2026-09-25. This synthetic arrangement is
  // deliberately skewed, not a claim that production has this exact distribution.
  const names = ['catalog_public_observation_insert','catalog_public_request_insert','catalog_public_attempt_insert','catalog_public_hire_insert'];
  const triggers = (await env.DB.prepare(`SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name IN (${names.map(()=>'?').join(',')})`).bind(...names).all<{name:string;sql:string}>()).results!;
  expect(triggers).toHaveLength(names.length);
  for (const trigger of triggers) await env.DB.prepare(`DROP TRIGGER ${trigger.name}`).run();
  try {
    await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<58085)
      INSERT INTO commerce_jobs(chainId,jobId,client,provider,evaluator,budget,expiredAt,status,hook,firstSeenAt,updatedAt)
      SELECT 56,x,'client','provider','evaluator','1',?,3,'hook',?,? FROM n`).bind(NOW,NOW,NOW).run();
    await env.DB.prepare(`WITH RECURSIVE agents(a) AS (SELECT 1 UNION ALL SELECT a+1 FROM agents WHERE a<255),
      nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<2398)
      INSERT INTO catalog_observations(agentKey,endpointKey,protocol,source,outcome,observedAt,durationMs,validationKind,verificationLevel)
      SELECT 'eip155:56:'||a,'endpoint','a2a','worker_probe','timeout',?+n,0,'protocol','platform_observed'
      FROM agents JOIN nums ON n<=CASE WHEN a=1 THEN 2398 WHEN a<=124 THEN 22 ELSE 21 END`).bind(NOW).run();
    await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<851)
      INSERT INTO catalog_quote_requests(id,requestHash,agentKey,endpointKey,transport,kind,status,callerKey,createdAt)
      SELECT x,'cardinality-'||x,'eip155:56:'||CASE WHEN x<=127 THEN 1 WHEN x<=540 THEN x-126 ELSE x-524 END,
        'endpoint','a2a',CASE WHEN x<=104 OR x BETWEEN 128 AND 142 THEN 'buyer_quote' ELSE 'capability_probe' END,'succeeded','buyer',? FROM n`).bind(NOW).run();
    await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<853)
      INSERT INTO catalog_quote_attempts(id,requestId,executor,status,startedAt)
      SELECT 'cardinality-'||x,CASE WHEN x<=827 THEN x ELSE x-827 END,'worker','succeeded',?+x FROM n`).bind(NOW).run();
    await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<19)
      INSERT INTO hire_events(eventKey,agentId,chainId,phase,provenance,jobId,occurredAt)
      SELECT 'cardinality-'||x,CAST(CASE WHEN x<=15 THEN 50001 WHEN x<=17 THEN 50002 ELSE 50003 END AS TEXT),56,'funded',
        CASE WHEN x<=13 OR x IN (16,18) THEN 'chain_verified' ELSE 'marketplace_observed' END,CAST(x AS TEXT),? FROM n`).bind(NOW).run();
  } finally { for (const trigger of triggers) await env.DB.prepare(trigger.sql).run(); }
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_observations').first()).toEqual({n:7855});
  expect(await env.DB.prepare('SELECT COUNT(DISTINCT agentKey) n FROM catalog_quote_requests').first()).toEqual({n:414});
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM catalog_quote_requests WHERE kind='buyer_quote'").first()).toEqual({n:119});
  const cost = await fullBackfillCost('production-cardinality-synthetic-skew', 'idx_catalog_observations_public_tuple',20);
  const nanoUsd = cost.index.reads+cost.backfillAndValidation.reads+1000*(cost.index.writes+cost.backfillAndValidation.writes)+cost.batches*5000;
  console.log('PUBLIC_PROJECTION_PRODUCTION_SHAPE_COST',JSON.stringify({...cost,controlNanoUsd:cost.batches*5000,nanoUsd}));
  expect(nanoUsd).toBeLessThan(12_000_000);
}, 30_000);
