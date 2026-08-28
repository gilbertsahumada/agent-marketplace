import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import worker from "../../src/index";
import type { D1DatabaseLike } from "../../src/db/client";
import {
  createBudgetedD1Database,
  D1QueryBudgetExceededError,
} from "../../src/db/query-budget";
import { acquireSchedulerLease } from "../../src/lib/scheduler-lease";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM runtime_state").run();
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
});
