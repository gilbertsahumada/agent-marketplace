import { describe, expect, it, vi } from "vitest";

import { createWorker } from "../src/index";
import type { D1Database, D1PreparedStatement, Env } from "../src/types";

type RuntimeRow = {
  key: string;
  textValue: string | null;
  integerValue: number | null;
  updatedAt: number;
};

function database(options: { fail?: boolean; runtime?: RuntimeRow[] } = {}): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      return {
        bind() {
          return this;
        },
        async all<T>() {
          if (options.fail) throw new Error("D1 secret details");
          if (sql.includes("FROM runtime_state")) {
            return { success: true, results: (options.runtime ?? []) as T[] };
          }
          return {
            success: true,
            results: [
              { declarationState: "current", count: 4 },
              { declarationState: "removed", count: 1 },
            ] as T[],
          };
        },
        async first<T>() {
          return null as T | null;
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
}

function env(db = database()): Env {
  return {
    DB: db,
    SHARED_SECRET: "must-never-leak",
    BSC_RPC_URL: "https://rpc.example/secret-token",
  };
}

describe("Worker runtime", () => {
  it("returns a public, sanitized Free health response", async () => {
    const now = 1_800_000_000_000;
    const db = database();
    const prepare = vi.spyOn(db, "prepare");
    const worker = createWorker({ now: () => now });
    const response = await worker.fetch(new Request("https://worker.test/health"), env(db));
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toMatchObject({
      status: "ok",
      plan: "free",
      schedulerMode: "single_phase",
      killSwitch: true,
      d1: { available: true },
      lease: { active: false, expiresAt: null },
      targets: { available: false },
      budgets: {
        headerLimit: 25,
        sweepLimit: 4,
        probeBatchSize: 1,
        externalSubrequestsPerRun: 12,
        d1QueriesPerRun: 40,
        probeTimeoutMs: 5_000,
        maxCatalogResponseBytes: 16_777_216,
        maxSellerResponseBytes: 32_768,
      },
      platformLimits: {
        cpuMsPerInvocation: 10,
        queueConsumerCpuMs: 30_000,
        d1QueriesPerInvocation: 50,
      },
      sweepRound: 0,
      dailyBudget: null,
    });
    expect(text).not.toContain("must-never-leak");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("runId");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]?.[0]).not.toContain("probe_targets");
  });

  it("exposes only the current UTC daily ledger allowlist", async () => {
    const now = Date.parse("2026-08-28T12:00:00.000Z");
    const db = database({
      runtime: [{
        key: "daily_budget_20260828",
        textValue: JSON.stringify({
          schemaVersion: 1,
          utcDate: "2026-08-28",
          measurementScope: "worker_metered_before_daily_ledger",
          updatedAt: now,
          invocations: 2,
          completed: 1,
          failed: 1,
          duplicate: 0,
          locked: 0,
          upstreamRequests: 5,
          d1Queries: 18,
          rowsReadObservedBeforeLedger: 12,
          rowsWrittenObservedBeforeLedger: 6,
          secret: "must-not-leak",
        }),
        integerValue: null,
        updatedAt: now,
      }],
    });

    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/health"),
      env(db),
    );
    const text = await response.text();
    expect(JSON.parse(text).dailyBudget).toEqual({
      schemaVersion: 1,
      utcDate: "2026-08-28",
      measurementScope: "worker_metered_before_daily_ledger",
      updatedAt: now,
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
    expect(text).not.toContain("must-not-leak");
  });

  it("treats a malformed daily ledger as unavailable telemetry", async () => {
    const now = Date.parse("2026-08-28T12:00:00.000Z");
    const db = database({
      runtime: [{
        key: "daily_budget_20260828",
        textValue: "not-json",
        integerValue: null,
        updatedAt: now,
      }],
    });

    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/health"),
      env(db),
    );
    expect(await response.json()).toMatchObject({ status: "ok", dailyBudget: null });
  });

  it("degrades when active scheduling has no valid current-day ledger", async () => {
    const now = Date.parse("2026-08-28T12:00:00.000Z");
    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/health"),
      { ...env(), KILL_SWITCH: "0" },
    );

    expect(await response.json()).toMatchObject({
      status: "degraded",
      killSwitch: false,
      dailyBudget: null,
    });
  });

  it("degrades when active daily telemetry has stopped advancing", async () => {
    const now = Date.parse("2026-08-28T12:00:00.000Z");
    const updatedAt = now - 16 * 60_000;
    const db = database({
      runtime: [{
        key: "daily_budget_20260828",
        textValue: JSON.stringify({
          schemaVersion: 1,
          utcDate: "2026-08-28",
          measurementScope: "worker_metered_before_daily_ledger",
          updatedAt,
          invocations: 1,
          completed: 1,
          failed: 0,
          duplicate: 0,
          locked: 0,
          upstreamRequests: 1,
          d1Queries: 12,
          rowsReadObservedBeforeLedger: 10,
          rowsWrittenObservedBeforeLedger: 4,
        }),
        integerValue: null,
        updatedAt,
      }],
    });
    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/health"),
      { ...env(db), KILL_SWITCH: "0" },
    );

    expect(await response.json()).toMatchObject({ status: "degraded" });
  });

  it("degrades for a scheduler error newer than the latest healthy phase", async () => {
    const now = Date.parse("2026-08-28T12:00:00.000Z");
    const dailyBudget = JSON.stringify({
      schemaVersion: 1,
      utcDate: "2026-08-28",
      measurementScope: "worker_metered_before_daily_ledger",
      updatedAt: now,
      invocations: 1,
      completed: 0,
      failed: 1,
      duplicate: 0,
      locked: 0,
      upstreamRequests: 0,
      d1Queries: 4,
      rowsReadObservedBeforeLedger: 2,
      rowsWrittenObservedBeforeLedger: 2,
    });
    const db = database({
      runtime: [
        {
          key: "last_header_summary",
          textValue: JSON.stringify({ phase: "header", status: "ok" }),
          integerValue: null,
          updatedAt: now - 1_000,
        },
        {
          key: "last_scheduler_summary",
          textValue: JSON.stringify({ status: "error", errorCode: "D1_ROW_BUDGET" }),
          integerValue: null,
          updatedAt: now,
        },
        {
          key: "daily_budget_20260828",
          textValue: dailyBudget,
          integerValue: null,
          updatedAt: now,
        },
      ],
    });
    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/health"),
      { ...env(db), KILL_SWITCH: "0" },
    );

    expect(await response.json()).toMatchObject({
      status: "degraded",
      lastScheduler: { status: "error", errorCode: "D1_ROW_BUDGET" },
    });
  });

  it("reports runtime state but never returns the lease runId or arbitrary summary fields", async () => {
    const now = 1_800_000_000_000;
    const db = database({
      runtime: [
        { key: "scheduler_lease", textValue: "private-run-id", integerValue: now + 10_000, updatedAt: now },
        { key: "sweep_offset", textValue: null, integerValue: 50, updatedAt: now },
        { key: "header_high_water", textValue: "secret-high-water", integerValue: null, updatedAt: now },
        { key: "next_scheduler_phase", textValue: "probe", integerValue: null, updatedAt: now },
        {
          key: "last_sweep_summary",
          textValue: JSON.stringify({
            phase: "sweep",
            status: "degraded",
            requests: 3,
            cpuMs: 4,
            wallTimeMs: 50,
            errorCode: "UPSTREAM_429",
            secret: "summary-secret",
            runId: "summary-run-id",
          }),
          integerValue: null,
          updatedAt: now,
        },
      ],
    });
    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/health"),
      env(db),
    );
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "degraded",
      nextPhase: "probe",
      sweepOffset: 50,
      headerHighWater: null,
      lease: { active: true, expiresAt: now + 10_000 },
      lastPhase: {
        phase: "sweep",
        status: "degraded",
        requests: 3,
        cpuMs: 4,
        wallTimeMs: 50,
        errorCode: "UPSTREAM_429",
      },
    });
    expect(text).not.toContain("private-run-id");
    expect(text).not.toContain("summary-secret");
    expect(text).not.toContain("summary-run-id");
    expect(text).not.toContain("secret-high-water");
  });

  it("exposes sanitized PROBE outcome counters without quote or wallet material", async () => {
    const now = 1_800_000_000_000;
    const db = database({
      runtime: [{
        key: "last_probe_summary",
        textValue: JSON.stringify({
          phase: "probe",
          status: "ok",
          outcome: "quote_verified",
          processedTargets: 1,
          requests: 6,
          d1Queries: 8,
          wallTimeMs: 25,
          signer: "must-not-leak",
          priceRaw: "must-not-leak",
        }),
        integerValue: null,
        updatedAt: now,
      }],
    });
    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/health"),
      env(db),
    );
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      lastPhase: {
        phase: "probe",
        status: "ok",
        outcome: "quote_verified",
        processedTargets: 1,
        requests: 6,
        d1Queries: 8,
      },
    });
    expect(text).not.toContain("must-not-leak");
  });

  it("returns 503 only when D1 cannot be read and sanitizes the failure", async () => {
    const response = await createWorker().fetch(
      new Request("https://worker.test/health"),
      env(database({ fail: true })),
    );
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ status: "unavailable", d1: { available: false } });
    expect(text).not.toContain("D1 secret details");
  });

  it.each(["/", "/observations", "/health/extra"])("returns 404 for %s", async (path) => {
    const response = await createWorker().fetch(
      new Request(`https://worker.test${path}`),
      env(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("does not run scheduled work while the kill switch is active", async () => {
    const runScheduled = vi.fn();
    const worker = createWorker({ runScheduled });
    const db = database({ fail: true });

    await worker.scheduled({ scheduledTime: Date.now(), cron: "*/5 * * * *" }, env(db), {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    });

    expect(runScheduled).not.toHaveBeenCalled();
  });

  it("keeps the manual scheduler route hidden while the kill switch is active", async () => {
    const runScheduled = vi.fn();
    const response = await createWorker({ runScheduled }).fetch(
      new Request("https://worker.test/__admin/run-scheduled", {
        method: "POST",
        headers: { authorization: "Bearer must-never-leak" },
      }),
      {
        ...env(),
        DEPLOYMENT_ENV: "staging",
        STAGING_MANUAL_RUN: "1",
      },
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
    );

    expect(response.status).toBe(404);
    expect(runScheduled).not.toHaveBeenCalled();
  });

  it.each([
    { DEPLOYMENT_ENV: "production", STAGING_MANUAL_RUN: "1" },
    { STAGING_MANUAL_RUN: "1" },
    { DEPLOYMENT_ENV: "staging", STAGING_MANUAL_RUN: "0" },
    { DEPLOYMENT_ENV: "staging" },
  ])("keeps the manual scheduler route hidden outside an explicitly enabled staging run", async (guard) => {
    const runScheduled = vi.fn();
    const response = await createWorker({ runScheduled }).fetch(
      new Request("https://worker.test/__admin/run-scheduled", {
        method: "POST",
        headers: { authorization: "Bearer must-never-leak" },
      }),
      { ...env(), ...guard, KILL_SWITCH: "0" },
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
    );

    expect(response.status).toBe(404);
    expect(runScheduled).not.toHaveBeenCalled();
  });

  it("keeps the manual scheduler route hidden when the staging secret is absent", async () => {
    const runScheduled = vi.fn();
    const activeEnv = env();
    delete activeEnv.SHARED_SECRET;
    activeEnv.DEPLOYMENT_ENV = "staging";
    activeEnv.STAGING_MANUAL_RUN = "1";
    activeEnv.KILL_SWITCH = "0";
    const response = await createWorker({ runScheduled }).fetch(
      new Request("https://worker.test/__admin/run-scheduled", { method: "POST" }),
      activeEnv,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
    );

    expect(response.status).toBe(404);
    expect(runScheduled).not.toHaveBeenCalled();
  });

  it("does not expose the manual scheduler route through a cross-origin preflight", async () => {
    const response = await createWorker({ runScheduled: vi.fn() }).fetch(
      new Request("https://worker.test/__admin/run-scheduled", {
        method: "OPTIONS",
        headers: { origin: "https://attacker.example" },
      }),
      {
        ...env(),
        DEPLOYMENT_ENV: "staging",
        STAGING_MANUAL_RUN: "1",
        KILL_SWITCH: "0",
      },
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects an invalid manual scheduler credential without running work", async () => {
    const runScheduled = vi.fn();
    const response = await createWorker({ runScheduled }).fetch(
      new Request("https://worker.test/__admin/run-scheduled", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
      }),
      {
        ...env(),
        DEPLOYMENT_ENV: "staging",
        STAGING_MANUAL_RUN: "1",
        KILL_SWITCH: "0",
      },
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
    );

    const text = await response.text();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runScheduled).not.toHaveBeenCalled();
    expect(text).not.toContain("must-never-leak");
    expect(text).not.toContain("wrong-secret");
  });

  it("runs exactly one phase through the authenticated manual scheduler route", async () => {
    const now = 1_800_000_000_000;
    const runScheduled = vi.fn().mockResolvedValue(undefined);
    const context = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    const activeEnv = {
      ...env(),
      DEPLOYMENT_ENV: "staging",
      STAGING_MANUAL_RUN: "1",
      KILL_SWITCH: "0",
    };
    const response = await createWorker({ now: () => now, runScheduled }).fetch(
      new Request("https://worker.test/__admin/run-scheduled", {
        method: "POST",
        headers: { authorization: "Bearer must-never-leak" },
      }),
      activeEnv,
      context,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runScheduled).toHaveBeenCalledOnce();
    expect(runScheduled).toHaveBeenCalledWith(
      { scheduledTime: now, cron: "manual" },
      activeEnv,
      context,
      expect.objectContaining({ killSwitch: false, plan: "free" }),
    );
  });

  it("validates configuration before reading D1", async () => {
    const db = database({ fail: true });
    const invalidEnv = { ...env(db), HEADER_LIMIT: "51" };

    const response = await createWorker().fetch(
      new Request("https://worker.test/health"),
      invalidEnv,
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "invalid_configuration" });
  });
});
