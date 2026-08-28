import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config";
import type { D1DatabaseLike } from "../../src/db/client";
import { listSchedulerAttempts } from "../../src/db/scheduler-attempt-ledger";
import { createWp2ScheduledRunner } from "../../src/scheduled";

const WINDOW_START = Date.parse("2026-08-29T00:00:00.000Z");
const TICK_A = WINDOW_START;
const TICK_B = WINDOW_START + 5 * 60_000;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM runtime_state").run();
  await env.DB.prepare("DELETE FROM probe_targets").run();
});

describe("WP2 durable scheduler-attempt ledger", () => {
  it("retains failed, completed, duplicate and locked attempts keyed by scheduledTime and attempt", async () => {
    let clock = WINDOW_START + 1_000;
    const failed = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "attempt-failed",
      fetch: async () => { throw new Error("controlled upstream failure"); },
    });
    await expect(failed(
      { scheduledTime: TICK_A, cron: "queue", attempt: 1, messageId: "tick-a" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).rejects.toThrow("controlled upstream failure");

    clock = WINDOW_START + 2_000;
    const completed = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "attempt-completed",
      fetch: async () => Response.json({ items: [], total: 0, limit: 25, offset: 0 }),
    });
    await expect(completed(
      { scheduledTime: TICK_A, cron: "queue", attempt: 2, messageId: "tick-a" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).resolves.toBe("completed");

    clock = WINDOW_START + 3_000;
    const duplicate = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "attempt-duplicate",
      executePhase: async () => { throw new Error("duplicate must not execute a phase"); },
    });
    await expect(duplicate(
      { scheduledTime: TICK_A, cron: "queue", attempt: 3, messageId: "tick-a" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).resolves.toBe("duplicate");

    await env.DB.prepare(
      `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
       VALUES ('scheduler_lease', 'other-owner', ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         textValue = excluded.textValue,
         integerValue = excluded.integerValue,
         updatedAt = excluded.updatedAt`,
    ).bind(TICK_B + 60_000, TICK_B).run();
    clock = TICK_B + 1_000;
    const locked = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "attempt-locked",
      executePhase: async () => { throw new Error("locked must not execute a phase"); },
    });
    await expect(locked(
      { scheduledTime: TICK_B, cron: "queue", attempt: 1, messageId: "tick-b" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).resolves.toBe("locked");

    const attempts = await listSchedulerAttempts(
      env.DB as unknown as D1DatabaseLike,
      WINDOW_START,
      WINDOW_START + 24 * 60 * 60_000,
    );

    expect(attempts).toEqual([
      expect.objectContaining({
        messageId: "tick-a",
        scheduledTime: TICK_A,
        attempt: 1,
        phase: "header",
        outcome: "failed",
        upstreamRequests: 1,
        d1Queries: expect.any(Number),
        rowsReadObservedBeforeLedger: expect.any(Number),
        rowsWrittenObservedBeforeLedger: expect.any(Number),
      }),
      expect.objectContaining({
        messageId: "tick-a",
        scheduledTime: TICK_A,
        attempt: 2,
        phase: "header",
        outcome: "completed",
        upstreamRequests: 1,
        d1Queries: expect.any(Number),
        rowsReadObservedBeforeLedger: expect.any(Number),
        rowsWrittenObservedBeforeLedger: expect.any(Number),
      }),
      expect.objectContaining({
        messageId: "tick-a",
        scheduledTime: TICK_A,
        attempt: 3,
        phase: null,
        outcome: "duplicate",
        upstreamRequests: 0,
        d1Queries: expect.any(Number),
        rowsReadObservedBeforeLedger: expect.any(Number),
        rowsWrittenObservedBeforeLedger: expect.any(Number),
      }),
      expect.objectContaining({
        messageId: "tick-b",
        scheduledTime: TICK_B,
        attempt: 1,
        phase: null,
        outcome: "locked",
        upstreamRequests: 0,
        d1Queries: expect.any(Number),
        rowsReadObservedBeforeLedger: expect.any(Number),
        rowsWrittenObservedBeforeLedger: expect.any(Number),
      }),
    ]);
    expect(attempts.every(({ d1Queries }) => d1Queries <= 40)).toBe(true);
  });

  it("rejects UPDATE and DELETE against durable attempt evidence", async () => {
    const scheduledTime = WINDOW_START + 10 * 60_000;
    await env.DB.prepare(
      `INSERT INTO scheduler_attempts (
         messageId, scheduledTime, attempt, phase, outcome, startedAt, finishedAt,
         upstreamRequests, d1Queries, rowsReadObservedBeforeLedger,
         rowsWrittenObservedBeforeLedger, errorCode
       ) VALUES ('append-only-test', ?, 1, 'header', 'completed', ?, ?, 1, 5, 1, 1, NULL)`,
    ).bind(scheduledTime, scheduledTime, scheduledTime + 1).run();

    await expect(env.DB.prepare(
      "UPDATE scheduler_attempts SET outcome = 'failed' WHERE scheduledTime = ?",
    ).bind(scheduledTime).run()).rejects.toThrow("scheduler_attempts is append-only");
    await expect(env.DB.prepare(
      "DELETE FROM scheduler_attempts WHERE scheduledTime = ?",
    ).bind(scheduledTime).run()).rejects.toThrow("scheduler_attempts is append-only");
  });
});
