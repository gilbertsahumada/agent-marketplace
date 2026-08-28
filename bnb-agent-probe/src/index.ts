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

function errorResponse(error: "not_found" | "invalid_configuration", status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function createWorker(dependencies: WorkerDependencies = {}): WorkerEntrypoint {
  const now = dependencies.now ?? Date.now;

  return {
    async fetch(request, env) {
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
