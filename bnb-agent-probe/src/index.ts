import { ConfigError, loadConfig, type WorkerConfig } from "./config";
import { healthResponse } from "./routes/health";
import { runWp2Scheduled } from "./scheduled";
import type {
  Env,
  ExecutionContext,
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

    async scheduled(controller, env, context) {
      const config = loadConfig(env);
      if (config.killSwitch || dependencies.runScheduled === undefined) return;
      await dependencies.runScheduled(controller, env, context, config);
    },
  };
}

export default createWorker({ runScheduled: runWp2Scheduled });
