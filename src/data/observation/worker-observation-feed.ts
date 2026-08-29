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
      return parseFeed(await response.json());
    });
    return { status: "available", feed };
  } catch {
    return { status: "unavailable", feed: null };
  }
}

function parseFeed(value: unknown): WorkerObservationFeed {
  if (!record(value) || value.schemaVersion !== 1 || !safeInteger(value.generatedAt)
    || !Array.isArray(value.targets)) throw new Error("OBSERVATIONS_INVALID");
  return {
    schemaVersion: 1,
    generatedAt: value.generatedAt,
    targets: value.targets.map(parseTarget),
  };
}

function parseTarget(value: unknown): WorkerObservationTarget {
  if (!record(value) || typeof value.agentId !== "string" || !Array.isArray(value.categories)
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
    latestByCategory[key as ObservationCategory] = parseObservation(observation);
  }
  return {
    agentId: value.agentId,
    name: typeof value.name === "string" ? value.name : null,
    categories,
    declarationState: value.declarationState as WorkerObservationTarget["declarationState"],
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
    errorCode: typeof value.errorCode === "string" ? value.errorCode : null,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
