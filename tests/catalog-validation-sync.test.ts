import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCatalogValidationStatus,
  issueCatalogValidationRequestToken,
  readCatalogValidationRequestToken,
  requestCatalogValidation,
} from "../src/data/observation/catalog-validation-sync.ts";

const endpointKey = "a".repeat(64);
const input = {
  agentId: "303779",
  endpointKey,
  validationKind: "protocol" as const,
};
const env = {
  OBSERVATIONS_URL: "https://worker.example/observations",
  BUYER_OBSERVATION_ALLOWED_ORIGIN: "https://worker.example",
  BUYER_OBSERVATION_SECRET: "buyer-secret",
};

afterEach(() => vi.unstubAllEnvs());

describe("catalog validation sync", () => {
  it("enqueues an endpoint-scoped request without exposing the endpoint or secret", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://worker.example/catalog-validations");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer buyer-secret",
        "x-marketplace-caller": expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({ schemaVersion: 2, ...input });
      expect(JSON.stringify(body)).not.toContain("buyer-secret");
      return Response.json({ status: "queued", reused: false, validationId: 17 }, { status: 202 });
    });

    await expect(requestCatalogValidation(input, { env, fetchImpl })).resolves.toEqual({
      status: "queued",
      reused: false,
      validationId: 17,
    });
  });

  it("allows a loopback Worker over HTTP during local development", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("http://127.0.0.1:8787/catalog-validations");
      return Response.json({ status: "queued", reused: false, validationId: 18 }, { status: 202 });
    });

    await expect(requestCatalogValidation(input, {
      env: {
        ...env,
        NODE_ENV: "development",
        OBSERVATIONS_URL: "http://127.0.0.1:8787/observations",
        BUYER_OBSERVATION_ALLOWED_ORIGIN: "http://127.0.0.1:8787",
      },
      fetchImpl,
    })).resolves.toEqual({ status: "queued", reused: false, validationId: 18 });
  });

  it("uses a different opaque caller fingerprint for a different request origin", async () => {
    const callerHeaders: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      callerHeaders.push(headers["x-marketplace-caller"]!);
      return Response.json({ status: "queued", reused: false, validationId: callerHeaders.length }, { status: 202 });
    });
    await requestCatalogValidation(input, { env, caller: "ip=198.51.100.10|origin=https://marketplace.example", fetchImpl });
    await requestCatalogValidation(input, { env, caller: "ip=198.51.100.11|origin=https://marketplace.example", fetchImpl });
    expect(callerHeaders[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(callerHeaders[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(callerHeaders[0]).not.toBe(callerHeaders[1]);
  });

  it("maps Worker admission errors and fails closed before network dispatch", async () => {
    const limited = vi.fn(async () => Response.json(
      { error: "rate_limited", retryAfterMs: 2_500 },
      { status: 429 },
    ));
    await expect(requestCatalogValidation(input, { env, fetchImpl: limited })).rejects.toMatchObject({
      code: "CATALOG_RATE_LIMITED",
      httpStatus: 429,
      retryAfterSeconds: 3,
    });

    const fetchImpl = vi.fn();
    await expect(requestCatalogValidation({ ...input, endpointKey: "not-a-key" }, { env, fetchImpl }))
      .rejects.toMatchObject({ code: "CATALOG_VALIDATION_INVALID_INPUT", httpStatus: 400 });
    await expect(requestCatalogValidation(input, { env: {}, fetchImpl })).rejects.toMatchObject({
      code: "CATALOG_VALIDATION_NOT_CONFIGURED",
      httpStatus: 503,
    });
    await expect(requestCatalogValidation(input, {
      env: {
        OBSERVATIONS_URL: "http://127.0.0.1:8787/observations",
        BUYER_OBSERVATION_ALLOWED_ORIGIN: "http://127.0.0.1:8787",
        BUYER_OBSERVATION_SECRET: "buyer-secret",
      },
      fetchImpl,
    })).rejects.toMatchObject({ code: "CATALOG_VALIDATION_NOT_CONFIGURED", httpStatus: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads and scopes status to the signed request target", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      schemaVersion: 2,
      validation: {
        id: 17,
        agentKey: `eip155:56:${input.agentId}`,
        endpointKey,
        validationKind: "protocol",
        status: "running",
        createdAt: 1_000,
        startedAt: 1_100,
        completedAt: null,
        attemptCount: 1,
        errorCode: null,
        hasResult: false,
        result: null,
      },
    }));
    await expect(getCatalogValidationStatus({ ...input, validationId: 17, expiresAt: 10_000 }, { env, fetchImpl }))
      .resolves.toEqual({
        status: "running",
        attemptCount: 1,
        createdAt: 1_000,
        startedAt: 1_100,
        completedAt: null,
        errorCode: null,
        hasResult: false,
        result: null,
      });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = fetchImpl.mock.calls as unknown as Array<[unknown, RequestInit]>;
    expect(String(calls[0]?.[0])).toBe("https://worker.example/catalog-validations/17");
    expect(calls[0]?.[1]).toEqual(expect.objectContaining({ method: "GET" }));
  });

  it("returns the exact committed observation so the UI can explain the check", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      schemaVersion: 2,
      validation: {
        id: 17,
        agentKey: `eip155:56:${input.agentId}`,
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
    }));

    await expect(getCatalogValidationStatus({ ...input, validationId: 17, expiresAt: 10_000 }, { env, fetchImpl }))
      .resolves.toMatchObject({
        status: "completed",
        attemptCount: 2,
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
      });
  });

  it("fails closed when hasResult is true without a result", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      schemaVersion: 2,
      validation: {
        id: 17,
        agentKey: `eip155:56:${input.agentId}`,
        endpointKey,
        validationKind: "protocol",
        status: "completed",
        attemptCount: 1,
        createdAt: 1_000,
        startedAt: 1_100,
        completedAt: 1_250,
        errorCode: null,
        hasResult: true,
        result: null,
      },
    }));

    await expect(getCatalogValidationStatus({ ...input, validationId: 17, expiresAt: 10_000 }, { env, fetchImpl }))
      .rejects.toMatchObject({ code: "CATALOG_VALIDATION_INVALID_RESPONSE", httpStatus: 502 });
  });

  it("fails closed when hasResult contradicts the public result", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      schemaVersion: 2,
      validation: {
        id: 17,
        agentKey: `eip155:56:${input.agentId}`,
        endpointKey,
        validationKind: "protocol",
        status: "completed",
        attemptCount: 1,
        createdAt: 1_000,
        startedAt: 1_100,
        completedAt: 1_250,
        errorCode: null,
        hasResult: false,
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
    }));

    await expect(getCatalogValidationStatus({ ...input, validationId: 17, expiresAt: 10_000 }, { env, fetchImpl }))
      .rejects.toMatchObject({ code: "CATALOG_VALIDATION_INVALID_RESPONSE", httpStatus: 502 });
  });

  it.each(["quote_verified", "quote_rejected"] as const)(
    "rejects %s as a protocol-validation outcome",
    async (outcome) => {
      const fetchImpl = vi.fn(async () => Response.json({
        schemaVersion: 2,
        validation: {
          id: 17,
          agentKey: `eip155:56:${input.agentId}`,
          endpointKey,
          validationKind: "protocol",
          status: "completed",
          attemptCount: 1,
          createdAt: 1_000,
          startedAt: 1_100,
          completedAt: 1_250,
          hasResult: true,
          errorCode: null,
          result: {
            protocol: "mcp",
            source: "worker_probe",
            outcome,
            observedAt: 1_240,
            expiresAt: 61_240,
            httpStatus: outcome === "quote_verified" ? 200 : 422,
            durationMs: 340,
          },
        },
      }));

      await expect(getCatalogValidationStatus({ ...input, validationId: 17, expiresAt: 10_000 }, { env, fetchImpl }))
        .rejects.toMatchObject({ code: "CATALOG_VALIDATION_INVALID_RESPONSE", httpStatus: 502 });
    },
  );

  it("rejects the internal result pointer from the public polling contract", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      schemaVersion: 2,
      validation: {
        id: 17,
        agentKey: `eip155:56:${input.agentId}`,
        endpointKey,
        validationKind: "protocol",
        status: "completed",
        attemptCount: 1,
        createdAt: 1_000,
        startedAt: 1_100,
        completedAt: 1_250,
        resultObservationId: 81,
        hasResult: true,
        errorCode: null,
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
    }));

    await expect(getCatalogValidationStatus({ ...input, validationId: 17, expiresAt: 10_000 }, { env, fetchImpl }))
      .rejects.toMatchObject({ code: "CATALOG_VALIDATION_INVALID_RESPONSE", httpStatus: 502 });
  });

  it("issues opaque, expiring request tokens and rejects tampering", () => {
    const token = issueCatalogValidationRequestToken(
      { ...input, validationId: 17 },
      { env, now: () => 1_000_000 },
    );
    expect(token).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]+$/));
    const decodedToken = Buffer.from(token!, "base64url").toString("utf8");
    expect(decodedToken).not.toContain(input.agentId);
    expect(decodedToken).not.toContain(endpointKey);
    expect(readCatalogValidationRequestToken(token!, { env, now: () => 1_000_001 })).toMatchObject({
      agentId: input.agentId,
      endpointKey,
      validationId: 17,
      expiresAt: 87_400,
    });
    expect(readCatalogValidationRequestToken(`${token}tampered`, { env, now: () => 1_000_001 })).toBeNull();
    expect(readCatalogValidationRequestToken(token!, { env, now: () => 87_401_000 })).toBeNull();
  });
});
