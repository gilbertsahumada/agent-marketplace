import { describe, expect, it, vi } from "vitest";
import {
  catalogEndpointKey,
  syncCatalogObservation,
} from "../src/data/observation/catalog-observation-sync.ts";

const input = {
  source: "browser_reported" as const,
  agentId: "45422",
  protocol: "mcp" as const,
  endpoint: "https://seller.example/mcp",
  outcome: "protocol_valid" as const,
  observedAt: "2026-08-30T00:00:00.000Z",
  expiresAt: "2026-08-30T00:15:00.000Z",
  httpStatus: 200,
  errorCode: null,
  durationMs: 42,
  details: { capabilityCount: 2, cors: true, method: "POST" as const },
};

describe("catalog observation sync", () => {
  it("posts only sanitized evidence to the private Worker route", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: "recorded", id: 1 }, { status: 201 }));
    const result = await syncCatalogObservation(input, {
      env: {
        OBSERVATIONS_URL: "https://worker.example/observations",
        BUYER_OBSERVATION_ALLOWED_ORIGIN: "https://worker.example",
        BUYER_OBSERVATION_SECRET: "private-secret",
      },
      fetchImpl,
    });

    expect(result).toEqual({ status: "recorded" });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://worker.example/catalog-browser-observations"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer private-secret" }),
      }),
    );
    const calls = fetchImpl.mock.calls as unknown as Array<[URL, RequestInit]>;
    const payload = JSON.parse(String(calls[0]?.[1].body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      agentId: "45422",
      endpointKey: catalogEndpointKey("mcp", input.endpoint),
      source: "browser_reported",
      outcome: "protocol_valid",
    });
    expect(JSON.stringify(payload)).not.toContain("private-secret");
    expect(JSON.stringify(payload)).not.toContain(input.endpoint);
  });

  it("allows a loopback Worker over HTTP during local development", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("http://127.0.0.1:8787/catalog-browser-observations");
      return Response.json({ status: "recorded" }, { status: 201 });
    });

    await expect(syncCatalogObservation(input, {
      env: {
        NODE_ENV: "development",
        OBSERVATIONS_URL: "http://127.0.0.1:8787/observations",
        BUYER_OBSERVATION_ALLOWED_ORIGIN: "http://127.0.0.1:8787",
        BUYER_OBSERVATION_SECRET: "private-secret",
      },
      fetchImpl,
    })).resolves.toEqual({ status: "recorded" });
  });

  it("fails closed for missing config, origin confusion or unsafe endpoints", async () => {
    expect(await syncCatalogObservation(input, { env: {} })).toEqual({ status: "not_configured" });
    expect(await syncCatalogObservation(input, { env: {
      OBSERVATIONS_URL: "https://attacker.example/observations",
      BUYER_OBSERVATION_ALLOWED_ORIGIN: "https://worker.example",
      BUYER_OBSERVATION_SECRET: "secret",
    } })).toEqual({ status: "not_configured" });
    expect(await syncCatalogObservation(input, { env: {
      OBSERVATIONS_URL: "http://127.0.0.1:8787/observations",
      BUYER_OBSERVATION_ALLOWED_ORIGIN: "http://127.0.0.1:8787",
      BUYER_OBSERVATION_SECRET: "secret",
    } })).toEqual({ status: "not_configured" });
    expect(await syncCatalogObservation({ ...input, endpoint: "http://127.0.0.1" }, {
      env: {
        OBSERVATIONS_URL: "https://worker.example/observations",
        BUYER_OBSERVATION_ALLOWED_ORIGIN: "https://worker.example",
        BUYER_OBSERVATION_SECRET: "secret",
      },
    })).toEqual({ status: "failed" });
  });
});
