import { ConfigError, loadConfig, type WorkerConfig } from "./config";
import type {
  Env,
  ExecutionContext,
  QueueBatch,
  ScheduledController,
  WorkerEntrypoint,
} from "./types";

type ScheduledRunResult = "completed" | "duplicate" | "locked";
const QUEUE_LEASE_RETRY_DELAY_SECONDS = 240;
const QUEUE_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export interface WorkerDependencies {
  now?: () => number;
  logger?: Pick<Console, "info" | "error">;
  runScheduled?: (
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
    config: WorkerConfig,
  ) => Promise<ScheduledRunResult | void>;
}

function queueErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)) {
    return error.message;
  }
  return "WORKER_QUEUE_FAILED";
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

function queueScheduledTime(body: unknown, currentTime: number): number {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("WP2_QUEUE_MESSAGE_INVALID");
  }
  const value = body as Record<string, unknown>;
  if (value.schemaVersion !== 1
    || typeof value.scheduledTime !== "number"
    || !Number.isSafeInteger(value.scheduledTime)
    || value.scheduledTime < 0
    || value.scheduledTime > currentTime + QUEUE_MAX_FUTURE_SKEW_MS) {
    throw new Error("WP2_QUEUE_MESSAGE_INVALID");
  }
  return value.scheduledTime;
}

export function createWorker(dependencies: WorkerDependencies = {}): WorkerEntrypoint {
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? console;

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
      if (request.method === "GET" && url.pathname === "/observations" && url.search === "") {
        if (config.probeAgentAllowlist.length === 0) {
          return new Response(JSON.stringify({ error: "observations_unavailable" }), {
            status: 503,
            headers: {
              "cache-control": "no-store",
              "content-type": "application/json; charset=utf-8",
              "x-content-type-options": "nosniff",
            },
          });
        }
        const publicCache = (caches as unknown as { default: Cache }).default;
        const scope = [...config.probeAgentAllowlist].sort().join(",");
        const scopeDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope));
        const scopeHash = Array.from(new Uint8Array(scopeDigest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const cacheKey = new Request(`${url.origin}/observations/__scope/${scopeHash}`, { method: "GET" });
        const cached = await publicCache.match(cacheKey);
        if (cached) return cached;
        const { observationsResponse } = await import("./routes/observations");
        const response = await observationsResponse(env.DB, now(), config.probeAgentAllowlist, {
          producerEnabled: !config.producerKillSwitch,
          consumerEnabled: !config.killSwitch,
          cronIntervalMinutes: config.cronIntervalMinutes,
        });
        if (response.ok) await publicCache.put(cacheKey, response.clone());
        return response;
      }
      if (request.method === "POST" && url.pathname === "/__internal/on-demand-observation" && url.search === "") {
        if (env.BUYER_OBSERVATION_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const { onDemandObservationResponse } = await import("./routes/on-demand-observation");
        const response = await onDemandObservationResponse(request, env.DB, config, now());
        if (response.status === 201 || response.status === 200) {
          const publicCache = (caches as unknown as { default: Cache }).default;
          const scope = [...config.probeAgentAllowlist].sort().join(",");
          const scopeDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope));
          const scopeHash = Array.from(new Uint8Array(scopeDigest), (byte) => byte.toString(16).padStart(2, "0")).join("");
          await publicCache.delete(new Request(`${url.origin}/observations/__scope/${scopeHash}`, { method: "GET" }));
        }
        return response;
      }
      if (request.method === "POST" && url.pathname === "/__admin/run-scheduled") {
        if (config.killSwitch
          || config.producerKillSwitch
          || env.DEPLOYMENT_ENV !== "staging"
          || env.STAGING_MANUAL_RUN !== "1"
          || env.SHARED_SECRET === undefined
          || context === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.SHARED_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        if (env.WP2_QUEUE === undefined) return errorResponse("invalid_configuration", 500);
        const scheduledTime = now();
        await env.WP2_QUEUE.send({ schemaVersion: 1, scheduledTime });
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
      if (config.killSwitch || config.producerKillSwitch) return;
      logger.info("wp2.cron.received", {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      });
      const expectedCron = `*/${config.cronIntervalMinutes} * * * *`;
      if (controller.cron !== expectedCron) throw new Error("WP2_CRON_MISMATCH");
      if (env.WP2_QUEUE === undefined) throw new Error("WP2_QUEUE_BINDING_REQUIRED");
      await env.WP2_QUEUE.send({ schemaVersion: 1, scheduledTime: controller.scheduledTime });
      logger.info("wp2.cron.enqueued", { scheduledTime: controller.scheduledTime });
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
      const scheduledTime = queueScheduledTime(message.body, now());
      if (!Number.isSafeInteger(message.attempts) || message.attempts < 1 || message.attempts > 4) {
        throw new Error("WP2_QUEUE_MESSAGE_INVALID");
      }
      if (message.id.length < 1 || message.id.length > 256) {
        throw new Error("WP2_QUEUE_MESSAGE_ID_INVALID");
      }
      logger.info("wp2.queue.received", { attempt: message.attempts, scheduledTime });
      let result: ScheduledRunResult | void;
      try {
        result = await dependencies.runScheduled(
          { scheduledTime, cron: "queue", attempt: message.attempts, messageId: message.id },
          env,
          context,
          config,
        );
      } catch (error) {
        logger.error("wp2.queue.failed", {
          attempt: message.attempts,
          errorCode: queueErrorCode(error),
          scheduledTime,
        });
        throw error;
      }
      if (result === "locked") {
        logger.info("wp2.queue.retry", {
          attempt: message.attempts,
          outcome: result,
          scheduledTime,
        });
        message.retry({ delaySeconds: QUEUE_LEASE_RETRY_DELAY_SECONDS });
        return;
      }
      message.ack();
      logger.info("wp2.queue.completed", {
        attempt: message.attempts,
        outcome: result ?? "completed",
        scheduledTime,
      });
    },
  };
}

const defaultRunScheduled: NonNullable<WorkerDependencies["runScheduled"]> = async (...args) => {
  const { runWp2Scheduled } = await import("./scheduled");
  return runWp2Scheduled(...args);
};

export default createWorker({ runScheduled: defaultRunScheduled });
