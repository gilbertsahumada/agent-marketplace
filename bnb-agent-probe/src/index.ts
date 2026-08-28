import { ConfigError, loadConfig, type WorkerConfig } from "./config";
import type {
  Env,
  ExecutionContext,
  QueueBatch,
  ScheduledController,
  WorkerEntrypoint,
} from "./types";

export interface WorkerDependencies {
  now?: () => number;
  runScheduled?: (
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
    config: WorkerConfig,
    queriesBeforeRun?: number,
  ) => Promise<void>;
}

function errorResponse(error: "not_found" | "invalid_configuration" | "unauthorized", status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function bearerMatches(header: string | null, secret: string): Promise<boolean> {
  const candidate = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const encoder = new TextEncoder();
  const [candidateHash, secretHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(secretHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0 && candidate.length > 0;
}

function queueScheduledTime(body: unknown): number {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("WP2_QUEUE_MESSAGE_INVALID");
  }
  const value = body as Record<string, unknown>;
  if (value.schemaVersion !== 1
    || typeof value.scheduledTime !== "number"
    || !Number.isSafeInteger(value.scheduledTime)
    || value.scheduledTime < 0) {
    throw new Error("WP2_QUEUE_MESSAGE_INVALID");
  }
  return value.scheduledTime;
}

async function claimQueueTick(env: Env, scheduledTime: number, now: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
     VALUES ('last_queue_scheduled_time', NULL, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       textValue = NULL,
       integerValue = excluded.integerValue,
       updatedAt = excluded.updatedAt
     WHERE runtime_state.integerValue IS NULL
        OR runtime_state.integerValue < excluded.integerValue
     RETURNING key`,
  ).bind(scheduledTime, now).first<{ key: string }>();
  return row !== null;
}

export function createWorker(dependencies: WorkerDependencies = {}): WorkerEntrypoint {
  const now = dependencies.now ?? Date.now;

  return {
    async fetch(request, env, context) {
      let config: WorkerConfig;
      try {
        config = loadConfig(env);
      } catch (error) {
        if (error instanceof ConfigError) return errorResponse("invalid_configuration", 500);
        throw error;
      }

      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        const { healthResponse } = await import("./routes/health");
        return healthResponse(env.DB, config, now());
      }
      if (request.method === "POST" && url.pathname === "/__admin/run-scheduled") {
        if (config.killSwitch
          || env.DEPLOYMENT_ENV !== "staging"
          || env.STAGING_MANUAL_RUN !== "1"
          || dependencies.runScheduled === undefined
          || env.SHARED_SECRET === undefined
          || context === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.SHARED_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const scheduledTime = now();
        await dependencies.runScheduled(
          { scheduledTime, cron: "manual" },
          env,
          context,
          config,
        );
        return new Response(null, {
          status: 204,
          headers: {
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }
      return errorResponse("not_found", 404);
    },

    async scheduled(controller, env, _context) {
      const config = loadConfig(env);
      if (config.killSwitch) return;
      if (env.WP2_QUEUE === undefined) throw new Error("WP2_QUEUE_BINDING_REQUIRED");
      await env.WP2_QUEUE.send({ schemaVersion: 1, scheduledTime: controller.scheduledTime });
    },

    async queue(batch: QueueBatch, env, context) {
      if (batch.messages.length !== 1) throw new Error("WP2_QUEUE_BATCH_MUST_EQUAL_ONE");
      const message = batch.messages[0]!;
      const config = loadConfig(env);
      if (config.killSwitch) {
        message.ack();
        return;
      }
      if (dependencies.runScheduled === undefined) throw new Error("WP2_QUEUE_RUNNER_REQUIRED");
      const scheduledTime = queueScheduledTime(message.body);
      if (!await claimQueueTick(env, scheduledTime, now())) {
        message.ack();
        return;
      }
      await dependencies.runScheduled(
        { scheduledTime, cron: "queue" },
        env,
        context,
        config,
        1,
      );
      message.ack();
    },
  };
}

const defaultRunScheduled: NonNullable<WorkerDependencies["runScheduled"]> = async (...args) => {
  const { runWp2Scheduled } = await import("./scheduled");
  return runWp2Scheduled(...args);
};

export default createWorker({ runScheduled: defaultRunScheduled });
