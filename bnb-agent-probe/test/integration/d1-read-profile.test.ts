import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config";
import { createWorker } from "../../src/index";
import { createWp2ScheduledRunner } from "../../src/scheduled";
import type { D1Database, D1PreparedStatement, D1Result, Env } from "../../src/types";
import { clearCatalogFixtures } from "./catalog-fixtures";

// D1 read budget guard: seeds a realistic catalogue volume and measures
// rows_read per statement for each public route, the metric D1's daily Free
// quota counts. Staging read 60M rows in one day (12x the quota) before the
// agent-evidence index and the attempt-count rewrite; the ceilings below hold
// the fixed profile at this scale. Never touches a remote database.

const NOW = 1_788_000_000_000;
const AGENTS = 2_000;
const ENDPOINTS_PER_AGENT = 2;
const OBSERVATIONS_PER_ENDPOINT = 8;

interface ReadRecord { sql: string; rowsRead: number; values: unknown[] }

function metered(db: D1Database, log: ReadRecord[]): D1Database {
  const record = (query: string, result: unknown, values: unknown[] = []): void => {
    const meta = (result as { meta?: { rows_read?: number } }).meta;
    log.push({ sql: query, rowsRead: meta?.rows_read ?? 0, values });
  };
  const wrap = (query: string, statement: D1PreparedStatement, values: unknown[] = []): D1PreparedStatement => ({
    bind: (...bound: unknown[]) => wrap(query, statement.bind(...bound), bound),
    async first<T = Record<string, unknown>>() {
      const result = await statement.all<T>();
      record(query, result, values);
      return result.results?.[0] ?? null;
    },
    async all<T = Record<string, unknown>>() {
      const result = await statement.all<T>();
      record(query, result, values);
      return result;
    },
    async run() {
      const result = await statement.run();
      record(query, result, values);
      return result;
    },
    ...(statement.raw ? {
      async raw<T extends unknown[]>(options?: { columnNames?: boolean }) {
        // raw() returns no meta: execute once through all() to read rows_read
        // and project the rows the way query-budget.ts does, so statements with
        // RETURNING clauses are never executed twice.
        const measured = await statement.all<Record<string, unknown>>();
        record(query, measured, values);
        const rows = measured.results ?? [];
        const projected = rows.map((row) => Object.values(row)) as T[];
        if (options?.columnNames && rows[0]) projected.unshift(Object.keys(rows[0]) as T);
        return projected;
      },
    } : {}),
    __query: query,
    __inner: statement,
  } as D1PreparedStatement & { __query: string; __inner: D1PreparedStatement });
  return {
    prepare: (query: string) => wrap(query, db.prepare(query)),
    ...(db.batch ? {
      async batch<T = unknown>(statements: D1PreparedStatement[]) {
        const results = await db.batch!<T>(statements.map((statement) => (statement as unknown as { __inner?: D1PreparedStatement }).__inner ?? statement));
        results.forEach((result: D1Result<T>, index) => record((statements[index] as unknown as { __query?: string }).__query ?? "batch", result));
        return results;
      },
    } : {}),
  };
}

function hex64(seed: number, salt: string): string {
  return (salt + seed.toString(16).padStart(12, "0")).padEnd(64, "0").slice(0, 64);
}

async function seed(): Promise<void> {
  await clearCatalogFixtures();
  const statements: string[] = [];
  const agentRows: string[] = [];
  const endpointRows: string[] = [];
  const declarationRows: string[] = [];
  const observationRows: string[] = [];
  const admissionRows: string[] = [];
  let attempt = 0;
  for (let index = 0; index < AGENTS; index += 1) {
    const agentId = 100_000 + index;
    const agentKey = `eip155:56:${agentId}`;
    const category = ["grid_trading", "rebalancing", "yield_optimisation", "health_factor_monitoring"][index % 4];
    agentRows.push(`('${agentKey}', '${agentId}', 56, '0x${index.toString(16).padStart(40, "0")}', 'ipfs://meta-${index}', 'Agent ${index}', '["${category}"]', 0, 'ok', 'current', ${NOW - index * 60_000}, '${1_000_000 + index}', ${NOW}, ${NOW}, ${index % 100})`);
    for (let e = 0; e < ENDPOINTS_PER_AGENT; e += 1) {
      const endpointKey = hex64(index * ENDPOINTS_PER_AGENT + e, "e");
      const protocol = e === 0 ? "a2a" : "mcp";
      endpointRows.push(`('${endpointKey}', '${protocol}', 'https://seller-${index}.example/${protocol}', '${hex64(index, "o")}', 'safe', '${agentKey}', ${NOW - 3_600_000}, ${NOW + 3_600_000}, 0, '${protocol}', 'operational', '${protocol}', 'eligible', ${NOW - 3_600_000}, 'protocol_valid', ${NOW - 3_600_000})`);
      declarationRows.push(`('${agentKey}', '${endpointKey}', 'current', ${NOW}, ${NOW}, ${e === 0 ? 80 : 40})`);
      for (let o = 0; o < OBSERVATIONS_PER_ENDPOINT; o += 1) {
        attempt += 1;
        const observedAt = NOW - (OBSERVATIONS_PER_ENDPOINT - o) * 3_600_000;
        const outcome = (index + o) % 5 === 0 ? "timeout" : "protocol_valid";
        observationRows.push(`('attempt-${attempt}', '${agentKey}', '${endpointKey}', '${protocol}', 'worker_probe', '${outcome}', ${observedAt}, ${observedAt + 12 * 3_600_000}, 200, 42, '{}', 'protocol', 'platform_observed')`);
      }
    }
    if (index % 50 === 0) {
      admissionRows.push(`('${agentKey}', 'admitted', 'a2a', '${hex64(index * ENDPOINTS_PER_AGENT, "e")}', 56, '0x${index.toString(16).padStart(40, "0")}', 'seed', NULL)`);
    }
  }
  const chunked = (rows: string[], head: string, size = 200) => {
    for (let offset = 0; offset < rows.length; offset += size) {
      statements.push(`${head} VALUES ${rows.slice(offset, offset + size).join(",")}`);
    }
  };
  chunked(agentRows, "INSERT INTO catalog_agents (agentKey, agentId, chainId, owner, metadataUri, name, categoriesJson, marketplaceConfigured, metadataState, indexState, registeredAt, blockNumber, firstSeenAt, lastSeenAt, priority)");
  chunked(endpointRows, "INSERT INTO catalog_endpoints (endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey, lastProbedAt, nextProbeAt, consecutiveFailures, declaredProtocol, role, validationProtocol, eligibility, lastAttemptAt, lastAttemptOutcome, lastSuccessfulAt)");
  chunked(declarationRows, "INSERT INTO catalog_agent_endpoints (agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority)");
  chunked(observationRows, "INSERT INTO catalog_observations (attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt, httpStatus, durationMs, detailsJson, validationKind, verificationLevel)");
  chunked(admissionRows, "INSERT INTO catalog_agent_admission (agentKey, state, commerceTransport, endpointKey, chainId, provider, configurationVersion, reasonCode)");
  for (let offset = 0; offset < statements.length; offset += 25) {
    await env.DB.batch!(statements.slice(offset, offset + 25).map((statement) => env.DB.prepare(statement)));
  }
}

const REPORT: string[] = [];

async function plan(entry: ReadRecord): Promise<string> {
  try {
    const result = await env.DB.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).bind(...entry.values).all<{ detail: string }>();
    return (result.results ?? []).map((row) => `        | ${row.detail}`).join("\n");
  } catch (error) {
    return `        | plan unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function report(label: string, log: ReadRecord[], explain: number): Promise<void> {
  const total = log.reduce((sum, entry) => sum + entry.rowsRead, 0);
  const lines: string[] = [];
  for (const [index, entry] of log.entries()) {
    lines.push(`    #${index} rows_read=${entry.rowsRead}  ${entry.sql.replaceAll(/\s+/g, " ").slice(0, 110)}`);
    if (index < explain) lines.push(await plan(entry));
  }
  REPORT.push(`## ${label}\n  statements=${log.length} rows_read=${total}\n${lines.join("\n")}`);
}

describe("D1 read profile at catalogue scale", () => {
  beforeAll(async () => {
    await seed();
  }, 120_000);

  it("keeps every public route inside its rows_read ceiling", async () => {
    // Ceilings are ~1.5x the measured profile after the fixes (2,000 agents,
    // 4,000 endpoints, 32,000 observations). The list count(*) still costs a
    // few index rows per agent; the cache window below is what bounds it daily.
    const routes: Array<[string, number]> = [
      ["/catalog-agents", 14_000],
      ["/catalog-agents?status=hireable", 18_000],
      ["/catalog-agents?status=a2a", 40_000],
      ["/catalog-agents?status=mcp&reachability=live", 60_000],
      // Global filter counts are fetched through one fixed URL and cached for
      // five minutes; keep the cold aggregate bounded independently from the
      // much cheaper per-filter catalogue reads.
      ["/catalog-agents?facets=true", 260_000],
      ["/catalog-agent/100042", 600],
    ];
    for (const [route, ceiling] of routes) {
      const log: ReadRecord[] = [];
      const meteredEnv = { ...env, DB: metered(env.DB, log) } as unknown as Env;
      const app = createWorker({ now: () => NOW });
      const response = await app.fetch(new Request(`https://worker.test${route}`), meteredEnv, createExecutionContext());
      expect(response.status).toBe(200);
      await report(`${route}`, log, 3);
      const total = log.reduce((sum, entry) => sum + entry.rowsRead, 0);
      expect(total, `${route}\n${REPORT.at(-1)}`).toBeLessThanOrEqual(ceiling);
    }
  }, 300_000);

  it("serves repeated catalogue reads from the Workers Cache when configured", async () => {
    const probe = `/catalog-agents?q=cache-probe-${NOW}`;
    const cachedEnv = { ...env, CATALOG_RESPONSE_CACHE_SECONDS: "300" } as unknown as Env;
    const app = createWorker({ now: () => NOW });
    const first: ReadRecord[] = [];
    const warm = await app.fetch(new Request(`https://worker.test${probe}`), { ...cachedEnv, DB: metered(env.DB, first) }, createExecutionContext());
    expect(warm.status).toBe(200);
    expect(warm.headers.get("cache-control")).toBe("public, max-age=300, stale-while-revalidate=300");
    expect(first.length).toBeGreaterThan(0);

    const second: ReadRecord[] = [];
    const hit = await app.fetch(new Request(`https://worker.test${probe}`), { ...cachedEnv, DB: metered(env.DB, second) }, createExecutionContext());
    expect(hit.status).toBe(200);
    expect(await hit.json()).toEqual(await warm.json());
    expect(second).toEqual([]);

    const live: ReadRecord[] = [];
    await app.fetch(new Request(`https://worker.test${probe}&limit=1`), { ...env, DB: metered(env.DB, live) } as unknown as Env, createExecutionContext());
    expect(live.length).toBeGreaterThan(0);
  });
});

// One catalogue v2 tick per phase, driven exactly like the queue consumer,
// with the staging Paid pins except the rows-read ceiling (raised so the
// profile measures the full cost instead of failing closed at 3,000).
describe("D1 read profile of the cron tick at catalogue scale", () => {
  const TICK_NOW = NOW + 2 * 3_600_000; // every seeded endpoint is due for a probe
  const STAGING_ROWS_READ_PER_RUN = 3_000;
  const stagingPins = {
    CLOUDFLARE_WORKERS_PLAN: "paid",
    KILL_SWITCH: "0",
    PRODUCER_KILL_SWITCH: "0",
    CATALOG_V2_WRITES_ENABLED: "1",
    CATALOG_PROBE_ENABLED: "1",
    PROBE_GENERAL_EGRESS_APPROVED: "1",
    PROBE_AGENT_ALLOWLIST: "*",
    PROBE_ENDPOINT_ALLOWLIST: "*",
    CATALOG_DISCOVERY_PAGE_SIZE: "15",
    CATALOG_PROBE_BATCH_SIZE: "4",
    CATALOG_PROBE_CONCURRENCY: "2",
    CATALOG_INGEST_TASKS_PER_RUN: "1",
    CATALOG_DECLARATIONS_PER_TASK: "1",
    TRUST8004_REQUESTS_PER_RUN: "4",
    EXTERNAL_SUBREQUESTS_PER_RUN: "15",
    D1_QUERIES_PER_RUN: "40",
    D1_ROWS_WRITTEN_PER_RUN: "200",
    D1_ROWS_READ_PER_RUN: "1000000",
  };
  const upstream: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "trust8004.xyz" && url.pathname.endsWith("/agents")) {
      return Response.json({
        items: [],
        total: 0,
        limit: Number(url.searchParams.get("limit")),
        offset: Number(url.searchParams.get("offset")),
      });
    }
    return new Response(null, { status: 404 });
  };

  beforeAll(async () => {
    // A pending ingest backlog so the claim scan has rows to order.
    const rows: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      rows.push(`('eip155:56:${100_000 + index}', 'v1', 0, 2, 'pending', 'sweep', 0, ${NOW}, NULL, ${NOW}, 0, 0, NULL, NULL, NULL)`);
    }
    await env.DB.prepare(`INSERT INTO catalog_ingest_tasks (agentKey, metadataVersion, nextDeclarationIndex, declarationCount, status, requestedBy, priority, generationStartedAt, upstreamObservedAt, updatedAt, attemptCount, retryAt, errorCode, leaseOwner, leaseExpiresAt) VALUES ${rows.join(",")}`).run();
  });

  it("keeps every phase inside its rows_read ceiling", async () => {
    // Measured after the bounded selection window and the ingest claim index
    // (2,000 agents, 4,000 due endpoints, 200 pending ingest tasks): header 17,
    // sweep 20, probe ~400 rows. Before: 418 / 417 / 12,476.
    const phases: Array<["header" | "sweep" | "probe", number]> = [
      ["header", 200],
      ["sweep", 200],
      ["probe", 1_000],
    ];
    for (const [index, [phase, ceiling]] of phases.entries()) {
      const tickNow = TICK_NOW + index * 60_000;
      await env.DB.prepare(
        `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt) VALUES ('next_scheduler_phase', ?, NULL, ?)
         ON CONFLICT(key) DO UPDATE SET textValue = excluded.textValue, integerValue = NULL, updatedAt = excluded.updatedAt`,
      ).bind(phase, tickNow).run();
      const log: ReadRecord[] = [];
      const runner = createWp2ScheduledRunner({
        now: () => tickNow,
        randomUUID: () => `profile-${phase}`,
        fetch: upstream,
      });
      const outcome = await runner(
        { scheduledTime: tickNow, cron: "* * * * *" },
        { ...env, DB: metered(env.DB, log) } as unknown as Env,
        createExecutionContext(),
        loadConfig(stagingPins),
      );
      await report(`tick:${phase}`, log, 6);
      const summary = await env.DB.prepare(`SELECT textValue FROM runtime_state WHERE key = 'last_${phase}_summary'`).first<{ textValue: string }>();
      expect(outcome, `${phase}\n${summary?.textValue}\n${REPORT.at(-1)}`).toBe("completed");
      const total = log.reduce((sum, entry) => sum + entry.rowsRead, 0);
      expect(total, `${phase}\n${REPORT.at(-1)}`).toBeLessThanOrEqual(ceiling);
      expect(total, `${phase} exceeds the staging D1_ROWS_READ_PER_RUN pin\n${REPORT.at(-1)}`).toBeLessThanOrEqual(STAGING_ROWS_READ_PER_RUN);
    }
  }, 300_000);
});
