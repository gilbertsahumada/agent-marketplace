import { ConfigError, loadConfig, type WorkerConfig } from "./config";
import type { CommerceIndexSummary, CommerceIndexWork } from "./phases/commerce-index";
import type {
  Env,
  ExecutionContext,
  QueueBatch,
  QueueProducer,
  ScheduledController,
  WorkerEntrypoint,
} from "./types";

type ScheduledRunResult = "completed" | "duplicate" | "locked";
type StructuredLogger = Pick<Console, "info" | "error">;
const QUEUE_LEASE_RETRY_DELAY_SECONDS = 240;
const QUEUE_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export interface WorkerDependencies {
  now?: () => number;
  logger?: StructuredLogger;
  runScheduled?: (
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
    config: WorkerConfig,
  ) => Promise<ScheduledRunResult | void>;
  runCatalogValidation?: (
    validationId: number,
    env: Env,
    config: WorkerConfig,
  ) => Promise<"completed" | "duplicate">;
  verifyCatalogRegistration?: (input: {
    schemaVersion: 2;
    chainId: 56;
    agentId: string;
    txHash: `0x${string}`;
  }) => Promise<{ blockNumber: bigint }>;
  runCommerceIndex?: (
    work: CommerceIndexWork,
    env: Env,
    config: WorkerConfig,
  ) => Promise<CommerceIndexSummary>;
}

const COMMERCE_BACKFILL_MAX_MESSAGES = 100;

function queueErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)) {
    return error.message;
  }
  return "WORKER_QUEUE_FAILED";
}

function errorResponse(error: "not_found" | "invalid_configuration" | "unauthorized" | "invalid_request", status: number): Response {
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

// Serves public catalogue reads from the Workers Cache for the configured
// window. Every uncached list request costs O(agents) D1 rows, so this is the
// lever that keeps the account-wide Free read quota inside its daily budget.
async function cachedCatalogResponse(
  request: Request,
  seconds: number,
  produce: () => Promise<Response>,
): Promise<Response> {
  if (seconds <= 0) return produce();
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(request.url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await produce();
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=${seconds}, stale-while-revalidate=${seconds}`);
  const cacheable = new Response(response.body, { status: response.status, headers });
  await cache.put(key, cacheable.clone());
  return cacheable;
}

type QueueWork =
  | { kind: "scheduled"; scheduledTime: number }
  | { kind: "catalog_validation"; validationId: number; enqueuedAt: number }
  | CommerceIndexWork;

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function queueWork(body: unknown, currentTime: number): QueueWork {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("WP2_QUEUE_MESSAGE_INVALID");
  }
  const value = body as Record<string, unknown>;
  const enqueuedAtValid = nonNegativeInteger(value.enqueuedAt)
    && value.enqueuedAt <= currentTime + QUEUE_MAX_FUTURE_SKEW_MS;
  if (value.schemaVersion === 2
    && value.kind === "catalog_validation"
    && typeof value.validationId === "number"
    && Number.isSafeInteger(value.validationId)
    && value.validationId >= 1
    && enqueuedAtValid) {
    return { kind: "catalog_validation", validationId: value.validationId, enqueuedAt: value.enqueuedAt as number };
  }
  if (value.schemaVersion === 2
    && value.kind === "index_range"
    && (value.chainId === 56 || value.chainId === 97)
    && enqueuedAtValid) {
    const explicit = value.fromBlock !== undefined || value.toBlock !== undefined;
    if (!explicit) {
      return { kind: "index_range", chainId: value.chainId, fromBlock: null, toBlock: null, enqueuedAt: value.enqueuedAt as number };
    }
    if (nonNegativeInteger(value.fromBlock) && nonNegativeInteger(value.toBlock) && value.fromBlock <= value.toBlock) {
      return {
        kind: "index_range", chainId: value.chainId,
        fromBlock: value.fromBlock, toBlock: value.toBlock, enqueuedAt: value.enqueuedAt as number,
      };
    }
    throw new Error("WP2_QUEUE_MESSAGE_INVALID");
  }
  if (value.schemaVersion === 2
    && value.kind === "index_jobs"
    && (value.chainId === 56 || value.chainId === 97)
    && nonNegativeInteger(value.fromJobId)
    && nonNegativeInteger(value.toJobId)
    && value.fromJobId <= value.toJobId
    && enqueuedAtValid) {
    return {
      kind: "index_jobs", chainId: value.chainId,
      fromJobId: value.fromJobId, toJobId: value.toJobId, enqueuedAt: value.enqueuedAt as number,
    };
  }
  if (value.schemaVersion !== 1
    || typeof value.scheduledTime !== "number"
    || !Number.isSafeInteger(value.scheduledTime)
    || value.scheduledTime < 0
    || value.scheduledTime > currentTime + QUEUE_MAX_FUTURE_SKEW_MS) {
    throw new Error("WP2_QUEUE_MESSAGE_INVALID");
  }
  return { kind: "scheduled", scheduledTime: value.scheduledTime };
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
      if (request.method === "GET" && (url.pathname === "/catalog-agent" || /^\/catalog-agent\/[1-9]\d*$/.test(url.pathname))) {
        const { catalogAgentResponse } = await import("./routes/catalog-agent");
        return cachedCatalogResponse(request, config.catalogResponseCacheSeconds, () => (
          catalogAgentResponse(request, env.DB, now(), config.catalogV2ReadsEnabled ? 2 : 1)
        ));
      }
      if (request.method === "GET" && url.pathname === "/catalog-agents") {
        const { catalogAgentsResponse } = await import("./routes/catalog-agents");
        return cachedCatalogResponse(request, config.catalogResponseCacheSeconds, () => (
          catalogAgentsResponse(request, env.DB, now(), config.catalogV2ReadsEnabled ? 2 : 1)
        ));
      }
      if (request.method === "GET" && /^\/catalog-validations\/\d+$/.test(url.pathname)) {
        if (env.BUYER_OBSERVATION_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const { catalogValidationStatusResponse } = await import("./routes/catalog-validation");
        return catalogValidationStatusResponse(request, env.DB);
      }
      if (request.method === "GET" && /^\/catalog-directed-tracking\/[1-9]\d*$/.test(url.pathname)) {
        const { catalogDirectedTrackingStatusResponse } = await import("./routes/catalog-directed-tracking");
        return catalogDirectedTrackingStatusResponse(request, env.DB);
      }
      if (request.method === "POST" && url.pathname === "/catalog-directed-tracking" && url.search === "") {
        if (env.BUYER_OBSERVATION_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const { createCatalogDirectedTrackingResponse } = await import("./routes/catalog-directed-tracking");
        return createCatalogDirectedTrackingResponse(request, env.DB, {
          nowMs: now(),
          timeoutMs: config.probeTimeoutMs,
          ...(env.BSC_RPC_URL === undefined ? {} : { rpcUrl: env.BSC_RPC_URL }),
          ...(dependencies.verifyCatalogRegistration === undefined
            ? {}
            : { verifyRegistration: dependencies.verifyCatalogRegistration }),
        });
      }
      if (request.method === "POST" && url.pathname === "/catalog-validations" && url.search === "") {
        if (env.BUYER_OBSERVATION_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const { createCatalogValidationResponse } = await import("./routes/catalog-validation");
        return createCatalogValidationResponse(
          request,
          env.DB,
          env.WP2_QUEUE,
          now(),
          config.catalogValidationRequestsPerDay,
          config.catalogValidationRequestsPerCallerDay,
        );
      }
      if (request.method === "POST" && url.pathname === "/catalog-quote-evidence" && url.search === "") {
        if (env.BUYER_OBSERVATION_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const { catalogQuoteEvidenceResponse } = await import("./routes/catalog-quote-evidence");
        return catalogQuoteEvidenceResponse(request, env.DB, {
          ...(env.BSC_RPC_URL === undefined ? {} : { rpcUrl: env.BSC_RPC_URL }),
          nowMs: now(),
          timeoutMs: config.probeTimeoutMs,
        });
      }
      if (request.method === "GET" && url.pathname === "/commerce-jobs") {
        const { commerceJobsListResponse } = await import("./routes/commerce-jobs");
        return cachedCatalogResponse(request, config.catalogResponseCacheSeconds > 0 ? 30 : 0, () => (
          commerceJobsListResponse(request, env.DB)
        ));
      }
      if (request.method === "GET" && /^\/commerce-jobs\/(56|97)\/\d+$/.test(url.pathname)) {
        const { commerceJobResponse } = await import("./routes/commerce-jobs");
        return cachedCatalogResponse(request, config.catalogResponseCacheSeconds > 0 ? 30 : 0, () => (
          commerceJobResponse(request, env.DB)
        ));
      }
      if (request.method === "GET" && url.pathname === "/commerce-summary") {
        const { commerceSummaryResponse } = await import("./routes/commerce-jobs");
        return cachedCatalogResponse(request, config.catalogResponseCacheSeconds > 0 ? 30 : 0, () => (
          commerceSummaryResponse(request, env.DB)
        ));
      }
      if (request.method === "GET" && url.pathname === "/hire-events") {
        const { hireEventsListResponse } = await import("./routes/hire-events");
        // Short fixed window: verified hire history changes rarely, but the
        // catalogue-wide cache setting (300 s on staging) is too coarse for it.
        return cachedCatalogResponse(request, config.catalogResponseCacheSeconds > 0 ? 30 : 0, () => (
          hireEventsListResponse(request, env.DB)
        ));
      }
      if (request.method === "POST" && url.pathname === "/hire-events" && url.search === "") {
        if (env.BUYER_OBSERVATION_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const { callerKey } = await import("./lib/caller-key");
        const caller = callerKey(request);
        if (caller === null) {
          return Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
        }
        const { hireEventsResponse } = await import("./routes/hire-events");
        return hireEventsResponse(request, env.DB, {
          rpcUrls: {
            ...(env.BSC_RPC_URL === undefined ? {} : { 56: env.BSC_RPC_URL }),
            ...(env.BSC_TESTNET_RPC_URL === undefined ? {} : { 97: env.BSC_TESTNET_RPC_URL }),
          },
          nowMs: now(),
          timeoutMs: config.probeTimeoutMs,
          callerKey: caller,
          callerDailyLimit: config.hireEventsPerCallerDay,
        });
      }
      if (request.method === "POST" && url.pathname === "/catalog-browser-observations" && url.search === "") {
        if (env.BUYER_OBSERVATION_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const { catalogObservationResponse } = await import("./routes/catalog-observation");
        return catalogObservationResponse(request, env.DB, now());
      }
      if (request.method === "POST" && url.pathname === "/__internal/catalog-observation" && url.search === "") {
        if (env.BUYER_OBSERVATION_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const { catalogObservationResponse } = await import("./routes/catalog-observation");
        return catalogObservationResponse(request, env.DB, now());
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
      if (request.method === "GET" && url.pathname === "/__admin/catalog-operations" && url.search === "") {
        if (env.SHARED_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.SHARED_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const { catalogOperationsResponse } = await import("./routes/catalog-operations");
        return catalogOperationsResponse(env.DB, config, now());
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
      if (request.method === "POST" && url.pathname === "/__admin/commerce-backfill") {
        // Same guards as the manual scheduler route, plus the indexer flag: a
        // backfill only makes sense while the consumer accepts index messages.
        if (config.killSwitch
          || config.producerKillSwitch
          || !config.commerceIndexEnabled
          || env.DEPLOYMENT_ENV !== "staging"
          || env.STAGING_MANUAL_RUN !== "1"
          || env.SHARED_SECRET === undefined
          || context === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.SHARED_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        if (env.WP2_QUEUE === undefined) return errorResponse("invalid_configuration", 500);
        const messages = await commerceBackfillMessages(request, config, now());
        if (messages === null) return errorResponse("invalid_request", 400);
        for (const message of messages) await env.WP2_QUEUE.send(message);
        return Response.json({ enqueued: messages.length }, {
          status: 202,
          headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
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
      const expectedCron = config.cronIntervalMinutes === 1
        ? "* * * * *"
        : `*/${config.cronIntervalMinutes} * * * *`;
      if (controller.cron !== expectedCron) throw new Error("WP2_CRON_MISMATCH");
      if (env.WP2_QUEUE === undefined) throw new Error("WP2_QUEUE_BINDING_REQUIRED");
      await env.WP2_QUEUE.send({ schemaVersion: 1, scheduledTime: controller.scheduledTime });
      logger.info("wp2.cron.enqueued", { scheduledTime: controller.scheduledTime });
      if (config.commerceIndexEnabled) {
        // One cursor-driven index_range per chain that has an RPC URL; the
        // consumer reads from the chain cursor to the safe head.
        await enqueueCommerceIndexTicks(env, env.WP2_QUEUE, now());
      }
    },

    async queue(batch: QueueBatch, env, context) {
      if (batch.messages.length !== 1) throw new Error("WP2_QUEUE_BATCH_MUST_EQUAL_ONE");
      const message = batch.messages[0]!;
      const config = loadConfig(env);
      if (config.killSwitch) {
        message.ack();
        return;
      }
      const work = queueWork(message.body, now());
      if (!Number.isSafeInteger(message.attempts) || message.attempts < 1 || message.attempts > 4) {
        throw new Error("WP2_QUEUE_MESSAGE_INVALID");
      }
      if (message.id.length < 1 || message.id.length > 256) {
        throw new Error("WP2_QUEUE_MESSAGE_ID_INVALID");
      }
      logger.info("wp2.queue.received", {
        attempt: message.attempts,
        kind: work.kind,
        ...queueWorkDetails(work),
      });
      if (work.kind === "index_range" || work.kind === "index_jobs") {
        if (!config.commerceIndexEnabled) {
          // The flag is the off switch for the indexer: queued work is dropped
          // the same way the consumer kill switch drops a tick.
          message.ack();
          return;
        }
        const runner = dependencies.runCommerceIndex
          ?? ((runnerWork: CommerceIndexWork, runnerEnv: Env, runnerConfig: WorkerConfig) => (
            defaultRunCommerceIndex(runnerWork, runnerEnv, runnerConfig)
          ));
        let summary: CommerceIndexSummary;
        try {
          summary = await runner(work, env, config);
        } catch (error) {
          logger.error("commerce.index.failed", {
            attempt: message.attempts,
            errorCode: queueErrorCode(error),
            kind: work.kind,
            chainId: work.chainId,
          });
          throw error;
        }
        message.ack();
        logger.info("commerce.index.completed", {
          kind: work.kind,
          chainId: work.chainId,
          status: summary.status,
          fromBlock: summary.fromBlock,
          toBlock: summary.toBlock,
          logs: summary.logs,
          jobs: summary.jobs,
          d1Queries: summary.d1Queries,
          wallTimeMs: summary.wallTimeMs,
        });
        return;
      }
      if (work.kind === "catalog_validation") {
        const runner = dependencies.runCatalogValidation
          ?? ((validationId: number, runnerEnv: Env, runnerConfig: WorkerConfig) => (
            defaultRunCatalogValidation(validationId, runnerEnv, runnerConfig, logger)
          ));
        let result: "completed" | "duplicate";
        try {
          result = await runner(work.validationId, env, config);
        } catch (error) {
          logger.error("catalog.validation.failed", {
            attempt: message.attempts,
            errorCode: queueErrorCode(error),
            validationId: work.validationId,
          });
          throw error;
        }
        message.ack();
        logger.info("catalog.validation.completed", { validationId: work.validationId, outcome: result });
        return;
      }
      if (dependencies.runScheduled === undefined) throw new Error("WP2_QUEUE_RUNNER_REQUIRED");
      const scheduledTime = work.scheduledTime;
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

const defaultRunCommerceIndex = async (work: CommerceIndexWork, env: Env, config: WorkerConfig) => {
  const { runCommerceIndex } = await import("./phases/commerce-index");
  return runCommerceIndex(work, env, config);
};

function queueWorkDetails(work: QueueWork): Record<string, unknown> {
  switch (work.kind) {
    case "scheduled": return { scheduledTime: work.scheduledTime };
    case "catalog_validation": return { validationId: work.validationId };
    case "index_range": return { chainId: work.chainId, fromBlock: work.fromBlock, toBlock: work.toBlock };
    case "index_jobs": return { chainId: work.chainId, fromJobId: work.fromJobId, toJobId: work.toJobId };
  }
}

async function enqueueCommerceIndexTicks(env: Env, queue: QueueProducer, enqueuedAt: number): Promise<void> {
  for (const chainId of [56, 97] as const) {
    const rpcUrl = chainId === 56 ? env.BSC_RPC_URL : env.BSC_TESTNET_RPC_URL;
    if (rpcUrl === undefined) continue;
    await queue.send({ schemaVersion: 2, kind: "index_range", chainId, enqueuedAt });
  }
}

// Splits a backfill request into queue messages sized for one consumer run
// each. Returns null for a malformed body or a range too large for one call.
async function commerceBackfillMessages(
  request: Request,
  config: WorkerConfig,
  enqueuedAt: number,
): Promise<readonly Record<string, unknown>[] | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (value.chainId !== 56 && value.chainId !== 97) return null;
  const keys = Object.keys(value).sort().join(",");
  const messages: Record<string, unknown>[] = [];
  if (keys === "chainId,fromJobId,toJobId") {
    if (!nonNegativeInteger(value.fromJobId) || !nonNegativeInteger(value.toJobId) || value.fromJobId > value.toJobId) return null;
    const size = config.commerceIndexJobsPerRun;
    if (Math.ceil((value.toJobId - value.fromJobId + 1) / size) > COMMERCE_BACKFILL_MAX_MESSAGES) return null;
    for (let from = value.fromJobId; from <= value.toJobId; from += size) {
      messages.push({
        schemaVersion: 2, kind: "index_jobs", chainId: value.chainId,
        fromJobId: from, toJobId: Math.min(from + size - 1, value.toJobId), enqueuedAt,
      });
    }
    return messages;
  }
  if (keys === "chainId,fromBlock,toBlock") {
    if (!nonNegativeInteger(value.fromBlock) || !nonNegativeInteger(value.toBlock) || value.fromBlock > value.toBlock) return null;
    const size = config.commerceIndexBlocksPerRun;
    if (Math.ceil((value.toBlock - value.fromBlock + 1) / size) > COMMERCE_BACKFILL_MAX_MESSAGES) return null;
    for (let from = value.fromBlock; from <= value.toBlock; from += size) {
      messages.push({
        schemaVersion: 2, kind: "index_range", chainId: value.chainId,
        fromBlock: from, toBlock: Math.min(from + size - 1, value.toBlock), enqueuedAt,
      });
    }
    return messages;
  }
  return null;
}

const defaultRunCatalogValidation = async (
  validationId: number,
  env: Env,
  config: WorkerConfig,
  logger: StructuredLogger,
) => {
  const { runCatalogValidationRequest } = await import("./phases/catalog-validation-request");
  return runCatalogValidationRequest(
    env.DB as unknown as Parameters<typeof runCatalogValidationRequest>[0],
    validationId,
    config,
    undefined,
    undefined,
    logger,
  );
};

export default createWorker({ runScheduled: defaultRunScheduled });
