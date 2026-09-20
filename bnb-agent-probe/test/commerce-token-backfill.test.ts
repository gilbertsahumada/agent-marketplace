import { describe, expect, it, vi } from "vitest";
import { enqueueCommerceTokenBackfill } from "../src/phases/commerce-token-backfill";
import type { D1Database, D1PreparedStatement } from "../src/types";

function database(rows: Partial<Record<56 | 97, number>>) {
  let chainId: 56 | 97 = 56;
  const statement: D1PreparedStatement = {
    bind(value: unknown) { chainId = value as 56 | 97; return this; },
    async first<T>() { return null as T | null; },
    async all<T>() {
      return { success: true, results: (rows[chainId] === undefined ? [] : [{ jobId: rows[chainId] }]) as T[] };
    },
    async raw<T extends unknown[]>() {
      return (rows[chainId] === undefined ? [] : [[rows[chainId]]]) as T[];
    },
    async run() { return { success: true }; },
  };
  return { prepare: vi.fn(() => statement) } as unknown as D1Database;
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
});
