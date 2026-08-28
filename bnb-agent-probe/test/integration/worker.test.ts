import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import worker, { createWorker } from "../../src/index";
import { loadConfig } from "../../src/config";
import type { D1DatabaseLike } from "../../src/db/client";
import {
  createBudgetedD1Database,
  D1QueryBudgetExceededError,
} from "../../src/db/query-budget";
import { acquireSchedulerLease } from "../../src/lib/scheduler-lease";
import { recordDailyBudget } from "../../src/db/daily-budget";
import { healthResponse } from "../../src/routes/health";
import { createWp2ScheduledRunner, runWp2Scheduled } from "../../src/scheduled";
import type { Env } from "../../src/types";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM runtime_state").run();
  await env.DB.prepare("DELETE FROM probe_targets").run();
});

describe("WP1 in the Workers runtime", () => {
  it("serves sanitized health from a migrated local D1", async () => {
    const response = await worker.fetch(
      new Request("https://worker.test/health"),
      env,
      createExecutionContext(),
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      plan: "free",
      schedulerMode: "single_phase",
      killSwitch: true,
      d1: { available: true },
    });
    expect(JSON.stringify(body)).not.toContain("SHARED_SECRET");
    expect(JSON.stringify(body)).not.toContain("runId");
  });

  it("has exactly the five WP1 application tables", async () => {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN (
         'probe_targets', 'probe_observations', 'funnel_snapshots',
         'hire_events', 'runtime_state'
       )
       ORDER BY name`,
    ).all<{ name: string }>();

    expect((result.results ?? []).map(({ name }) => name)).toEqual([
      "funnel_snapshots",
      "hire_events",
      "probe_observations",
      "probe_targets",
      "runtime_state",
    ]);
  });

  it("seeds the reviewed WP0 funnel snapshot", async () => {
    const snapshot = await env.DB.prepare(
      `SELECT registeredTotal, sourceSha256, blockNumber
       FROM funnel_snapshots`,
    ).first<{ registeredTotal: number; sourceSha256: string; blockNumber: string }>();

    expect(snapshot).toEqual({
      registeredTotal: 309897,
      sourceSha256: "a8149173eeb70fb19a38610e98e4e11ecbce7ccadcfc2c0e6e25fa14a075fe69",
      blockNumber: "118441354",
    });
  });

  it("allows one winner for concurrent lease acquisitions against real D1", async () => {
    const db = env.DB as unknown as D1DatabaseLike;
    const winners = await Promise.all([
      acquireSchedulerLease(db, { runId: "run-a", nowMs: 1_000, expiresAtMs: 10_000 }),
      acquireSchedulerLease(db, { runId: "run-b", nowMs: 1_000, expiresAtMs: 10_000 }),
    ]);

    expect(winners.filter(Boolean)).toHaveLength(1);
  });

  it("does no scheduled D1 work while the kill switch is active", async () => {
    await worker.scheduled(
      { scheduledTime: Date.now(), cron: "*/5 * * * *" },
      env,
      createExecutionContext(),
    );
    const state = await env.DB.prepare("SELECT COUNT(*) AS count FROM runtime_state")
      .first<{ count: number }>();

    expect(state?.count).toBe(0);
  });

  it("enforces the Free D1 query budget inside the Workers runtime", async () => {
    const raw = env.DB as unknown as D1DatabaseLike;
    const { db, budget } = createBudgetedD1Database(raw, 40);

    for (let index = 0; index < 40; index += 1) {
      await db.prepare("SELECT 1").first();
    }

    await expect(db.prepare("SELECT 1").first()).rejects.toBeInstanceOf(
      D1QueryBudgetExceededError,
    );
    expect(budget.used).toBe(40);
  });

  it("atomically records metered usage under the invocation start UTC date", async () => {
    const database = env.DB as unknown as D1DatabaseLike;
    await Promise.all([
      recordDailyBudget(database, {
        startedAtMs: Date.parse("2026-08-28T23:59:59.000Z"),
        finishedAtMs: Date.parse("2026-08-29T00:00:01.000Z"),
        outcome: "completed",
        upstreamRequests: 4,
        d1Queries: 11,
        rowsReadObservedBeforeLedger: 9,
        rowsWrittenObservedBeforeLedger: 5,
      }),
      recordDailyBudget(database, {
        startedAtMs: Date.parse("2026-08-28T12:00:00.000Z"),
        finishedAtMs: Date.parse("2026-08-28T12:00:01.000Z"),
        outcome: "failed",
        upstreamRequests: 1,
        d1Queries: 7,
        rowsReadObservedBeforeLedger: 3,
        rowsWrittenObservedBeforeLedger: 1,
      }),
    ]);

    const row = await env.DB.prepare(
      "SELECT textValue FROM runtime_state WHERE key = 'daily_budget_20260828'",
    ).first<{ textValue: string }>();
    expect(JSON.parse(row?.textValue ?? "{}")).toEqual({
      schemaVersion: 1,
      utcDate: "2026-08-28",
      measurementScope: "worker_metered_before_daily_ledger",
      updatedAt: Date.parse("2026-08-29T00:00:01.000Z"),
      invocations: 2,
      completed: 1,
      failed: 1,
      duplicate: 0,
      locked: 0,
      upstreamRequests: 5,
      d1Queries: 18,
      rowsReadObservedBeforeLedger: 12,
      rowsWrittenObservedBeforeLedger: 6,
    });
  });

  it("uses the runtime fetch binding for a real HEADER invocation", async () => {
    await runWp2Scheduled(
      { scheduledTime: 10_000, cron: "*/5 * * * *" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    );

    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");
    expect(JSON.parse(await runtimeText("last_header_summary") ?? "{}")).toMatchObject({
      phase: "header",
      status: "ok",
      received: 0,
      d1Queries: 5,
    });
  });

  it("runs one Queue phase and deduplicates its scheduled tick in real D1", async () => {
    await env.DB.prepare(
      "INSERT INTO runtime_state (key, textValue, updatedAt) VALUES ('next_scheduler_phase', 'probe', 9000)",
    ).run();
    const activeEnv = { ...env, KILL_SWITCH: "0" } as unknown as Env;
    const firstAck = vi.fn();
    const tick = { schemaVersion: 1, scheduledTime: Date.now() };

    await worker.queue(
      { messages: [{ body: tick, ack: firstAck, retry: vi.fn() }] },
      activeEnv,
      createExecutionContext(),
    );

    expect(firstAck).toHaveBeenCalledOnce();
    expect(await runtimeText("next_scheduler_phase")).toBe("header");
    expect(JSON.parse(await runtimeText("last_probe_summary") ?? "{}")).toMatchObject({
      phase: "probe",
      status: "pending_wp3",
      d1Queries: 7,
    });
    const firstSummary = await runtimeText("last_probe_summary");
    const duplicateAck = vi.fn();

    await worker.queue(
      { messages: [{ body: tick, ack: duplicateAck, retry: vi.fn() }] },
      activeEnv,
      createExecutionContext(),
    );

    expect(duplicateAck).toHaveBeenCalledOnce();
    expect(await runtimeText("last_probe_summary")).toBe(firstSummary);
  });

  it("retries a failed Queue tick once and deduplicates it only after atomic success", async () => {
    let fetchCalls = 0;
    const runner = createWp2ScheduledRunner({
      now: (() => {
        let clock = 20_000;
        return () => clock++;
      })(),
      randomUUID: () => "queue-retry-run",
      fetch: (async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) throw new Error("temporary catalogue failure");
        return Response.json({ items: [], total: 0, limit: 25, offset: 0 });
      }) as typeof fetch,
    });
    const retryWorker = createWorker({ runScheduled: runner });
    const activeEnv = { ...env, KILL_SWITCH: "0" } as unknown as Env;
    const tick = { schemaVersion: 1, scheduledTime: Date.now() };
    const firstAck = vi.fn();

    await expect(retryWorker.queue(
      { messages: [{ body: tick, ack: firstAck, retry: vi.fn() }] },
      activeEnv,
      createExecutionContext(),
    )).rejects.toThrow("temporary catalogue failure");
    expect(firstAck).not.toHaveBeenCalled();

    const retryAck = vi.fn();
    await retryWorker.queue(
      { messages: [{ body: tick, ack: retryAck, retry: vi.fn() }] },
      activeEnv,
      createExecutionContext(),
    );
    expect(retryAck).toHaveBeenCalledOnce();
    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");

    const duplicateAck = vi.fn();
    await retryWorker.queue(
      { messages: [{ body: tick, ack: duplicateAck, retry: vi.fn() }] },
      activeEnv,
      createExecutionContext(),
    );
    expect(duplicateAck).toHaveBeenCalledOnce();
    expect(fetchCalls).toBe(2);
    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");
  });

  it("delays a locked Queue tick, then completes and deduplicates it after lease expiry", async () => {
    await env.DB.prepare(
      `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
       VALUES ('scheduler_lease', 'dead-owner', 30_000, 10_000)`,
    ).run();
    let fetchCalls = 0;
    const runner = createWp2ScheduledRunner({
      now: () => 20_000,
      randomUUID: () => "queue-after-expiry",
      fetch: (async () => {
        fetchCalls += 1;
        return Response.json({ items: [], total: 0, limit: 25, offset: 0 });
      }) as typeof fetch,
    });
    const retryWorker = createWorker({ runScheduled: runner });
    const activeEnv = { ...env, KILL_SWITCH: "0" } as unknown as Env;
    const tick = { schemaVersion: 1, scheduledTime: Date.now() };
    const lockedAck = vi.fn();
    const lockedRetry = vi.fn();

    await retryWorker.queue(
      { messages: [{ body: tick, ack: lockedAck, retry: lockedRetry }] },
      activeEnv,
      createExecutionContext(),
    );
    expect(lockedAck).not.toHaveBeenCalled();
    expect(lockedRetry).toHaveBeenCalledWith({ delaySeconds: 240 });
    expect(await runtimeInteger("last_queue_scheduled_time")).toBeNull();

    await env.DB.prepare(
      "UPDATE runtime_state SET integerValue = 0 WHERE key = 'scheduler_lease'",
    ).run();
    const completedAck = vi.fn();
    await retryWorker.queue(
      { messages: [{ body: tick, ack: completedAck, retry: vi.fn() }] },
      activeEnv,
      createExecutionContext(),
    );
    expect(completedAck).toHaveBeenCalledOnce();
    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");

    const duplicateAck = vi.fn();
    await retryWorker.queue(
      { messages: [{ body: tick, ack: duplicateAck, retry: vi.fn() }] },
      activeEnv,
      createExecutionContext(),
    );
    expect(duplicateAck).toHaveBeenCalledOnce();
    expect(fetchCalls).toBe(1);
    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");
  });

  it("persists a sanitized failure in D1 without advancing state", async () => {
    await env.DB.prepare(
      "INSERT INTO runtime_state (key, textValue, updatedAt) VALUES ('next_scheduler_phase', 'sweep', 9000)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO runtime_state (key, integerValue, updatedAt) VALUES ('sweep_offset', 17, 9000)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO runtime_state (key, textValue, updatedAt) VALUES ('header_high_water', '1000:9', 9000)",
    ).run();
    let clock = 10_000;
    const runner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "failure-run",
      executePhase: async () => {
        throw new Error("secret=https://private.example/token?raw-body");
      },
    });
    const config = loadConfig({ KILL_SWITCH: "0" });

    await expect(runner(
      { scheduledTime: 10_000, cron: "*/5 * * * *" },
      env,
      createExecutionContext(),
      config,
    )).rejects.toThrow();

    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");
    expect(await runtimeInteger("sweep_offset")).toBe(17);
    expect(await runtimeText("header_high_water")).toBe("1000:9");
    const health = await (await healthResponse(env.DB, config, 20_000)).json() as Record<string, unknown>;
    expect(health).toMatchObject({
      status: "degraded",
      lease: { active: false },
      lastPhase: { phase: "sweep", status: "error", errorCode: "PHASE_FAILED" },
    });
    expect(JSON.stringify(health)).not.toContain("private.example");
    expect(JSON.stringify(health)).not.toContain("raw-body");
  });

  it("counts an attempted upstream request in a failed phase summary", async () => {
    const runner = createWp2ScheduledRunner({
      now: () => 10_000,
      randomUUID: () => "failed-upstream-run",
      fetch: async () => new Response("unavailable", { status: 503 }),
    });

    await expect(runner(
      { scheduledTime: 10_000, cron: "*/5 * * * *" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).rejects.toThrow("HTTP 503");

    expect(JSON.parse(await runtimeText("last_header_summary") ?? "{}")).toMatchObject({
      phase: "header",
      status: "error",
      errorCode: "TRUST8004_HTTP_ERROR",
      requests: 1,
    });
  });

  it("records completed and failed scheduler attempts in the daily ledger", async () => {
    let clock = Date.parse("2026-08-28T10:00:00.000Z");
    const successRunner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "daily-success",
      executePhase: async () => {},
    });
    await successRunner(
      { scheduledTime: clock, cron: "queue" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    );

    const failureRunner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "daily-failure",
      executePhase: async () => { throw new Error("controlled failure"); },
    });
    await expect(failureRunner(
      { scheduledTime: clock, cron: "queue" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).rejects.toThrow("controlled failure");

    const row = await env.DB.prepare(
      "SELECT textValue FROM runtime_state WHERE key = 'daily_budget_20260828'",
    ).first<{ textValue: string }>();
    expect(JSON.parse(row?.textValue ?? "{}")).toMatchObject({
      invocations: 2,
      completed: 1,
      failed: 1,
      duplicate: 0,
      locked: 0,
      upstreamRequests: 0,
      d1Queries: 9,
      rowsReadObservedBeforeLedger: expect.any(Number),
      rowsWrittenObservedBeforeLedger: expect.any(Number),
    });
  });

  it("runs HEADER and rolling SWEEP atomically and preserves a removed endpoint", async () => {
    let headerIncludesAgent = true;
    let detailIncludesEndpoint = true;
    const catalogAgent = (agentId: string, includeEndpoint: boolean) => ({
      chainId: 56,
      agentId,
      name: `Agent ${agentId}`,
      registeredAt: 1_000,
      metadataUpdatedAt: 900,
      metadataReasonCode: "ok",
      services: includeEndpoint
        ? [{ name: "ERC-8183", endpoint: "https://seller.example.org/quote" }]
        : [],
      endpoints: [],
    });
    const fetchCatalog = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/agents")) {
        const items = headerIncludesAgent ? [catalogAgent("16", true)] : [];
        return Response.json({
          items,
          total: items.length,
          limit: Number(url.searchParams.get("limit")),
          offset: Number(url.searchParams.get("offset")),
        });
      }
      const agentId = url.pathname.split("56:")[1];
      if (agentId === undefined) return new Response(null, { status: 404 });
      return Response.json(catalogAgent(agentId, agentId === "16" && detailIncludesEndpoint));
    };
    let clock = 10_000;
    const runner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => `run-${clock}`,
      fetch: fetchCatalog as typeof fetch,
    });
    const config = loadConfig({});
    const controller = { scheduledTime: 10_000, cron: "*/5 * * * *" };
    const context = createExecutionContext();

    await runner(controller, env, context, config); // HEADER
    expect(JSON.parse(await runtimeText("last_header_summary") ?? "{}")).toMatchObject({
      candidateTargets: 1,
      materialWrites: 1,
      d1Queries: 7,
    });
    expect(await env.DB.prepare(
      "SELECT declarationState FROM probe_targets WHERE agentId = '16'",
    ).first()).toEqual({ declarationState: "current" });
    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");

    await runner(controller, env, context, config); // SWEEP page 1/2
    expect(await runtimeInteger("sweep_offset")).toBe(4);
    expect(await runtimeText("next_scheduler_phase")).toBe("probe");

    await runner(controller, env, context, config); // WP3 pending, no seller request
    expect(await runtimeText("next_scheduler_phase")).toBe("header");

    headerIncludesAgent = false;
    detailIncludesEndpoint = false;
    await runner(controller, env, context, config); // HEADER, identical target data
    await runner(controller, env, context, config); // SWEEP page 2/2, round complete
    expect(await runtimeInteger("sweep_round")).toBe(1);
    await runner(controller, env, context, config); // WP3 pending
    await runner(controller, env, context, config); // HEADER empty
    await runner(controller, env, context, config); // SWEEP page contains agent 16

    expect(await env.DB.prepare(
      "SELECT declarationState FROM probe_targets WHERE agentId = '16'",
    ).first()).toEqual({ declarationState: "removed" });
    const summary = JSON.parse(await runtimeText("last_sweep_summary") ?? "{}");
    expect(summary).toMatchObject({ requests: 4, removedTargets: 1 });
  });
});

async function runtimeText(key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT textValue FROM runtime_state WHERE key = ?")
    .bind(key)
    .first<{ textValue: string | null }>();
  return row?.textValue ?? null;
}

async function runtimeInteger(key: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT integerValue FROM runtime_state WHERE key = ?")
    .bind(key)
    .first<{ integerValue: number | null }>();
  return row?.integerValue ?? null;
}
