import { beforeEach, describe, expect, it, vi } from "vitest";

const executeLegacy = vi.fn();
const requestCatalogValidation = vi.fn();
const issueCatalogValidationRequestToken = vi.fn();
const readCatalogValidationRequestToken = vi.fn();
const getCatalogValidationStatus = vi.fn();

vi.mock("@/src/business/composition", () => ({
  validateMarketplaceAgent: { execute: executeLegacy },
  CatalogValidationRequestError: class CatalogValidationRequestError extends Error {
    readonly code = "CATALOG_VALIDATION_UNAVAILABLE";
    readonly httpStatus = 503;
    readonly retryAfterSeconds = undefined;
  },
  requestCatalogValidation,
  issueCatalogValidationRequestToken,
  readCatalogValidationRequestToken,
  getCatalogValidationStatus,
}));

const postRoute = await import("../app/api/marketplace/validate/route.ts");
const statusRoute = await import("../app/api/marketplace/validate/[requestId]/route.ts");

describe("public catalog validation controllers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps an endpoint-scoped request to an opaque polling response", async () => {
    requestCatalogValidation.mockResolvedValue({ status: "queued", reused: false, validationId: 17 });
    issueCatalogValidationRequestToken.mockReturnValue("opaque-request-token");
    const response = await postRoute.POST(new Request("http://local/api/marketplace/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "303779",
        endpointKey: "a".repeat(64),
        validationKind: "protocol",
      }),
    }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      schemaVersion: 2,
      status: "queued",
      reused: false,
      requestId: "opaque-request-token",
      pollAfterMs: 1_500,
    });
    expect(requestCatalogValidation).toHaveBeenCalledWith({
      mode: "infrastructure",
      agentId: "303779",
      endpointKey: "a".repeat(64),
      validationKind: "protocol",
    }, { caller: "anonymous" });
    expect(executeLegacy).not.toHaveBeenCalled();
  });

  it("returns a completed response without manufacturing a polling token", async () => {
    requestCatalogValidation.mockResolvedValue({ status: "completed", reused: true, validationId: null });
    const response = await postRoute.POST(new Request("http://local/api/marketplace/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "303779",
        endpointKey: "a".repeat(64),
        validationKind: "protocol",
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "completed", reused: true, requestId: null });
    expect(issueCatalogValidationRequestToken).not.toHaveBeenCalled();
  });

  it("passes only the normalized proxy/origin context to the infrastructure adapter", async () => {
    requestCatalogValidation.mockResolvedValue({ status: "queued", reused: false, validationId: 18 });
    issueCatalogValidationRequestToken.mockReturnValue("opaque-request-token");
    const response = await postRoute.POST(new Request("http://local/api/marketplace/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://marketplace.example",
        "x-forwarded-for": "198.51.100.10, 203.0.113.5",
      },
      body: JSON.stringify({
        agentId: "303779",
        endpointKey: "a".repeat(64),
        validationKind: "protocol",
      }),
    }));

    expect(response.status).toBe(202);
    expect(requestCatalogValidation).toHaveBeenCalledWith(expect.objectContaining({ agentId: "303779" }), {
      caller: "198.51.100.10|https://marketplace.example",
    });
  });

  it("rejects an infrastructure request that omits the endpoint key", async () => {
    const response = await postRoute.POST(new Request("http://local/api/marketplace/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "303779", validationKind: "protocol" }),
    }));
    expect(response.status).toBe(400);
    expect(requestCatalogValidation).not.toHaveBeenCalled();
  });

  it("maps an opaque token to a status response without exposing the Worker route", async () => {
    readCatalogValidationRequestToken.mockReturnValue({
      agentId: "303779",
      endpointKey: "a".repeat(64),
      validationId: 17,
      expiresAt: 99_999,
    });
    getCatalogValidationStatus.mockResolvedValue({
      status: "completed",
      attemptCount: 1,
      createdAt: 1_000,
      startedAt: 1_100,
      completedAt: 1_200,
      errorCode: null,
      hasResult: true,
      result: null,
    });
    const response = await statusRoute.GET(new Request("http://local/api/marketplace/validate/opaque"), {
      params: Promise.resolve({ requestId: "opaque" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 2,
      requestId: "opaque",
      status: "completed",
      attemptCount: 1,
      createdAt: 1_000,
      startedAt: 1_100,
      completedAt: 1_200,
      errorCode: null,
      hasResult: true,
      result: null,
    });
    expect(getCatalogValidationStatus).toHaveBeenCalledWith(expect.objectContaining({ validationId: 17 }));
  });

  it("does not reveal whether an invalid polling token exists", async () => {
    readCatalogValidationRequestToken.mockReturnValue(null);
    const response = await statusRoute.GET(new Request("http://local/api/marketplace/validate/tampered"), {
      params: Promise.resolve({ requestId: "tampered" }),
    });
    expect(response.status).toBe(404);
    expect(getCatalogValidationStatus).not.toHaveBeenCalled();
  });
});
