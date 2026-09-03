import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/marketplace/validate/route.ts";
import { GET } from "../app/api/marketplace/validate/[requestId]/route.ts";

const endpointKey = "a".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("catalog validation request integration", () => {
  it("runs the real public handlers and adapter from enqueue through committed polling result", async () => {
    vi.stubEnv("OBSERVATIONS_URL", "https://worker.example/observations");
    vi.stubEnv("BUYER_OBSERVATION_ALLOWED_ORIGIN", "https://worker.example");
    vi.stubEnv("BUYER_OBSERVATION_SECRET", "integration-secret");

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const destination = String(url);
      if (destination === "https://worker.example/catalog-validations" && init?.method === "POST") {
        return Response.json({ status: "queued", reused: false, validationId: 23 }, { status: 202 });
      }
      if (destination === "https://worker.example/catalog-validations/23" && init?.method === "GET") {
        return Response.json({
          schemaVersion: 2,
          validation: {
            id: 23,
            agentKey: "eip155:56:303779",
            endpointKey,
            validationKind: "protocol",
            status: "completed",
            attemptCount: 2,
            createdAt: 1_000,
            startedAt: 1_100,
            completedAt: 1_250,
            errorCode: null,
            hasResult: true,
            result: {
              protocol: "mcp",
              source: "worker_probe",
              outcome: "protocol_valid",
              observedAt: 1_240,
              expiresAt: 61_240,
              httpStatus: 200,
              durationMs: 340,
            },
          },
        });
      }
      throw new Error(`Unexpected integration request: ${destination}`);
    });
    vi.stubGlobal("fetch", fetchImpl);

    const queued = await POST(new Request("http://local/api/marketplace/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "303779", endpointKey, validationKind: "protocol" }),
    }));
    expect(queued.status).toBe(202);
    const queuedPayload = await queued.json() as {
      status: string;
      requestId: string | null;
      pollAfterMs: number;
    };
    expect(queuedPayload).toMatchObject({ status: "queued", pollAfterMs: 1_500 });
    expect(queuedPayload.requestId).toEqual(expect.any(String));

    const completed = await GET(new Request(`http://local/api/marketplace/validate/${queuedPayload.requestId}`), {
      params: Promise.resolve({ requestId: queuedPayload.requestId! }),
    });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      schemaVersion: 2,
      requestId: queuedPayload.requestId,
      status: "completed",
      attemptCount: 2,
      hasResult: true,
      result: {
        protocol: "mcp",
        source: "worker_probe",
        outcome: "protocol_valid",
        observedAt: 1_240,
        httpStatus: 200,
        durationMs: 340,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
