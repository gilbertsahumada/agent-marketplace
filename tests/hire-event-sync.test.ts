import { afterEach, describe, expect, it, vi } from "vitest";
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
      expect(init?.headers).toMatchObject({ authorization: "Bearer buyer-secret", "content-type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({ schemaVersion: 2, ...fundedEvent });
      return Response.json({ status: "recorded" }, { status: 201 });
    });

    await expect(syncHireEvent(fundedEvent, { fetchImpl })).resolves.toEqual({ status: "recorded" });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://worker.example/hire-events"),
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
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
