import { describe, expect, it, vi } from "vitest";

import { createWorker } from "../src/index";
import type { D1Database, Env, ExecutionContext } from "../src/types";

const context: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};

function activeEnv(intervalMinutes = "5") {
  return {
    DB: {} as D1Database,
    KILL_SWITCH: "0",
    CRON_INTERVAL_MINUTES: intervalMinutes,
    WP2_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
  } as Env & { WP2_QUEUE: { send: ReturnType<typeof vi.fn> } };
}

describe("WP2 controlled 24-hour Cron", () => {
  it("accepts only the exact Cron expression configured for the five-minute Free cadence", async () => {
    const worker = createWorker();
    const env = activeEnv();

    await worker.scheduled(
      { scheduledTime: 1_800_000_000_000, cron: "*/5 * * * *" },
      env,
      context,
    );

    expect(env.WP2_QUEUE.send).toHaveBeenCalledOnce();
    expect(env.WP2_QUEUE.send).toHaveBeenCalledWith({
      schemaVersion: 1,
      scheduledTime: 1_800_000_000_000,
    });
  });

  it.each([
    ["different cadence", "*/1 * * * *"],
    ["duplicated expression", "*/5 * * * *,*/5 * * * *"],
    ["malformed expression", "not-a-cron"],
  ])("rejects a %s before publishing a Queue tick", async (_label, cron) => {
    const worker = createWorker();
    const env = activeEnv();

    await expect(worker.scheduled(
      { scheduledTime: 1_800_000_000_000, cron },
      env,
      context,
    )).rejects.toThrow("WP2_CRON_MISMATCH");

    expect(env.WP2_QUEUE.send).not.toHaveBeenCalled();
  });

  it("derives the accepted expression from CRON_INTERVAL_MINUTES", async () => {
    const worker = createWorker();
    const env = activeEnv("10");

    await expect(worker.scheduled(
      { scheduledTime: 1_800_000_000_000, cron: "*/5 * * * *" },
      env,
      context,
    )).rejects.toThrow("WP2_CRON_MISMATCH");
    await worker.scheduled(
      { scheduledTime: 1_800_000_600_000, cron: "*/10 * * * *" },
      env,
      context,
    );

    expect(env.WP2_QUEUE.send).toHaveBeenCalledOnce();
  });

  it("accepts Cloudflare's canonical one-minute Cron expression", async () => {
    const worker = createWorker();
    const env = {
      ...activeEnv("1"),
      CLOUDFLARE_WORKERS_PLAN: "paid",
    } as Env & { WP2_QUEUE: { send: ReturnType<typeof vi.fn> } };

    await worker.scheduled(
      { scheduledTime: 1_800_000_000_000, cron: "* * * * *" },
      env,
      context,
    );

    expect(env.WP2_QUEUE.send).toHaveBeenCalledOnce();
  });
});
