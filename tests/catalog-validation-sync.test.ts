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
      expect(init?.headers).toMatchObject({ authorization: "Bearer buyer-secret" });
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
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads and scopes status to the signed request target", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      schemaVersion: 2,
      validation: {
        id: 17,
        dedupeKey: `eip155:56:${input.agentId}:${endpointKey}:protocol`,
        agentKey: `eip155:56:${input.agentId}`,
        endpointKey,
        validationKind: "protocol",
        requestedBy: "browser_fallback",
        status: "running",
        priority: 1_000,
        createdAt: 1_000,
        startedAt: 1_100,
        completedAt: null,
        attemptCount: 1,
        resultObservationId: null,
        errorCode: null,
        leaseOwner: null,
        leaseExpiresAt: null,
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
      });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = fetchImpl.mock.calls as unknown as Array<[unknown, RequestInit]>;
    expect(String(calls[0]?.[0])).toBe("https://worker.example/catalog-validations/17");
    expect(calls[0]?.[1]).toEqual(expect.objectContaining({ method: "GET" }));
  });

  it("issues opaque, expiring request tokens and rejects tampering", () => {
    const token = issueCatalogValidationRequestToken(
      { ...input, validationId: 17 },
      { env, now: () => 1_000_000 },
    );
    expect(token).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/));
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
