import { describe, expect, it, vi } from "vitest";

import { createWorker } from "../src/index";
import type { D1Database, D1PreparedStatement, Env, ExecutionContext } from "../src/types";

const NOW = 1_800_000_000_000;

function database(): D1Database {
  return {
    prepare(): D1PreparedStatement {
      return {
        bind() { return this; },
        async first<T>() { return null as T | null; },
        async all<T>() { return { success: true, results: [] as T[] }; },
        async run() { return { success: true }; },
      };
    },
  };
}

const context: ExecutionContext = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

function activeEnv(overrides: Partial<Env> = {}) {
  return {
    DB: database(),
    KILL_SWITCH: "0",
    PRODUCER_KILL_SWITCH: "0",
    CLOUDFLARE_WORKERS_PLAN: "paid",
    COMMERCE_INDEX_ENABLED: "1",
    WP2_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  } as Env & { WP2_QUEUE: { send: ReturnType<typeof vi.fn> } };
}

function message(body: unknown, attempts = 1) {
  return { id: `message-${attempts}`, timestamp: new Date(NOW), body, attempts, ack: vi.fn(), retry: vi.fn() };
}

describe("Commerce indexer queue wiring", () => {
  it("enqueues one cursor tick per chain with an RPC URL after the phase tick", async () => {
    const worker = createWorker({ now: () => NOW, runScheduled: vi.fn() });
    const bothChains = activeEnv({ BSC_RPC_URL: "https://rpc.example/bsc", BSC_TESTNET_RPC_URL: "https://rpc.example/testnet" });
    await worker.scheduled({ scheduledTime: NOW, cron: "* * * * *" }, bothChains, context);
    expect(bothChains.WP2_QUEUE.send.mock.calls.map((call) => call[0])).toEqual([
      { schemaVersion: 1, scheduledTime: NOW },
      { schemaVersion: 2, kind: "index_range", chainId: 56, enqueuedAt: NOW },
      { schemaVersion: 2, kind: "index_range", chainId: 97, enqueuedAt: NOW },
    ]);

    const mainnetOnly = activeEnv({ BSC_RPC_URL: "https://rpc.example/bsc" });
    await worker.scheduled({ scheduledTime: NOW, cron: "* * * * *" }, mainnetOnly, context);
    expect(mainnetOnly.WP2_QUEUE.send).toHaveBeenCalledTimes(2);

    const disabled = activeEnv({ BSC_RPC_URL: "https://rpc.example/bsc", COMMERCE_INDEX_ENABLED: "0" });
    await worker.scheduled({ scheduledTime: NOW, cron: "* * * * *" }, disabled, context);
    expect(disabled.WP2_QUEUE.send).toHaveBeenCalledTimes(1);
  });

  it("dispatches index messages to the indexer runner and acknowledges on success", async () => {
    const summary = { kind: "index_range", chainId: 56, status: "ok", fromBlock: 1, toBlock: 2, logs: 3, jobs: 1, d1Queries: 5, wallTimeMs: 7 } as const;
    const runCommerceIndex = vi.fn().mockResolvedValue(summary);
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = createWorker({ now: () => NOW, runScheduled: vi.fn(), runCommerceIndex, logger });
    const env = activeEnv();
    const tick = message({ schemaVersion: 2, kind: "index_range", chainId: 56, enqueuedAt: NOW });

    await worker.queue({ messages: [tick] }, env, context);

    expect(runCommerceIndex).toHaveBeenCalledWith(
      { kind: "index_range", chainId: 56, fromBlock: null, toBlock: null, enqueuedAt: NOW },
      env,
      expect.objectContaining({ commerceIndexEnabled: true }),
    );
    expect(tick.ack).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith("commerce.index.completed", expect.objectContaining({ kind: "index_range", chainId: 56, status: "ok", logs: 3 }));

    const jobs = message({ schemaVersion: 2, kind: "index_jobs", chainId: 97, fromJobId: 1, toJobId: 100, enqueuedAt: NOW });
    await worker.queue({ messages: [jobs] }, env, context);
    expect(runCommerceIndex).toHaveBeenLastCalledWith(
      { kind: "index_jobs", chainId: 97, fromJobId: 1, toJobId: 100, enqueuedAt: NOW },
      env,
      expect.anything(),
    );
  });

  it("logs a sanitized failure code and lets the queue retry", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = createWorker({
      now: () => NOW,
      runScheduled: vi.fn(),
      runCommerceIndex: vi.fn().mockRejectedValue(new Error("BSC_LOGS_RPC")),
      logger,
    });
    const tick = message({ schemaVersion: 2, kind: "index_range", chainId: 56, enqueuedAt: NOW });

    await expect(worker.queue({ messages: [tick] }, activeEnv(), context)).rejects.toThrow("BSC_LOGS_RPC");
    expect(logger.error).toHaveBeenCalledWith("commerce.index.failed", { attempt: 1, errorCode: "BSC_LOGS_RPC", kind: "index_range", chainId: 56 });
    expect(tick.ack).not.toHaveBeenCalled();
  });

  it("drops queued index work while the indexer flag is off", async () => {
    const runCommerceIndex = vi.fn();
    const worker = createWorker({ now: () => NOW, runScheduled: vi.fn(), runCommerceIndex });
    const tick = message({ schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: 1, toJobId: 5, enqueuedAt: NOW });

    await worker.queue({ messages: [tick] }, activeEnv({ COMMERCE_INDEX_ENABLED: "0" }), context);

    expect(runCommerceIndex).not.toHaveBeenCalled();
    expect(tick.ack).toHaveBeenCalledOnce();
  });

  it.each([
    { schemaVersion: 2, kind: "index_range", chainId: 1, enqueuedAt: NOW },
    { schemaVersion: 2, kind: "index_range", chainId: 56, fromBlock: 10, enqueuedAt: NOW },
    { schemaVersion: 2, kind: "index_range", chainId: 56, fromBlock: 10, toBlock: 9, enqueuedAt: NOW },
    { schemaVersion: 2, kind: "index_range", chainId: 56, enqueuedAt: NOW + 300_001 },
    { schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: 5, toJobId: 4, enqueuedAt: NOW },
    { schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: -1, toJobId: 4, enqueuedAt: NOW },
    { schemaVersion: 1, kind: "index_jobs", chainId: 56, fromJobId: 1, toJobId: 4, enqueuedAt: NOW },
  ])("rejects a malformed index message %j before any work", async (body) => {
    const runCommerceIndex = vi.fn();
    const worker = createWorker({ now: () => NOW, runScheduled: vi.fn(), runCommerceIndex });
    const tick = message(body);
    await expect(worker.queue({ messages: [tick] }, activeEnv(), context)).rejects.toThrow("WP2_QUEUE_MESSAGE_INVALID");
    expect(runCommerceIndex).not.toHaveBeenCalled();
    expect(tick.ack).not.toHaveBeenCalled();
  });
});

describe("Commerce backfill admin route", () => {
  const adminEnv = (overrides: Partial<Env> = {}) => activeEnv({
    DEPLOYMENT_ENV: "staging",
    STAGING_MANUAL_RUN: "1",
    SHARED_SECRET: "must-never-leak",
    CLOUDFLARE_WORKERS_PLAN: "paid",
    ...overrides,
  });
  const post = (worker: ReturnType<typeof createWorker>, env: Env, body: unknown, authorization = "Bearer must-never-leak") => worker.fetch(
    new Request("https://worker.test/__admin/commerce-backfill", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    context,
  );

  it("splits a job id range into one message per consumer run", async () => {
    const worker = createWorker({ now: () => NOW, runScheduled: vi.fn() });
    const env = adminEnv();
    const response = await post(worker, env, { chainId: 56, fromJobId: 1, toJobId: 250 });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ enqueued: 9 });
    expect(env.WP2_QUEUE.send.mock.calls.map((call) => call[0])).toEqual([
      { schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: 1, toJobId: 28, enqueuedAt: NOW },
      { schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: 29, toJobId: 56, enqueuedAt: NOW },
      { schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: 57, toJobId: 84, enqueuedAt: NOW },
      { schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: 85, toJobId: 112, enqueuedAt: NOW },
      { schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: 113, toJobId: 140, enqueuedAt: NOW },
      { schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: 141, toJobId: 168, enqueuedAt: NOW },
      { schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: 169, toJobId: 196, enqueuedAt: NOW },
      { schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: 197, toJobId: 224, enqueuedAt: NOW },
      { schemaVersion: 2, kind: "index_jobs", chainId: 56, fromJobId: 225, toJobId: 250, enqueuedAt: NOW },
    ]);
  });

  it("splits a block range into explicit index_range messages", async () => {
    const worker = createWorker({ now: () => NOW, runScheduled: vi.fn() });
    const env = adminEnv();
    const response = await post(worker, env, { chainId: 97, fromBlock: 100, toBlock: 4_100 });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ enqueued: 3 });
    expect(env.WP2_QUEUE.send.mock.calls[2]?.[0]).toEqual({
      schemaVersion: 2, kind: "index_range", chainId: 97, fromBlock: 4_100, toBlock: 4_100, enqueuedAt: NOW,
    });
  });

  it.each([
    { chainId: 56, fromJobId: 1, toJobId: 20_001 },
    { chainId: 56, fromJobId: 5, toJobId: 4 },
    { chainId: 1, fromJobId: 1, toJobId: 2 },
    { chainId: 56, fromJobId: 1, toJobId: 2, extra: true },
    { chainId: 56 },
  ])("rejects %j with 400 and enqueues nothing", async (body) => {
    const worker = createWorker({ now: () => NOW, runScheduled: vi.fn() });
    const env = adminEnv();
    const response = await post(worker, env, body);
    expect(response.status).toBe(400);
    expect(env.WP2_QUEUE.send).not.toHaveBeenCalled();
  });

  it.each([
    { COMMERCE_INDEX_ENABLED: "0" },
    { STAGING_MANUAL_RUN: "0" },
    { DEPLOYMENT_ENV: "production" },
    { KILL_SWITCH: "1" },
  ])("stays hidden under %j", async (guard) => {
    const worker = createWorker({ now: () => NOW, runScheduled: vi.fn() });
    const env = adminEnv(guard);
    const response = await post(worker, env, { chainId: 56, fromJobId: 1, toJobId: 2 });
    expect(response.status).toBe(404);
    expect(env.WP2_QUEUE.send).not.toHaveBeenCalled();
  });

  it("rejects a wrong credential without leaking the secret", async () => {
    const worker = createWorker({ now: () => NOW, runScheduled: vi.fn() });
    const env = adminEnv();
    const response = await post(worker, env, { chainId: 56, fromJobId: 1, toJobId: 2 }, "Bearer wrong");
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("must-never-leak");
  });
});
