import { afterEach, describe, expect, it, vi } from "vitest";

import { getWorkerObservationFeed } from "../src/data/observation/worker-observation-feed.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Worker observations contract", () => {
  it("accepts the public Worker schema without depending on private quote fields", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_788_000_030_000);
    vi.stubEnv("OBSERVATIONS_URL", "https://worker.example/observations?fixture=valid");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      schemaVersion: 1,
      generatedAt: 1_788_000_000_000,
      monitoring: {
        lastSchedulerAttemptAt: 1_787_999_990_000,
        lastSchedulerPhase: "probe",
        lastSchedulerOutcome: "completed",
        producerEnabled: false,
        consumerEnabled: false,
        cronIntervalMinutes: 5,
      },
      funnel: null,
      targets: [{
        agentId: "303779",
        chainId: 56,
        transport: "a2a",
        endpoint: "https://seller.example/grid",
        name: "Grid",
        categories: ["grid_trading"],
        declarationState: "current",
        currentMetadataUpdatedAt: 1_788_000_000_000,
        lastMetadataCheckedAt: 1_788_000_000_000,
        attemptCount: 7,
        firstProbedAt: 1_787_999_000_000,
        lastProbedAt: 1_788_000_000_000,
        latest: {
          probedAt: 1_788_000_000_000,
          probeCategory: "grid_trading",
          outcome: "quote_verified",
          observedMetadataUpdatedAt: 1_788_000_000_000,
          quoteNegotiatedAt: 1_788_000_000_000,
          quoteExpiresAt: 1_788_000_060_000,
          httpStatus: 200,
          durationMs: 184,
          errorCode: null,
        },
        latestByCategory: {},
      }],
    })));

    await expect(getWorkerObservationFeed()).resolves.toMatchObject({
      status: "available",
      feed: {
        monitoring: {
          lastSchedulerPhase: "probe",
          producerEnabled: false,
          consumerEnabled: false,
          cronIntervalMinutes: 5,
        },
        targets: [{
          agentId: "303779",
          attemptCount: 7,
          firstProbedAt: 1_787_999_000_000,
          lastProbedAt: 1_788_000_000_000,
          latest: { outcome: "quote_verified", httpStatus: 200, durationMs: 184 },
        }],
      },
    });
  });

  it("keeps historical observations available when the response is older than the quote window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_788_000_061_000);
    vi.stubEnv("OBSERVATIONS_URL", "https://worker.example/observations?fixture=stale");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      schemaVersion: 1,
      generatedAt: 1_788_000_000_000,
      funnel: null,
      targets: [],
    })));

    await expect(getWorkerObservationFeed()).resolves.toMatchObject({ status: "available", feed: { targets: [] } });
  });

  it("does not erase historical monitoring when the local response cache crosses 60 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_788_000_059_000);
    vi.stubEnv("OBSERVATIONS_URL", "https://worker.example/observations?fixture=cache-boundary");
    const fetchImpl = vi.fn(async () => Response.json({
      schemaVersion: 1,
      generatedAt: 1_788_000_000_000,
      funnel: null,
      targets: [],
    }));
    vi.stubGlobal("fetch", fetchImpl);

    await expect(getWorkerObservationFeed()).resolves.toMatchObject({ status: "available" });
    vi.setSystemTime(1_788_000_061_000);
    await expect(getWorkerObservationFeed()).resolves.toMatchObject({ status: "available", feed: { targets: [] } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the Worker is absent, unavailable or malformed", async () => {
    vi.stubEnv("OBSERVATIONS_URL", "");
    await expect(getWorkerObservationFeed()).resolves.toEqual({ status: "unavailable", feed: null });

    vi.stubEnv("OBSERVATIONS_URL", "https://worker.example/observations?fixture=bad");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ schemaVersion: 1, targets: [] })));
    await expect(getWorkerObservationFeed()).resolves.toEqual({ status: "unavailable", feed: null });
  });

  it("rejects a category map whose observation declares a different category", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_788_000_030_000);
    vi.stubEnv("OBSERVATIONS_URL", "https://worker.example/observations?fixture=category-mismatch");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      schemaVersion: 1,
      generatedAt: 1_788_000_030_000,
      targets: [{
        agentId: "303779",
        chainId: 56,
        transport: "a2a",
        endpoint: "https://seller.example/grid",
        name: "Grid",
        categories: ["grid_trading"],
        declarationState: "current",
        currentMetadataUpdatedAt: 1_788_000_000_000,
        lastMetadataCheckedAt: 1_788_000_000_000,
        latest: null,
        latestByCategory: {
          grid_trading: {
            probedAt: 1_788_000_000_000,
            probeCategory: "rebalancing",
            outcome: "quote_verified",
            observedMetadataUpdatedAt: 1_788_000_000_000,
            quoteNegotiatedAt: 1_788_000_000_000,
            quoteExpiresAt: 1_788_000_060_000,
            errorCode: null,
          },
        },
      }],
    })));

    await expect(getWorkerObservationFeed()).resolves.toEqual({ status: "unavailable", feed: null });
  });
});
