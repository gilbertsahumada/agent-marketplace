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
        name: "Grid",
        categories: ["grid_trading"],
        declarationState: "current",
        latest: {
          probedAt: 1_788_000_000_000,
          probeCategory: "grid_trading",
          outcome: "quote_verified",
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

  it("fails closed when the Worker is absent, unavailable or malformed", async () => {
    vi.stubEnv("OBSERVATIONS_URL", "");
    await expect(getWorkerObservationFeed()).resolves.toEqual({ status: "unavailable", feed: null });

    vi.stubEnv("OBSERVATIONS_URL", "https://worker.example/observations?fixture=bad");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ schemaVersion: 1, targets: [] })));
    await expect(getWorkerObservationFeed()).resolves.toEqual({ status: "unavailable", feed: null });
  });
});
