import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/db/client";
import { createWp2ScheduledRunner, type SchedulerPhase } from "../src/scheduled";
import type { Env } from "../src/types";

class LeaseDatabase implements D1DatabaseLike {
  lease: { runId: string | null; expiresAt: number } | null = null;
  acquisitions = 0;
  releases = 0;
  summaries: string[] = [];
  nextPhase: SchedulerPhase = "header";

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
        if (query.includes("INSERT INTO runtime_state") && query.includes("scheduler_lease")) {
          const [runId, expiresAt, , now] = values as [string, number, number, number];
          if (thisDb.lease !== null && thisDb.lease.expiresAt > now) {
            return { success: true, meta: { rows_read: 1, rows_written: 0 }, results: [] };
          }
          thisDb.acquisitions += 1;
          thisDb.lease = { runId, expiresAt };
          return {
            success: true,
            meta: { rows_read: 1, rows_written: 1 },
            results: [{ key: "scheduler_lease" } as Row],
          };
        }
        if (query.includes("UPDATE runtime_state") && query.includes("scheduler_lease")) {
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
        if (!query.includes("INSERT INTO runtime_state")) {
          throw new Error("unexpected run query");
        }
        if (typeof values[0] === "string" && values[0].startsWith("{")) {
          thisDb.summaries.push(values[0]);
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
});
