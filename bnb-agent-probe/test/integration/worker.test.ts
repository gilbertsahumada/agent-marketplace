import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import worker from "../../src/index";
import { loadConfig } from "../../src/config";
import type { D1DatabaseLike } from "../../src/db/client";
import {
  createBudgetedD1Database,
  D1QueryBudgetExceededError,
} from "../../src/db/query-budget";
import { acquireSchedulerLease } from "../../src/lib/scheduler-lease";
import { createWp2ScheduledRunner, runWp2Scheduled } from "../../src/scheduled";

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
      d1Queries: 6,
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
