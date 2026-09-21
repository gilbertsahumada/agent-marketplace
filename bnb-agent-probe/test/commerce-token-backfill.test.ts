import { describe, expect, it, vi } from "vitest";
import { enqueueCommerceTokenBackfill } from "../src/phases/commerce-token-backfill";
import type { D1Database, D1PreparedStatement } from "../src/types";

function database(rows: Partial<Record<56 | 97, number>>) {
  const markers = new Map<string, { integerValue: number; updatedAt: number }>();
  return {
    prepare(query: string): D1PreparedStatement {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) { values = bound; return this; },
        async first<T>() { return null as T | null; },
        async all<T>() { return { success: true, results: [] as T[] }; },
        async raw<T extends unknown[]>() {
          if (query.includes('from "commerce_jobs"')) {
            const jobId = rows[values[0] as 56 | 97];
            return (jobId === undefined ? [] : [[jobId]]) as T[];
          }
          if (query.includes('from "runtime_state"')) {
            const marker = markers.get(String(values[0]));
            return (marker === undefined
              ? []
              : [[String(values[0]), null, marker.integerValue, marker.updatedAt]]) as T[];
          }
          return [];
        },
        async run() {
          if (query.includes('insert into "runtime_state"')) {
            markers.set(String(values[0]), {
              integerValue: Number(values[2]),
              updatedAt: Number(values[3]),
            });
          }
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
}

describe("Commerce payment-token backfill producer", () => {
  it("enqueues one bounded newest-first batch per readable chain", async () => {
    const queue = { send: vi.fn().mockResolvedValue(undefined) };
    const summary = await enqueueCommerceTokenBackfill(database({ 56: 56_796, 97: 1_066 }), queue, [56, 97], 28, 1_800_000_000_000);

    expect(summary.enqueued).toEqual([
      { chainId: 56, fromJobId: 56_769, toJobId: 56_796 },
      { chainId: 97, fromJobId: 1_039, toJobId: 1_066 },
    ]);
    expect(queue.send).toHaveBeenCalledTimes(2);
    expect(queue.send).toHaveBeenNthCalledWith(1, {
      schemaVersion: 2, kind: "index_jobs", chainId: 56,
      fromJobId: 56_769, toJobId: 56_796, enqueuedAt: 1_800_000_000_000,
    });
  });

  it("is a no-op after the backlog drains", async () => {
    const queue = { send: vi.fn() };
    await expect(enqueueCommerceTokenBackfill(database({}), queue, [56, 97], 28, 1)).resolves.toEqual({ enqueued: [] });
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("deduplicates an in-flight range and retries it after the recovery window", async () => {
    const db = database({ 56: 56_796 });
    const queue = { send: vi.fn().mockResolvedValue(undefined) };

    await enqueueCommerceTokenBackfill(db, queue, [56], 28, 1_800_000_000_000);
    await enqueueCommerceTokenBackfill(db, queue, [56], 28, 1_800_000_060_000);
    expect(queue.send).toHaveBeenCalledTimes(1);

    await enqueueCommerceTokenBackfill(db, queue, [56], 28, 1_800_000_900_000);
    expect(queue.send).toHaveBeenCalledTimes(2);
  });
});
