import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../src/config";
import { createWorker } from "../../src/index";
import type { D1Database, Env } from "../../src/types";

const NOW = 1_788_000_000_000;
const BUYER = "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52";
const SELLER = "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5";

// Counts D1 statements without changing what they return: a cache hit must
// reach D1 zero times, a miss at least once.
function counted(base: Env, counter: { prepares: number }): Env {
  const db: D1Database = {
    prepare(sql: string) {
      counter.prepares += 1;
      return base.DB.prepare(sql);
    },
  };
  return { ...base, DB: db };
}

async function seedJobs(): Promise<void> {
  for (const [jobId, status] of [[801, 1], [802, 0]] as const) {
    await env.DB.prepare(`INSERT INTO commerce_jobs
      (chainId, jobId, client, provider, evaluator, budget, expiredAt, status, hook, submittedAt, deliverable, firstSeenAt, updatedAt)
      VALUES (56, ?, ?, ?, ?, '10000000000000000', ?, ?, ?, NULL, NULL, ?, ?)`)
      .bind(jobId, BUYER, SELLER, SELLER, NOW + 600_000, status, SELLER, NOW, NOW).run();
  }
  await env.DB.prepare("INSERT INTO runtime_state (key, textValue, integerValue, updatedAt) VALUES ('commerce_cursor_56', NULL, 1085, ?)")
    .bind(NOW).run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM runtime_state").run();
  await env.DB.prepare("DELETE FROM commerce_jobs").run();
});

describe("Commerce GET routes through the worker", () => {
  it.each([
    "/commerce-jobs?chainId=56&chainId=56",
    "/commerce-jobs?chainId=56&limit=1&limit=1",
    "/commerce-summary?chainId=56&chainId=56",
  ])("rejects the duplicated query key in %s with 400 and no caching", async (path) => {
    const app = createWorker({ now: () => NOW });
    const response = await app.fetch(
      new Request(`https://worker.test${path}`),
      { ...env, CATALOG_RESPONSE_CACHE_SECONDS: "300" } as unknown as Env,
      createExecutionContext(),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid_request" });
  }, 30_000); // first fetch in this file pays the route bundle's cold import under a full parallel run

  it("serves the summary from one cache entry for every encoding of the same query", async () => {
    await seedJobs();
    const cachedEnv = { ...env, CATALOG_RESPONSE_CACHE_SECONDS: "300" } as unknown as Env;
    const app = createWorker({ now: () => NOW });

    const first = { prepares: 0 };
    const warm = await app.fetch(
      new Request("https://worker.test/commerce-summary?chainId=%35%36"),
      counted(cachedEnv, first),
      createExecutionContext(),
    );
    expect(warm.status).toBe(200);
    // cachedCatalogResponse rewrites the route's own 30/60 header to the
    // configured window (30 s for the commerce routes) on both directives.
    expect(warm.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=30");
    expect(first.prepares).toBeGreaterThan(0);
    const warmBody = await warm.json() as { protocol: { jobs: number } };
    expect(warmBody.protocol.jobs).toBe(2);

    await env.DB.prepare("DELETE FROM commerce_jobs").run();
    const second = { prepares: 0 };
    const hit = await app.fetch(
      new Request("https://worker.test/commerce-summary?chainId=56"),
      counted(cachedEnv, second),
      createExecutionContext(),
    );
    expect(hit.status).toBe(200);
    expect(second.prepares).toBe(0);
    expect(await hit.json()).toEqual(warmBody);
  });

  it("keys the job list cache on sorted parameters so parameter order does not fork entries", async () => {
    await seedJobs();
    const cachedEnv = { ...env, CATALOG_RESPONSE_CACHE_SECONDS: "300" } as unknown as Env;
    const app = createWorker({ now: () => NOW });

    const warm = await app.fetch(
      new Request("https://worker.test/commerce-jobs?limit=1&chainId=56"),
      cachedEnv,
      createExecutionContext(),
    );
    expect(warm.status).toBe(200);
    const warmBody = await warm.json() as { jobs: Array<{ jobId: string }> };
    expect(warmBody.jobs.map((entry) => entry.jobId)).toEqual(["802"]);

    await env.DB.prepare("DELETE FROM commerce_jobs").run();
    const reads = { prepares: 0 };
    const hit = await app.fetch(
      new Request("https://worker.test/commerce-jobs?chainId=56&limit=1"),
      counted(cachedEnv, reads),
      createExecutionContext(),
    );
    expect(hit.status).toBe(200);
    expect(reads.prepares).toBe(0);
    expect(await hit.json()).toEqual(warmBody);
  });
});

describe("Commerce backfill admin route through the worker", () => {
  // Staging manual-run gate on the Paid profile with staging's write envelope
  // (the test env pins the Free one, which the Paid index sizes do not fit).
  // Message counts derive from the configured jobs-per-run so the assertions
  // follow the Paid pin rather than restate it.
  function adminEnv(overrides: Record<string, unknown> = {}) {
    const send = vi.fn().mockResolvedValue(undefined);
    const target = {
      ...env,
      DEPLOYMENT_ENV: "staging",
      STAGING_MANUAL_RUN: "1",
      SHARED_SECRET: "must-never-leak",
      KILL_SWITCH: "0",
      PRODUCER_KILL_SWITCH: "0",
      COMMERCE_INDEX_ENABLED: "1",
      CLOUDFLARE_WORKERS_PLAN: "paid",
      D1_ROWS_WRITTEN_PER_RUN: "200",
      WP2_QUEUE: { send },
      ...overrides,
    } as unknown as Env;
    return { env: target, send, jobsPerRun: loadConfig(target).commerceIndexJobsPerRun };
  }
  const post = (target: Env, body: string) => createWorker({ now: () => NOW }).fetch(
    new Request("https://worker.test/__admin/commerce-backfill", {
      method: "POST",
      headers: { authorization: "Bearer must-never-leak", "content-type": "application/json" },
      body,
    }),
    target,
    createExecutionContext(),
  );

  it("accepts a well-formed range under the body cap", async () => {
    const { env: target, send, jobsPerRun } = adminEnv();
    const response = await post(target, JSON.stringify({ chainId: 56, fromJobId: 1, toJobId: jobsPerRun + 1 }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ enqueued: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toMatchObject({ kind: "index_jobs", fromJobId: jobsPerRun + 1, toJobId: jobsPerRun + 1 });
  });

  it("rejects a body over 1 KiB before parsing it, even when it would parse", async () => {
    const { env: target, send } = adminEnv();
    const padded = `${JSON.stringify({ chainId: 56, fromJobId: 1, toJobId: 2 })}${" ".repeat(1_024)}`;
    const response = await post(target, padded);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const { env: target, send } = adminEnv();
    const response = await post(target, "{\"chainId\": 56,");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a range that would need more than 100 messages", async () => {
    const { env: target, send, jobsPerRun } = adminEnv();
    const accepted = await post(target, JSON.stringify({ chainId: 56, fromJobId: 1, toJobId: 100 * jobsPerRun }));
    expect(accepted.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(100);
    send.mockClear();
    const rejected = await post(target, JSON.stringify({ chainId: 56, fromJobId: 1, toJobId: 100 * jobsPerRun + 1 }));
    expect(rejected.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("stays hidden while the producer kill switch is on", async () => {
    const { env: target, send } = adminEnv({ PRODUCER_KILL_SWITCH: "1" });
    const response = await post(target, JSON.stringify({ chainId: 56, fromJobId: 1, toJobId: 2 }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a sanitized configuration error when the queue binding is absent", async () => {
    const { env: target } = adminEnv({ WP2_QUEUE: undefined });
    const response = await post(target, JSON.stringify({ chainId: 56, fromJobId: 1, toJobId: 2 }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "invalid_configuration" });
  });
});
