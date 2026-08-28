import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/db/client";
import { D1RowBudgetExceededError } from "../src/db/query-budget";
import { createWp2ScheduledRunner, type SchedulerPhase } from "../src/scheduled";
import type { Env } from "../src/types";

class LeaseDatabase implements D1DatabaseLike {
  lease: { runId: string | null; expiresAt: number } | null = null;
  acquisitions = 0;
  releases = 0;
  summaries: string[] = [];
  nextPhase: SchedulerPhase = "header";
  failRelease = false;
  failLedger = false;
  queries = 0;
  leaseRowsWritten = 1;

  prepare(query: string): D1PreparedStatementLike {
    let values: readonly unknown[] = [];
    const thisDb = this;
    return {
      bind(...nextValues) {
        values = nextValues;
        return this;
      },
      async first() {
        throw new Error("scheduled lease queries must use all()");
      },
      async all<Row>() {
        thisDb.queries += 1;
        if (query.includes("INSERT INTO runtime_state") && query.includes("scheduler_lease")) {
          const [runId, expiresAt, , now] = values as [string, number, number, number];
          if (thisDb.lease !== null && thisDb.lease.expiresAt > now) {
            return { success: true, meta: { rows_read: 1, rows_written: 0 }, results: [] };
          }
          thisDb.acquisitions += 1;
          thisDb.lease = { runId, expiresAt };
          return {
            success: true,
            meta: { rows_read: 1, rows_written: thisDb.leaseRowsWritten },
            results: [{ key: "scheduler_lease" } as Row],
          };
        }
        if (query.includes("UPDATE runtime_state") && query.includes("scheduler_lease")) {
          if (thisDb.failRelease) throw new Error("cleanup-release-failed");
          const [releasedAt, , runId] = values as [number, number, string];
          if (thisDb.lease?.runId !== runId) {
            return { success: true, meta: { rows_read: 1, rows_written: 0 }, results: [] };
          }
          thisDb.releases += 1;
          thisDb.lease = { runId: null, expiresAt: releasedAt };
          return {
            success: true,
            meta: { rows_read: 1, rows_written: 1 },
            results: [{ key: "scheduler_lease" } as Row],
          };
        }
        if (query.includes("next_scheduler_phase")) {
          return {
            success: true,
            meta: { rows_read: 1, rows_written: 0 },
            results: [{ key: "next_scheduler_phase", textValue: thisDb.nextPhase }] as Row[],
          };
        }
        return { success: true, meta: {}, results: [] as Row[] };
      },
      async run<Meta>(): Promise<D1ResultLike<Meta>> {
        thisDb.queries += 1;
        if (query.includes("INSERT INTO scheduler_attempts")) {
          return { success: true, meta: { rows_read: 1, rows_written: 1 } as Meta };
        }
        if (!query.includes("INSERT INTO runtime_state")) {
          throw new Error("unexpected run query");
        }
        const isDailyLedger = typeof values[0] === "string" && values[0].startsWith("daily_budget_");
        if (isDailyLedger && thisDb.failLedger) throw new Error("daily-ledger-failed");
        if (!isDailyLedger) {
          const summary = values.find((value): value is string => (
            typeof value === "string" && value.startsWith("{")
          ));
          if (summary !== undefined) thisDb.summaries.push(summary);
        }
        return { success: true, meta: { rows_read: 1, rows_written: 1 } as Meta };
      },
    };
  }

  async batch<Meta>(): Promise<readonly D1ResultLike<Meta>[]> {
    throw new Error("batch is not used by the lease runner");
  }
}

const controller = { scheduledTime: 1_000, cron: "*/5 * * * *" };
const context = {
  waitUntil() {},
  passThroughOnException() {},
};

describe("WP2 scheduled runner", () => {
  it("acquires and releases a bounded Free lease around exactly one phase", async () => {
    const db = new LeaseDatabase();
    let now = 1_000;
    const phases: SchedulerPhase[] = [];
    const runner = createWp2ScheduledRunner({
      now: () => now++,
      randomUUID: () => "run-a",
      executePhase: async ({ phase }) => { phases.push(phase); },
    });

    await runner(controller, { DB: db } as unknown as Env, context, loadConfig({}));

    expect(db.acquisitions).toBe(1);
    expect(db.releases).toBe(1);
    expect(db.lease).toEqual({ runId: null, expiresAt: 1_002 });
    expect(phases).toEqual(["header"]);
  });

  it("does not release a lease held by another invocation", async () => {
    const db = new LeaseDatabase();
    db.lease = { runId: "existing", expiresAt: 10_000 };
    const runner = createWp2ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-b",
      executePhase: async () => { throw new Error("must not execute"); },
    });

    await runner(controller, { DB: db } as unknown as Env, context, loadConfig({}));

    expect(db.acquisitions).toBe(0);
    expect(db.releases).toBe(0);
    expect(db.lease).toEqual({ runId: "existing", expiresAt: 10_000 });
    expect(db.summaries).toHaveLength(1);
    expect(JSON.parse(db.summaries[0] ?? "{}")).toMatchObject({
      status: "skipped_locked",
      requests: 0,
    });
  });

  it("reserves failure and cleanup capacity at the minimum valid D1 query budget", async () => {
    const db = new LeaseDatabase();
    const runner = createWp2ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-minimum",
      executePhase: async () => {},
    });

    await runner(
      controller,
      { DB: db } as unknown as Env,
      context,
      loadConfig({ D1_QUERIES_PER_RUN: "12" }),
    );

    expect(db.acquisitions).toBe(1);
    expect(db.releases).toBe(1);
  });

  it("reads and executes only the persisted phase", async () => {
    const db = new LeaseDatabase();
    db.nextPhase = "sweep";
    const phases: SchedulerPhase[] = [];
    const runner = createWp2ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-sweep",
      executePhase: async ({ phase }) => { phases.push(phase); },
    });

    await runner(controller, { DB: db } as unknown as Env, context, loadConfig({}));

    expect(phases).toEqual(["sweep"]);
    expect(db.acquisitions).toBe(1);
    expect(db.releases).toBe(1);
  });

  it("aborts phase work after crossing the row budget but still releases the lease", async () => {
    const db = new LeaseDatabase();
    let executed = false;
    const runner = createWp2ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-row-budget",
      executePhase: async () => { executed = true; },
    });

    await expect(runner(
      controller,
      { DB: db } as unknown as Env,
      context,
      loadConfig({ D1_ROWS_READ_PER_RUN: "1" }),
    )).rejects.toBeInstanceOf(D1RowBudgetExceededError);

    expect(executed).toBe(false);
    expect(db.summaries).toHaveLength(1);
    expect(JSON.parse(db.summaries[0] ?? "{}")).toMatchObject({
      errorCode: "D1_ROW_BUDGET",
    });
    expect(db.releases).toBe(1);
  });

  it("owner-check releases a lease whose own row metadata crosses the budget", async () => {
    const db = new LeaseDatabase();
    db.leaseRowsWritten = 2;
    const runner = createWp2ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-acquire-row-budget",
      executePhase: async () => { throw new Error("must not execute"); },
    });

    await expect(runner(
      controller,
      { DB: db } as unknown as Env,
      context,
      loadConfig({ D1_ROWS_WRITTEN_PER_RUN: "1" }),
    )).rejects.toBeInstanceOf(D1RowBudgetExceededError);

    expect(db.acquisitions).toBe(1);
    expect(db.releases).toBe(1);
    expect(db.lease).toEqual({ runId: null, expiresAt: 1_000 });
  });

  it("does not retry completed phase work when only the daily ledger fails", async () => {
    const db = new LeaseDatabase();
    db.failLedger = true;
    const runner = createWp2ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-ledger-failure",
      executePhase: async () => {},
    });

    await expect(runner(controller, { DB: db } as unknown as Env, context, loadConfig({})))
      .resolves.toBe("completed");
    expect(db.releases).toBe(1);
  });

  it("preserves the phase error when lease cleanup also fails", async () => {
    const db = new LeaseDatabase();
    db.failRelease = true;
    const runner = createWp2ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-primary-error",
      executePhase: async () => { throw new Error("phase-primary"); },
    });

    await expect(runner(controller, { DB: db } as unknown as Env, context, loadConfig({})))
      .rejects.toThrow("phase-primary");
  });

  it.each([
    ["ProbeQueryBudgetExceededError", "D1_QUERY_BUDGET"],
    ["ProbeExternalSubrequestBudgetError", "EXTERNAL_SUBREQUEST_BUDGET"],
  ])("surfaces sanitized PROBE budget diagnostics for %s", async (name, errorCode) => {
    const db = new LeaseDatabase();
    db.nextPhase = "probe";
    const runner = createWp2ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-probe-budget",
      executePhase: async () => {
        const error = new Error("raw detail must not persist");
        error.name = name;
        throw error;
      },
    });

    await expect(runner(controller, { DB: db } as unknown as Env, context, loadConfig({})))
      .rejects.toBeDefined();
    expect(JSON.parse(db.summaries[0] ?? "{}")).toMatchObject({ errorCode });
    expect(db.summaries[0]).not.toContain("raw detail");
  });

  it("keeps the explicit locked result when its ledger write fails", async () => {
    const db = new LeaseDatabase();
    db.lease = { runId: "existing", expiresAt: 10_000 };
    db.failLedger = true;
    const runner = createWp2ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-locked-ledger",
      executePhase: async () => { throw new Error("must not execute"); },
    });

    await expect(runner(controller, { DB: db } as unknown as Env, context, loadConfig({})))
      .resolves.toBe("locked");
  });

  it("never accesses D1 more than 40 times on an exhausted failure path", async () => {
    const db = new LeaseDatabase();
    const runner = createWp2ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-query-ceiling",
      executePhase: async ({ db: phaseDb }) => {
        for (let index = 0; index < 36; index += 1) {
          await phaseDb.prepare("SELECT bounded").all();
        }
      },
    });

    await expect(runner(controller, { DB: db } as unknown as Env, context, loadConfig({})))
      .rejects.toMatchObject({ name: "D1QueryBudgetExceededError" });
    expect(db.queries).toBeLessThanOrEqual(40);
    expect(db.releases).toBe(1);
  });
});
