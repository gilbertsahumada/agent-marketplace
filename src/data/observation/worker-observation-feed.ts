import { AsyncTtlCache } from "../cache/async-ttl-cache.ts";
import {
  OBSERVATION_CATEGORIES,
  type ObservationCategory,
  type ObservationFeedResult,
  type WorkerObservation,
  type WorkerObservationFeed,
  type WorkerObservationTarget,
} from "../../business/entities/worker-observations.ts";

const CACHE_TTL_MS = 60_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5_000;
const cache = new AsyncTtlCache();

export async function getWorkerObservationFeed(): Promise<ObservationFeedResult> {
  const url = Reflect.get(process.env, "OBSERVATIONS_URL")?.trim();
  if (!url) return { status: "unavailable", feed: null };
  try {
    const feed = await cache.get(`observations:${url}`, CACHE_TTL_MS, async () => {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("OBSERVATIONS_UNAVAILABLE");
      return parseFeed(await response.json(), Date.now());
    });
    assertNotFuture(feed.generatedAt, Date.now());
    return { status: "available", feed };
  } catch {
    return { status: "unavailable", feed: null };
  }
}

function parseFeed(value: unknown, now: number): WorkerObservationFeed {
  if (!record(value) || value.schemaVersion !== 1 || !safeInteger(value.generatedAt)
    || !Array.isArray(value.targets)) throw new Error("OBSERVATIONS_INVALID");
  assertNotFuture(value.generatedAt, now);
  return {
    schemaVersion: 1,
    generatedAt: value.generatedAt,
    ...(record(value.monitoring) ? { monitoring: parseMonitoring(value.monitoring) } : {}),
    targets: value.targets.map(parseTarget),
  };
}

function parseTarget(value: unknown): WorkerObservationTarget {
  if (!record(value) || typeof value.agentId !== "string" || value.chainId !== 56
    || !["a2a", "erc8183_http"].includes(String(value.transport))
    || typeof value.endpoint !== "string" || !validEndpoint(value.endpoint) || !Array.isArray(value.categories)
    || (value.currentMetadataUpdatedAt !== null && !safeInteger(value.currentMetadataUpdatedAt))
    || !safeInteger(value.lastMetadataCheckedAt)
    || !["current", "removed", "metadata_unavailable"].includes(String(value.declarationState))) {
    throw new Error("OBSERVATIONS_INVALID_TARGET");
  }
  const categories = value.categories.map((entry) => {
    if (!OBSERVATION_CATEGORIES.includes(entry as ObservationCategory)) {
      throw new Error("OBSERVATIONS_INVALID_CATEGORY");
    }
    return entry as ObservationCategory;
  });
  const latestByCategory: Partial<Record<ObservationCategory, WorkerObservation>> = {};
  if (!record(value.latestByCategory)) throw new Error("OBSERVATIONS_INVALID_TARGET");
  for (const [key, observation] of Object.entries(value.latestByCategory)) {
    if (!OBSERVATION_CATEGORIES.includes(key as ObservationCategory)) {
      throw new Error("OBSERVATIONS_INVALID_CATEGORY");
    }
    const parsed = parseObservation(observation);
    if (parsed.probeCategory !== key) throw new Error("OBSERVATIONS_INVALID_CATEGORY");
    latestByCategory[key as ObservationCategory] = parsed;
  }
  return {
    agentId: value.agentId,
    chainId: 56,
    transport: value.transport as WorkerObservationTarget["transport"],
    endpoint: value.endpoint,
    name: typeof value.name === "string" ? value.name : null,
    categories,
    declarationState: value.declarationState as WorkerObservationTarget["declarationState"],
    currentMetadataUpdatedAt: value.currentMetadataUpdatedAt as number | null,
    lastMetadataCheckedAt: value.lastMetadataCheckedAt,
    ...(safeInteger(value.attemptCount) ? { attemptCount: value.attemptCount } : {}),
    firstProbedAt: safeInteger(value.firstProbedAt) ? value.firstProbedAt : null,
    lastProbedAt: safeInteger(value.lastProbedAt) ? value.lastProbedAt : null,
    latest: value.latest === null ? null : parseObservation(value.latest),
    latestByCategory,
  };
}

function parseObservation(value: unknown): WorkerObservation {
  const outcomes = ["quote_verified", "protocol_valid", "quote_rejected", "quote_invalid", "reachable", "unreachable", "unsafe_url", "error"];
  if (!record(value) || !safeInteger(value.probedAt) || !outcomes.includes(String(value.outcome))) {
    throw new Error("OBSERVATIONS_INVALID_OBSERVATION");
  }
  const category = value.probeCategory;
  if (category !== null && !OBSERVATION_CATEGORIES.includes(category as ObservationCategory)) {
    throw new Error("OBSERVATIONS_INVALID_CATEGORY");
  }
  return {
    probedAt: value.probedAt,
    probeCategory: category as ObservationCategory | null,
    outcome: value.outcome as WorkerObservation["outcome"],
    quoteExpiresAt: safeInteger(value.quoteExpiresAt) ? value.quoteExpiresAt : null,
    observedMetadataUpdatedAt: safeInteger(value.observedMetadataUpdatedAt)
      ? value.observedMetadataUpdatedAt : null,
    quoteNegotiatedAt: safeInteger(value.quoteNegotiatedAt) ? value.quoteNegotiatedAt : null,
    errorCode: typeof value.errorCode === "string" ? value.errorCode : null,
    httpStatus: safeInteger(value.httpStatus) ? value.httpStatus : null,
    durationMs: safeInteger(value.durationMs) ? value.durationMs : null,
  };
}

function parseMonitoring(value: Record<string, unknown>): NonNullable<WorkerObservationFeed["monitoring"]> {
  const phases = ["header", "sweep", "probe"];
  const outcomes = ["completed", "failed", "duplicate", "locked"];
  const phase = value.lastSchedulerPhase;
  const outcome = value.lastSchedulerOutcome;
  if ((value.lastSchedulerAttemptAt !== null && !safeInteger(value.lastSchedulerAttemptAt))
    || (phase !== null && !phases.includes(String(phase)))
    || (outcome !== null && !outcomes.includes(String(outcome)))
    || (value.producerEnabled !== undefined && typeof value.producerEnabled !== "boolean")
    || (value.consumerEnabled !== undefined && typeof value.consumerEnabled !== "boolean")
    || (value.cronIntervalMinutes !== undefined && !safeInteger(value.cronIntervalMinutes))) {
    throw new Error("OBSERVATIONS_INVALID_MONITORING");
  }
  return {
    lastSchedulerAttemptAt: value.lastSchedulerAttemptAt as number | null,
    lastSchedulerPhase: phase as NonNullable<WorkerObservationFeed["monitoring"]>["lastSchedulerPhase"],
    lastSchedulerOutcome: outcome as NonNullable<WorkerObservationFeed["monitoring"]>["lastSchedulerOutcome"],
    ...(typeof value.producerEnabled === "boolean" ? { producerEnabled: value.producerEnabled } : {}),
    ...(typeof value.consumerEnabled === "boolean" ? { consumerEnabled: value.consumerEnabled } : {}),
    ...(safeInteger(value.cronIntervalMinutes) ? { cronIntervalMinutes: value.cronIntervalMinutes } : {}),
  };
}

function assertNotFuture(generatedAt: number, now: number): void {
  if (generatedAt > now + MAX_FUTURE_CLOCK_SKEW_MS) throw new Error("OBSERVATIONS_FUTURE");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}
