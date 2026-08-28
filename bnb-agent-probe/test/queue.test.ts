import { describe, expect, it, vi } from "vitest";

import { createWorker } from "../src/index";
import type { D1Database, D1PreparedStatement, Env, ExecutionContext } from "../src/types";

interface TestMessage {
  readonly body: unknown;
  ack(): void;
}

interface TestBatch {
  readonly messages: readonly TestMessage[];
}

interface QueueWorker {
  scheduled(controller: { scheduledTime: number; cron: string }, env: Env, context: ExecutionContext): Promise<void>;
  queue(batch: TestBatch, env: Env, context: ExecutionContext): Promise<void>;
}

class TickDatabase implements D1Database {
  lastScheduledTime = -1;
  dedupeQueries = 0;

  prepare(query: string): D1PreparedStatement {
    const thisDatabase = this;
    let values: readonly unknown[] = [];
    return {
      bind(...bound) {
        values = bound;
        return this;
      },
      async first<Row>() {
        if (!query.includes("last_queue_scheduled_time")) throw new Error("unexpected query");
        const scheduledTime = Number(values[0]);
        if (scheduledTime <= thisDatabase.lastScheduledTime) return null;
        thisDatabase.lastScheduledTime = scheduledTime;
        thisDatabase.dedupeQueries += 1;
        return { key: "last_queue_scheduled_time" } as Row;
      },
      async all<Row>() {
        return { success: true, results: [] as Row[] };
      },
      async run() {
        return { success: true };
      },
    };
  }
}

const context: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};

function queueEnv(db = new TickDatabase(), killSwitch = "0") {
  return {
    DB: db,
    KILL_SWITCH: killSwitch,
    WP2_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
  } as Env & { WP2_QUEUE: { send: ReturnType<typeof vi.fn> } };
}

function message(body: unknown) {
  return { body, ack: vi.fn() };
}

describe("WP2 Free queue dispatch", () => {
  it("keeps Cron below the phase CPU path by enqueueing one versioned tick", async () => {
    const runScheduled = vi.fn();
    const worker = createWorker({ runScheduled }) as unknown as QueueWorker;
    const activeEnv = queueEnv();

    await worker.scheduled({ scheduledTime: 1_800_000_000_000, cron: "*/5 * * * *" }, activeEnv, context);

    expect(activeEnv.WP2_QUEUE.send).toHaveBeenCalledOnce();
    expect(activeEnv.WP2_QUEUE.send).toHaveBeenCalledWith({
      schemaVersion: 1,
      scheduledTime: 1_800_000_000_000,
    });
    expect(runScheduled).not.toHaveBeenCalled();
  });

  it("requires the Queue producer binding before an active Cron can dispatch", async () => {
    const worker = createWorker({ runScheduled: vi.fn() }) as unknown as QueueWorker;

    await expect(worker.scheduled(
      { scheduledTime: 1_800_000_000_000, cron: "*/5 * * * *" },
      { DB: new TickDatabase(), KILL_SWITCH: "0" },
      context,
    )).rejects.toThrow("WP2_QUEUE_BINDING_REQUIRED");
  });

  it("runs and acknowledges exactly one deduplicated Queue tick", async () => {
    const runScheduled = vi.fn().mockResolvedValue(undefined);
    const worker = createWorker({ runScheduled }) as unknown as QueueWorker;
    const activeEnv = queueEnv();
    const tick = message({ schemaVersion: 1, scheduledTime: 1_800_000_000_000 });

    await worker.queue({ messages: [tick] }, activeEnv, context);

    expect(runScheduled).toHaveBeenCalledOnce();
    expect(runScheduled).toHaveBeenCalledWith(
      { scheduledTime: 1_800_000_000_000, cron: "queue" },
      activeEnv,
      context,
      expect.objectContaining({ plan: "free", killSwitch: false }),
    );
    expect(tick.ack).toHaveBeenCalledOnce();
  });

  it("acknowledges a duplicate or stale tick without advancing another phase", async () => {
    const db = new TickDatabase();
    db.lastScheduledTime = 1_800_000_000_000;
    const runScheduled = vi.fn();
    const worker = createWorker({ runScheduled }) as unknown as QueueWorker;
    const activeEnv = queueEnv(db);
    const tick = message({ schemaVersion: 1, scheduledTime: 1_800_000_000_000 });

    await worker.queue({ messages: [tick] }, activeEnv, context);

    expect(runScheduled).not.toHaveBeenCalled();
    expect(tick.ack).toHaveBeenCalledOnce();
  });

  it("discards queued work while the kill switch is active", async () => {
    const runScheduled = vi.fn();
    const worker = createWorker({ runScheduled }) as unknown as QueueWorker;
    const activeEnv = queueEnv(new TickDatabase(), "1");
    const tick = message({ schemaVersion: 1, scheduledTime: 1_800_000_000_000 });

    await worker.queue({ messages: [tick] }, activeEnv, context);

    expect(runScheduled).not.toHaveBeenCalled();
    expect(tick.ack).toHaveBeenCalledOnce();
  });

  it("does not acknowledge a failed phase so Queues can retry it", async () => {
    const worker = createWorker({
      runScheduled: vi.fn().mockRejectedValue(new Error("phase failed")),
    }) as unknown as QueueWorker;
    const tick = message({ schemaVersion: 1, scheduledTime: 1_800_000_000_000 });

    await expect(worker.queue({ messages: [tick] }, queueEnv(), context))
      .rejects.toThrow("phase failed");
    expect(tick.ack).not.toHaveBeenCalled();
  });

  it("rejects a misconfigured multi-message batch before D1 access", async () => {
    const db = new TickDatabase();
    const worker = createWorker({ runScheduled: vi.fn() }) as unknown as QueueWorker;

    await expect(worker.queue({ messages: [message({}), message({})] }, queueEnv(db), context))
      .rejects.toThrow("WP2_QUEUE_BATCH_MUST_EQUAL_ONE");
    expect(db.dedupeQueries).toBe(0);
  });
});
