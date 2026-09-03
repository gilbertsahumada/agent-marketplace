import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketplaceRateLimitError } from "../src/business/errors/marketplace-errors.ts";
import { syncHireEvent } from "../src/data/observation/hire-event-sync.ts";

const fundedEvent = {
  agentId: "303779",
  chainId: 56,
  phase: "funded",
  jobId: "551",
  txHash: `0x${"ab".repeat(32)}`,
} as const;

function configure() {
  vi.stubEnv("OBSERVATIONS_URL", "https://worker.example/observations");
  vi.stubEnv("BUYER_OBSERVATION_ALLOWED_ORIGIN", "https://worker.example");
  vi.stubEnv("BUYER_OBSERVATION_SECRET", "buyer-secret");
}

afterEach(() => vi.unstubAllEnvs());

describe("hire event sync", () => {
  it("forwards the sanitized event with the buyer bearer to the Worker hire-events route", async () => {
    configure();
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer buyer-secret",
        "content-type": "application/json",
        "x-marketplace-caller": expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(JSON.parse(String(init?.body))).toEqual({ schemaVersion: 2, ...fundedEvent });
      return Response.json({ status: "recorded" }, { status: 201 });
    });

    await expect(syncHireEvent(fundedEvent, { fetchImpl, caller: "203.0.113.1|same-origin" })).resolves.toEqual({ status: "recorded" });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://worker.example/hire-events"),
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("fingerprints the caller per purpose so hire events never share a bucket with validation requests", async () => {
    configure();
    const headers: string[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      headers.push((init?.headers as Record<string, string>)["x-marketplace-caller"]!);
      return Response.json({ status: "recorded" }, { status: 201 });
    });
    await syncHireEvent(fundedEvent, { fetchImpl, caller: "203.0.113.1|same-origin" });
    await syncHireEvent(fundedEvent, { fetchImpl, caller: "203.0.113.1|same-origin" });
    await syncHireEvent(fundedEvent, { fetchImpl, caller: "198.51.100.7|same-origin" });
    await syncHireEvent(fundedEvent, { fetchImpl });
    expect(headers[0]).toBe(headers[1]);
    expect(new Set(headers).size).toBe(3);
    for (const header of headers) expect(header).not.toContain("203.0.113.1");
  });

  it("maps duplicate, rejected and failed Worker answers without throwing", async () => {
    configure();
    for (const [status, expected] of [[200, "duplicate"], [409, "rejected"], [503, "failed"], [500, "failed"]] as const) {
      const fetchImpl = vi.fn(async () => Response.json({}, { status }));
      await expect(syncHireEvent(fundedEvent, { fetchImpl })).resolves.toEqual({ status: expected });
    }
    const throwing = vi.fn(async () => { throw new Error("network"); });
    await expect(syncHireEvent(fundedEvent, { fetchImpl: throwing })).resolves.toEqual({ status: "failed" });
  });

  it("surfaces the Worker's per-caller budget as a rate limit with its retry window", async () => {
    configure();
    const withHeader = vi.fn(async () => Response.json({ error: "caller_daily_budget_exhausted", retryAfterMs: 5_000 }, {
      status: 429,
      headers: { "retry-after": "3600" },
    }));
    await expect(syncHireEvent(fundedEvent, { fetchImpl: withHeader })).rejects.toMatchObject({
      name: "MarketplaceRateLimitError",
      retryAfterSeconds: 3_600,
      message: "Hire event reporting is temporarily at capacity",
    });
    const payloadOnly = vi.fn(async () => Response.json({ retryAfterMs: 90_500 }, { status: 429 }));
    await expect(syncHireEvent(fundedEvent, { fetchImpl: payloadOnly })).rejects.toBeInstanceOf(MarketplaceRateLimitError);
    await expect(syncHireEvent(fundedEvent, { fetchImpl: payloadOnly })).rejects.toMatchObject({ retryAfterSeconds: 91 });
    const bare = vi.fn(async () => new Response(null, { status: 429 }));
    await expect(syncHireEvent(fundedEvent, { fetchImpl: bare })).rejects.toMatchObject({ retryAfterSeconds: 60 });
  });

  it("does not call the network when the Worker or its origin allowlist is not configured", async () => {
    const fetchImpl = vi.fn();
    await expect(syncHireEvent(fundedEvent, { fetchImpl })).resolves.toEqual({ status: "not_configured" });

    vi.stubEnv("OBSERVATIONS_URL", "https://worker.example/observations");
    vi.stubEnv("BUYER_OBSERVATION_ALLOWED_ORIGIN", "https://other.example");
    vi.stubEnv("BUYER_OBSERVATION_SECRET", "buyer-secret");
    await expect(syncHireEvent(fundedEvent, { fetchImpl })).resolves.toEqual({ status: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
