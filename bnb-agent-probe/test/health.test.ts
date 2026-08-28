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
    const worker = createWorker({ now: () => now });
    const response = await worker.fetch(new Request("https://worker.test/health"), env());
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
      targets: { current: 4, removed: 1, total: 5 },
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
        d1QueriesPerInvocation: 50,
      },
      sweepRound: 0,
    });
    expect(text).not.toContain("must-never-leak");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("runId");
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
