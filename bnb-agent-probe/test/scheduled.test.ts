import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/db/client";
import { createWp1ScheduledRunner } from "../src/scheduled";
import type { Env } from "../src/types";

class LeaseDatabase implements D1DatabaseLike {
  lease: { runId: string | null; expiresAt: number } | null = null;
  acquisitions = 0;
  releases = 0;
  summaries: string[] = [];

  prepare(query: string): D1PreparedStatementLike {
    let values: readonly unknown[] = [];
    const thisDb = this;
    return {
      bind(...nextValues) {
        values = nextValues;
        return this;
      },
      async first<Row>() {
        if (query.includes("INSERT INTO runtime_state")) {
          const [runId, expiresAt, , now] = values as [string, number, number, number];
          if (thisDb.lease !== null && thisDb.lease.expiresAt > now) return null;
          thisDb.acquisitions += 1;
          thisDb.lease = { runId, expiresAt };
          return { key: "scheduler_lease" } as Row;
        }
        const [releasedAt, , runId] = values as [number, number, string];
        if (thisDb.lease?.runId !== runId) return null;
        thisDb.releases += 1;
        thisDb.lease = { runId: null, expiresAt: releasedAt };
        return { key: "scheduler_lease" } as Row;
      },
      async all<Row>() {
        return { success: true, meta: {}, results: [] as Row[] };
      },
      async run<Meta>(): Promise<D1ResultLike<Meta>> {
        if (!query.includes("INSERT INTO runtime_state")) {
          throw new Error("unexpected run query");
        }
        thisDb.summaries.push(String(values[1]));
        return { success: true, meta: {} as Meta };
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

describe("WP1 scheduled runner", () => {
  it("acquires and releases a bounded Free lease without running phases", async () => {
    const db = new LeaseDatabase();
    let now = 1_000;
    const runner = createWp1ScheduledRunner({
      now: () => now++,
      randomUUID: () => "run-a",
    });

    await runner(controller, { DB: db } as unknown as Env, context, loadConfig({}));

    expect(db.acquisitions).toBe(1);
    expect(db.releases).toBe(1);
    expect(db.lease).toEqual({ runId: null, expiresAt: 1_001 });
  });

  it("does not release a lease held by another invocation", async () => {
    const db = new LeaseDatabase();
    db.lease = { runId: "existing", expiresAt: 10_000 };
    const runner = createWp1ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-b",
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

  it("reserves cleanup capacity at the minimum valid D1 query budget", async () => {
    const db = new LeaseDatabase();
    const runner = createWp1ScheduledRunner({
      now: () => 1_000,
      randomUUID: () => "run-minimum",
    });

    await runner(
      controller,
      { DB: db } as unknown as Env,
      context,
      loadConfig({ D1_QUERIES_PER_RUN: "3" }),
    );

    expect(db.acquisitions).toBe(1);
    expect(db.releases).toBe(1);
  });
});
