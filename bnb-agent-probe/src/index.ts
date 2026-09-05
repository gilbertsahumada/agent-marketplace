import { ConfigError, loadConfig, type WorkerConfig } from "./config";
import type { D1DatabaseLike } from "./db/client";
import type { CommerceIndexSummary, CommerceIndexWork } from "./phases/commerce-index";
import type { CatalogCapabilityProbeSummary, CatalogCapabilityWork } from "./phases/catalog-capability";
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
  runCatalogCapabilityProbe?: (
    work: CatalogCapabilityWork,
    env: Env,
    config: WorkerConfig,
  ) => Promise<CatalogCapabilityProbeSummary>;
}

const COMMERCE_BACKFILL_MAX_MESSAGES = 100;
// Same cap as the catalog-validation body: a backfill request is three numbers.
const COMMERCE_BACKFILL_MAX_BODY_BYTES = 1_024;

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

// One cache key per distinct query, not per distinct spelling of it: the
// parameters are sorted by key and re-encoded from their decoded values, so
// equivalent requests share one entry. Routes reject duplicate keys before
// this matters, but the key must not depend on their original ordering.
function canonicalCacheKey(url: URL): Request {
  const canonical = new URL(url.pathname, url.origin);
  const entries = [...url.searchParams.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  for (const [key, value] of entries) canonical.searchParams.append(key, value);
  return new Request(canonical.toString(), { method: "GET" });
}

// Serves public catalogue reads from the Workers Cache for the configured
// window. Every uncached list request costs O(agents) D1 rows, so this is the
// lever that keeps the account-wide Free read quota inside its daily budget.
async function cachedCatalogResponse(
  request: Request,
  seconds: number,
  produce: () => Promise<Response>,
  fresh = false,
): Promise<Response> {
  if (fresh) {
    const response = await produce();
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  }
  if (seconds <= 0) return produce();
  const cache = (caches as unknown as { default: Cache }).default;
  const key = canonicalCacheKey(new URL(request.url));
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
  | { kind: "index_identities"; chainId: 56 | 97; enqueuedAt: number }
  | { kind: "scheduled"; scheduledTime: number }
  | { kind: "catalog_validation"; validationId: number; enqueuedAt: number }
  | CatalogCapabilityWork
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
  if (value.schemaVersion === 1 && value.kind === "index_identities"
    && (value.chainId === 56 || value.chainId === 97) && enqueuedAtValid) {
    return { kind: "index_identities", chainId: value.chainId, enqueuedAt: value.enqueuedAt as number };
  }
  if (value.schemaVersion === 2
    && value.kind === "catalog_capability_probe"
    && typeof value.agentKey === "string"
    && /^eip155:56:[1-9]\d{0,19}$/.test(value.agentKey)
    && typeof value.endpointKey === "string"
    && /^[a-f0-9]{64}$/.test(value.endpointKey)
    && enqueuedAtValid) {
    return {
      schemaVersion: 2,
      kind: "catalog_capability_probe",
      agentKey: value.agentKey,
      endpointKey: value.endpointKey,
      enqueuedAt: value.enqueuedAt as number,
    };
  }
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
      if (value.afterLogIndex !== undefined && !nonNegativeInteger(value.afterLogIndex)) {
        throw new Error("WP2_QUEUE_MESSAGE_INVALID");
      }
      if (value.hops !== undefined && (!nonNegativeInteger(value.hops) || value.hops > 100)) {
        throw new Error("WP2_QUEUE_MESSAGE_INVALID");
      }
      return {
        kind: "index_range", chainId: value.chainId,
        fromBlock: value.fromBlock, toBlock: value.toBlock,
        ...(value.afterLogIndex === undefined ? {} : { afterLogIndex: value.afterLogIndex as number }),
        ...(value.hops === undefined ? {} : { hops: value.hops as number }),
        enqueuedAt: value.enqueuedAt as number,
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
        return healthResponse(env.DB, config, now(), {
          quoteQueueAvailable: env.CATALOG_QUOTE_QUEUE !== undefined,
          rpcConfigured: {
            56: typeof env.BSC_RPC_URL === "string" && env.BSC_RPC_URL.trim().length > 0,
            97: typeof env.BSC_TESTNET_RPC_URL === "string" && env.BSC_TESTNET_RPC_URL.trim().length > 0,
          },
        });
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
        const fresh = request.headers.get("x-marketplace-refresh") === "1" && Boolean(env.BUYER_OBSERVATION_SECRET)
          && await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET!);
        return cachedCatalogResponse(request, fresh ? 0 : config.catalogResponseCacheSeconds, () => (
          catalogAgentResponse(request, env.DB, now(), config.catalogV2ReadsEnabled ? 2 : 1)
        ), fresh);
      }
      if (request.method === "GET" && url.pathname === "/catalog-agents") {
        const { catalogAgentsResponse } = await import("./routes/catalog-agents");
        const fresh = request.headers.get("x-marketplace-refresh") === "1" && Boolean(env.BUYER_OBSERVATION_SECRET)
          && await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET!);
        return cachedCatalogResponse(request, fresh ? 0 : config.catalogResponseCacheSeconds, () => (
          catalogAgentsResponse(request, env.DB, now(), config.catalogV2ReadsEnabled ? 2 : 1)
        ), fresh);
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
      if (request.method === "GET" && /^\/catalog-quotes\/[1-9]\d{0,19}\/input$/.test(url.pathname)) {
        if (env.BUYER_OBSERVATION_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET)) return errorResponse("unauthorized", 401);
        const { catalogNegotiationInputResponse, callerForQuote } = await import("./routes/catalog-quotes");
        return catalogNegotiationInputResponse(env.DB, url.pathname.split("/")[2]!, { caller: callerForQuote(request), nowMs: now() });
      }
      if ((request.method === "POST" && /^\/catalog-quotes\/[1-9]\d{0,19}$/.test(url.pathname))
        || (request.method === "GET" && /^\/catalog-quotes\/[1-9]\d{0,19}$/.test(url.pathname))) {
        if (env.BUYER_OBSERVATION_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const { createCatalogQuoteRequestResponse, catalogQuoteHistoryResponse, callerForQuote } = await import("./routes/catalog-quotes");
        if (request.method === "GET") return catalogQuoteHistoryResponse(request, env.DB, url.pathname.split("/").at(-1)!, now());
        return createCatalogQuoteRequestResponse(request, env.DB, {
          nowMs: now(),
          caller: callerForQuote(request),
          dailyLimit: config.catalogValidationRequestsPerDay,
          callerDailyLimit: config.catalogValidationRequestsPerCallerDay,
          agentDailyLimit: config.catalogValidationRequestsPerAgentDay,
          originDailyLimit: config.catalogValidationRequestsPerOriginDay,
        });
      }
      if (request.method === "POST" && /^\/catalog-quotes\/(?:[1-9]\d{0,19}\/)?attempt\/[0-9a-f-]{16,80}\/(result|fallback)$/.test(url.pathname)) {
        if (env.BUYER_OBSERVATION_SECRET === undefined) return errorResponse("not_found", 404);
        if (!await bearerMatches(request.headers.get("authorization"), env.BUYER_OBSERVATION_SECRET)) {
          return errorResponse("unauthorized", 401);
        }
        const { catalogQuoteBrowserResultResponse, catalogQuoteFallbackResponse } = await import("./routes/catalog-quotes");
        const parts = url.pathname.split("/");
        const attemptId = parts.at(-2)!;
        const expectedAgentId = parts[2] === "attempt" ? undefined : parts[2];
        const options = { nowMs: now(), env, config, ...(expectedAgentId ? { expectedAgentId } : {}) };
        return url.pathname.endsWith("/result")
          ? catalogQuoteBrowserResultResponse(request, env.DB, attemptId, options)
          : catalogQuoteFallbackResponse(request, env.DB, attemptId, options);
      }
      if (request.method === "GET" && url.pathname === "/job-agent-identities") {
        const { jobAgentIdentitiesResponse } = await import("./routes/job-agent-identities");
        return cachedCatalogResponse(request, config.catalogResponseCacheSeconds > 0 ? 30 : 0, () => (
          jobAgentIdentitiesResponse(request, env.DB as unknown as D1DatabaseLike)
        ));
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
      if (request.method === "GET" && url.pathname === "/commerce-activity") {
        const { COMMERCE_ACTIVITY_CACHE_SECONDS, commerceActivityResponse } = await import("./routes/commerce-jobs");
        // Same window as the route's own cache-control, so the rewrite is a no-op.
        const seconds = config.catalogResponseCacheSeconds > 0 ? COMMERCE_ACTIVITY_CACHE_SECONDS : 0;
        return cachedCatalogResponse(request, seconds, () => commerceActivityResponse(request, env.DB, now()));
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
      if (env.AGENT_IDENTITY_INDEX_ENABLED === "1") {
        for (const chainId of [56, 97] as const) {
          if (chainId === 56 ? env.BSC_RPC_URL : env.BSC_TESTNET_RPC_URL) {
            await env.WP2_QUEUE.send({ schemaVersion: 1, kind: "index_identities", chainId, enqueuedAt: now() });
          }
        }
      }
      if (config.commerceIndexEnabled) {
        // One cursor-driven index_range per chain that has an RPC URL; the
        // consumer reads from the chain cursor to the safe head.
        await enqueueCommerceIndexTicks(env, env.WP2_QUEUE, now(), logger);
      }
      if (config.catalogProbeEnabled && config.catalogV2WritesEnabled && env.CATALOG_QUOTE_QUEUE !== undefined) {
        const { enqueueDueCatalogCapabilities } = await import("./phases/catalog-capability");
        const summary = await enqueueDueCatalogCapabilities(env.DB as never, env.CATALOG_QUOTE_QUEUE, {
          nowMs: now(),
          limit: config.catalogQuoteBatchSize,
          concurrency: config.catalogQuoteConcurrency,
          bootstrapLimit: Number(env.CATALOG_COMPATIBILITY_BOOTSTRAP_BATCH_SIZE ?? "0"),
        });
        logger.info("catalog.quote.queue.enqueued", { ...summary, scheduledTime: controller.scheduledTime });
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
      if (work.kind === "index_identities") {
        if (env.AGENT_IDENTITY_INDEX_ENABLED !== "1") { message.ack(); return; }
        const rpcUrl = work.chainId === 56 ? env.BSC_RPC_URL : env.BSC_TESTNET_RPC_URL;
        if (!rpcUrl) throw new Error("IDENTITY_INDEX_RPC_REQUIRED");
        const { runIdentityIndex, identityIndexReader } = await import("./identity/indexer");
        try {
          const summary = await runIdentityIndex(env.DB as unknown as D1DatabaseLike, work.chainId, identityIndexReader(rpcUrl, work.chainId), now());
          logger.info("identity.index.completed", summary);
        } catch (error) {
          logger.error("identity.index.failed", { chainId: work.chainId, attempt: message.attempts, errorCode: "IDENTITY_INDEX_FAILED" });
          throw error;
        }
        message.ack();
        return;
      }
      if (work.kind === "catalog_capability_probe") {
        if (!config.catalogProbeEnabled || !config.catalogV2WritesEnabled) {
          message.ack();
          return;
        }
        const runner = dependencies.runCatalogCapabilityProbe
          ?? (async (probeWork: CatalogCapabilityWork, runnerEnv: Env, runnerConfig: WorkerConfig) => {
            const { runCatalogCapabilityProbe } = await import("./phases/catalog-capability");
            return runCatalogCapabilityProbe(probeWork, runnerEnv, runnerConfig);
          });
        let summary: CatalogCapabilityProbeSummary;
        try {
          summary = await runner(work, env, config);
        } catch (error) {
          logger.error("catalog.quote.queue.failed", {
            attempt: message.attempts,
            errorCode: queueErrorCode(error),
            agentKey: work.agentKey,
            endpointKey: work.endpointKey,
          });
          throw error;
        }
        message.ack();
        logger.info("catalog.quote.queue.completed", summary);
        return;
      }
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
            ...commerceWorkRange(work),
          });
          throw error;
        }
        message.ack();
        logger.info("commerce.index.completed", {
          kind: work.kind,
          chainId: work.chainId,
          ...commerceWorkRange(work),
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
    case "index_identities": return { chainId: work.chainId };
    case "scheduled": return { scheduledTime: work.scheduledTime };
    case "catalog_validation": return { validationId: work.validationId };
    case "catalog_capability_probe": return { agentKey: work.agentKey, endpointKey: work.endpointKey };
    case "index_range": return {
      chainId: work.chainId, fromBlock: work.fromBlock, toBlock: work.toBlock,
      ...(work.afterLogIndex === undefined || work.afterLogIndex === null ? {} : { afterLogIndex: work.afterLogIndex }),
      ...(work.hops === undefined ? {} : { hops: work.hops }),
    };
    case "index_jobs": return { chainId: work.chainId, fromJobId: work.fromJobId, toJobId: work.toJobId };
  }
}

// The explicit window of an index message, when it has one: a cursor tick
// carries null bounds and contributes nothing, so a stalled range is
// identifiable from the failure log alone.
function commerceWorkRange(work: CommerceIndexWork): Record<string, number> {
  if (work.kind === "index_jobs") return { fromJobId: work.fromJobId, toJobId: work.toJobId };
  return {
    ...(work.fromBlock === null ? {} : { fromBlock: work.fromBlock }),
    ...(work.toBlock === null ? {} : { toBlock: work.toBlock }),
    ...(work.afterLogIndex === undefined || work.afterLogIndex === null ? {} : { afterLogIndex: work.afterLogIndex }),
    ...(work.hops === undefined ? {} : { hops: work.hops }),
  };
}

async function enqueueCommerceIndexTicks(
  env: Env,
  queue: QueueProducer,
  enqueuedAt: number,
  logger: StructuredLogger,
): Promise<void> {
  for (const chainId of [56, 97] as const) {
    const rpcUrl = chainId === 56 ? env.BSC_RPC_URL : env.BSC_TESTNET_RPC_URL;
    if (rpcUrl === undefined) {
      // The flag is on but the chain cannot be read: say so every tick rather
      // than leave /health with a null cursor and no explanation.
      logger.info("commerce.index.skipped", { chainId, reason: "rpc_url_missing" });
      continue;
    }
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
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > COMMERCE_BACKFILL_MAX_BODY_BYTES) return null;
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
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
