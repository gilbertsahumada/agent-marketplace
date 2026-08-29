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
        latest: {
          probedAt: 1_788_000_000_000,
          probeCategory: "grid_trading",
          outcome: "quote_verified",
          observedMetadataUpdatedAt: 1_788_000_000_000,
          quoteNegotiatedAt: 1_788_000_000_000,
          quoteExpiresAt: 1_788_000_060_000,
          errorCode: null,
        },
        latestByCategory: {},
      }],
    })));

    await expect(getWorkerObservationFeed()).resolves.toMatchObject({
      status: "available",
      feed: { targets: [{ agentId: "303779", latest: { outcome: "quote_verified" } }] },
    });
  });

  it("rejects a successfully returned but expired observation response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_788_000_061_000);
    vi.stubEnv("OBSERVATIONS_URL", "https://worker.example/observations?fixture=stale");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      schemaVersion: 1,
      generatedAt: 1_788_000_000_000,
      funnel: null,
      targets: [],
    })));

    await expect(getWorkerObservationFeed()).resolves.toEqual({ status: "unavailable", feed: null });
  });

  it("does not serve a cached feed past generatedAt plus 60 seconds", async () => {
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
    await expect(getWorkerObservationFeed()).resolves.toEqual({ status: "unavailable", feed: null });
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
