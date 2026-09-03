import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { callerFingerprint as fingerprintCaller } from "./caller-fingerprint.ts";

type Environment = Readonly<Record<string, string | undefined>>;

const AGENT_ID = /^[1-9]\d*$/;
const ENDPOINT_KEY = /^[0-9a-f]{64}$/;
const MAX_REQUEST_BODY_BYTES = 1_024;
const MAX_RESPONSE_BODY_BYTES = 8 * 1_024;
const REQUEST_TIMEOUT_MS = 5_000;
const TOKEN_TTL_MS = 24 * 60 * 60_000;
const TOKEN_VERSION = 1;
const TOKEN_IV_BYTES = 12;
const TOKEN_TAG_BYTES = 16;
const TOKEN_AAD = Buffer.from("catalog-validation-request-v1", "utf8");

export interface CatalogValidationRequestInput {
  readonly agentId: string;
  readonly endpointKey: string;
  readonly validationKind: "protocol";
}

export interface CatalogValidationRequestOptions {
  readonly env?: Environment;
  readonly fetchImpl?: typeof fetch;
  /** Untrusted request context; it is HMAC'd before crossing the Worker boundary. */
  readonly caller?: string;
}

export interface CatalogValidationRequestResult {
  readonly status: "queued" | "running" | "completed";
  readonly reused: boolean;
  readonly validationId: number | null;
}

export interface CatalogValidationStatusResult {
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled";
  readonly attemptCount: number;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly errorCode: string | null;
  readonly hasResult: boolean;
  readonly result: CatalogValidationResultObservation | null;
}

export interface CatalogValidationResultObservation {
  readonly protocol: "a2a" | "mcp" | "erc8183_http";
  readonly source: "buyer_refresh" | "worker_probe" | "migration";
  /** Outcomes emitted by the endpoint protocol probe (not quote evidence). */
  readonly outcome: "protocol_valid" | "http_error" | "timeout" | "network_error" | "invalid_response" | "unsafe_url" | "unreachable" | "error";
  readonly observedAt: number;
  readonly expiresAt: number | null;
  readonly httpStatus: number | null;
  readonly durationMs: number;
}

export interface CatalogValidationRequestToken {
  readonly agentId: string;
  readonly endpointKey: string;
  readonly validationId: number;
  readonly expiresAt: number;
}

export class CatalogValidationRequestError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryAfterSeconds?: number,
    message = "The marketplace validation request could not be completed",
  ) {
    super(message);
    this.name = "CatalogValidationRequestError";
  }
}

function privateUrl(env: Environment, path: string): URL | null {
  const raw = env.OBSERVATIONS_URL?.trim();
  const allowedRaw = env.BUYER_OBSERVATION_ALLOWED_ORIGIN?.trim();
  if (!raw || !allowedRaw) return null;
  try {
    const url = new URL(raw);
    const allowed = new URL(allowedRaw);
    const loopbackDevelopment = env.NODE_ENV === "development"
      && url.protocol === "http:"
      && allowed.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && (allowed.hostname === "localhost" || allowed.hostname === "127.0.0.1");
    if ((!loopbackDevelopment && url.protocol !== "https:") || url.username || url.password
      || url.pathname !== "/observations" || url.search || url.hash
      || (!loopbackDevelopment && allowed.protocol !== "https:")
      || allowed.username || allowed.password
      || allowed.pathname !== "/" || allowed.search || allowed.hash
      || url.origin !== allowed.origin) return null;
    return new URL(path, url.origin);
  } catch {
    return null;
  }
}

function validateInput(input: CatalogValidationRequestInput): void {
  if (!AGENT_ID.test(input.agentId)
    || !ENDPOINT_KEY.test(input.endpointKey)
    || input.validationKind !== "protocol") {
    throw new CatalogValidationRequestError(
      "CATALOG_VALIDATION_INVALID_INPUT",
      400,
      undefined,
      "The validation target is invalid",
    );
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nullableInteger(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function responseErrorCode(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{1,63}$/.test(value)) return fallback;
  return `CATALOG_${value.toUpperCase()}`;
}

function validationResult(value: unknown): CatalogValidationResultObservation | null {
  if (value === null || value === undefined) return null;
  const item = record(value);
  if (!item) return null;
  const protocols = new Set(["a2a", "mcp", "erc8183_http"]);
  const sources = new Set(["buyer_refresh", "worker_probe", "migration"]);
  const outcomes = new Set([
    "protocol_valid", "http_error", "timeout", "network_error", "invalid_response",
    "unsafe_url", "unreachable", "error",
  ]);
  if (typeof item.protocol !== "string" || !protocols.has(item.protocol)
    || typeof item.source !== "string" || !sources.has(item.source)
    || typeof item.outcome !== "string" || !outcomes.has(item.outcome)
    || typeof item.observedAt !== "number" || !Number.isSafeInteger(item.observedAt) || item.observedAt < 0
    || (item.expiresAt !== null && (typeof item.expiresAt !== "number" || !Number.isSafeInteger(item.expiresAt) || item.expiresAt < 0))
    || (item.httpStatus !== null && (typeof item.httpStatus !== "number" || !Number.isInteger(item.httpStatus) || item.httpStatus < 100 || item.httpStatus > 599))
    || typeof item.durationMs !== "number" || !Number.isSafeInteger(item.durationMs) || item.durationMs < 0) return null;
  return {
    protocol: item.protocol as CatalogValidationResultObservation["protocol"],
    source: item.source as CatalogValidationResultObservation["source"],
    outcome: item.outcome as CatalogValidationResultObservation["outcome"],
    observedAt: Number(item.observedAt),
    expiresAt: item.expiresAt === null ? null : Number(item.expiresAt),
    httpStatus: item.httpStatus === null ? null : Number(item.httpStatus),
    durationMs: Number(item.durationMs),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength)
    && Number(declaredLength) > MAX_RESPONSE_BODY_BYTES) {
    throw new CatalogValidationRequestError(
      "CATALOG_VALIDATION_INVALID_RESPONSE",
      502,
      undefined,
      "The validation service returned an oversized response",
    );
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new CatalogValidationRequestError("CATALOG_VALIDATION_UNAVAILABLE", 503);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BODY_BYTES) {
    throw new CatalogValidationRequestError(
      "CATALOG_VALIDATION_INVALID_RESPONSE",
      502,
      undefined,
      "The validation service returned an oversized response",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new CatalogValidationRequestError(
      "CATALOG_VALIDATION_INVALID_RESPONSE",
      502,
      undefined,
      "The validation service returned invalid JSON",
    );
  }
  const result = record(value);
  if (!result) {
    throw new CatalogValidationRequestError(
      "CATALOG_VALIDATION_INVALID_RESPONSE",
      502,
      undefined,
      "The validation service returned an invalid response",
    );
  }
  return result;
}

function retryAfterSeconds(response: Response, payload: Record<string, unknown>): number | undefined {
  const header = response.headers.get("retry-after");
  if (header && /^\d+$/.test(header)) return Math.max(1, Math.min(86_400, Number(header)));
  const retryAfterMs = payload.retryAfterMs;
  if (typeof retryAfterMs === "number" && Number.isSafeInteger(retryAfterMs) && retryAfterMs > 0) {
    return Math.max(1, Math.min(86_400, Math.ceil(retryAfterMs / 1_000)));
  }
  return undefined;
}

function requestError(response: Response, payload: Record<string, unknown>): CatalogValidationRequestError {
  const code = responseErrorCode(
    payload.error,
    response.status === 429 ? "CATALOG_RATE_LIMITED" : "CATALOG_VALIDATION_UNAVAILABLE",
  );
  const status = response.status === 400 || response.status === 404 || response.status === 409
    || response.status === 429 || response.status === 503
    ? response.status
    : 503;
  return new CatalogValidationRequestError(
    code,
    status,
    status === 429 ? retryAfterSeconds(response, payload) : undefined,
    status === 409
      ? "This endpoint is no longer an eligible catalog target"
      : status === 429
        ? "This validation target is temporarily rate limited"
        : "The marketplace validation service is unavailable",
  );
}

function configuredDestination(
  env: Environment,
  path: string,
): { destination: URL; secret: string } {
  const destination = privateUrl(env, path);
  const secret = env.BUYER_OBSERVATION_SECRET?.trim();
  if (!destination || !secret) {
    throw new CatalogValidationRequestError(
      "CATALOG_VALIDATION_NOT_CONFIGURED",
      503,
      undefined,
      "Marketplace infrastructure validation is not configured",
    );
  }
  return { destination, secret };
}

export async function requestCatalogValidation(
  input: CatalogValidationRequestInput,
  options: CatalogValidationRequestOptions = {},
): Promise<CatalogValidationRequestResult> {
  validateInput(input);
  const env = options.env ?? process.env;
  const { destination, secret } = configuredDestination(env, "/catalog-validations");
  const body = JSON.stringify({
    schemaVersion: 2,
    agentId: input.agentId,
    endpointKey: input.endpointKey,
    validationKind: input.validationKind,
  });
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new CatalogValidationRequestError("CATALOG_VALIDATION_INVALID_INPUT", 400);
  }
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(destination, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "x-marketplace-caller": callerFingerprint(options.caller, secret),
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CatalogValidationRequestError("CATALOG_VALIDATION_UNAVAILABLE", 503);
  }
  const payload = await readJson(response);
  if (!response.ok) throw requestError(response, payload);
  const status = payload.status;
  const reused = payload.reused;
  const validationId = payload.validationId === null ? null : positiveInteger(payload.validationId);
  if ((status !== "queued" && status !== "running" && status !== "completed")
    || typeof reused !== "boolean"
    || (payload.validationId !== null && validationId === null)
    || (status === "completed" && payload.validationId !== null)) {
    throw new CatalogValidationRequestError(
      "CATALOG_VALIDATION_INVALID_RESPONSE",
      502,
      undefined,
      "The validation service returned an invalid status",
    );
  }
  return { status, reused, validationId };
}

export async function getCatalogValidationStatus(
  input: CatalogValidationRequestToken,
  options: { readonly env?: Environment; readonly fetchImpl?: typeof fetch } = {},
): Promise<CatalogValidationStatusResult> {
  if (!AGENT_ID.test(input.agentId) || !ENDPOINT_KEY.test(input.endpointKey)
    || !Number.isSafeInteger(input.validationId) || input.validationId <= 0) {
    throw new CatalogValidationRequestError("CATALOG_VALIDATION_INVALID_INPUT", 400);
  }
  const env = options.env ?? process.env;
  const { destination, secret } = configuredDestination(env, `/catalog-validations/${input.validationId}`);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(destination, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json", authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CatalogValidationRequestError("CATALOG_VALIDATION_UNAVAILABLE", 503);
  }
  const payload = await readJson(response);
  if (!response.ok) throw requestError(response, payload);
  if (payload.schemaVersion !== 2) {
    throw new CatalogValidationRequestError("CATALOG_VALIDATION_INVALID_RESPONSE", 502);
  }
  const validation = record(payload.validation);
  const id = validation ? positiveInteger(validation.id) : null;
  const agentKey = validation?.agentKey;
  const endpointKey = validation?.endpointKey;
  const status = validation?.status;
  const attemptCount = validation ? nullableInteger(validation.attemptCount) : null;
  const createdAt = validation ? positiveInteger(validation.createdAt) : null;
  const startedAt = validation ? nullableInteger(validation.startedAt) : null;
  const completedAt = validation ? nullableInteger(validation.completedAt) : null;
  const errorCode = validation?.errorCode;
  const hasResult = validation?.hasResult;
  const hasPublicResultField = validation !== null
    && Object.prototype.hasOwnProperty.call(validation, "result");
  const hasInternalResultPointer = validation !== null
    && Object.prototype.hasOwnProperty.call(validation, "resultObservationId");
  const result = validationResult(validation?.result);
  if (id !== input.validationId
    || agentKey !== `eip155:56:${input.agentId}`
    || endpointKey !== input.endpointKey
    || validation?.validationKind !== "protocol"
    || !["queued", "running", "completed", "failed", "cancelled"].includes(String(status))
    || attemptCount === null || createdAt === null
    || (validation?.startedAt !== null && startedAt === null)
    || (validation?.completedAt !== null && completedAt === null)
    || (errorCode !== null && (typeof errorCode !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(errorCode)))
    || typeof hasResult !== "boolean"
    || !hasPublicResultField
    || hasInternalResultPointer
    || (validation?.result !== null && validation?.result !== undefined && result === null)
    // The public boolean and sanitized result are one committed unit. Never
    // let an absent result be presented as evidence (or hide a real result by
    // silently changing hasResult).
    || hasResult !== (result !== null)) {
    throw new CatalogValidationRequestError("CATALOG_VALIDATION_INVALID_RESPONSE", 502);
  }
  return {
    status: status as CatalogValidationStatusResult["status"],
    attemptCount,
    createdAt,
    startedAt,
    completedAt,
    errorCode: errorCode as string | null,
    hasResult: hasResult as boolean,
    result,
  };
}

function tokenKey(secret: string): Buffer {
  return createHash("sha256").update("catalog-validation-token\0").update(secret).digest();
}

function callerFingerprint(caller: string | undefined, secret: string): string {
  return fingerprintCaller("catalog-validation-caller", caller, secret);
}

export function issueCatalogValidationRequestToken(
  input: Omit<CatalogValidationRequestToken, "expiresAt">,
  options: { readonly env?: Environment; readonly now?: () => number } = {},
): string | null {
  const secret = (options.env ?? process.env).BUYER_OBSERVATION_SECRET?.trim();
  if (!secret || !AGENT_ID.test(input.agentId) || !ENDPOINT_KEY.test(input.endpointKey)
    || !Number.isSafeInteger(input.validationId) || input.validationId <= 0) return null;
  const expiresAt = Math.floor(((options.now ?? Date.now)() + TOKEN_TTL_MS) / 1_000);
  const payload = JSON.stringify({
    v: TOKEN_VERSION,
    agentId: input.agentId,
    endpointKey: input.endpointKey,
    validationId: input.validationId,
    expiresAt,
  });
  const iv = randomBytes(TOKEN_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(secret), iv);
  cipher.setAAD(TOKEN_AAD);
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function readCatalogValidationRequestToken(
  token: string,
  options: { readonly env?: Environment; readonly now?: () => number } = {},
): CatalogValidationRequestToken | null {
  const secret = (options.env ?? process.env).BUYER_OBSERVATION_SECRET?.trim();
  if (!secret || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  let payload: string;
  try {
    const encrypted = Buffer.from(token, "base64url");
    if (encrypted.length <= TOKEN_IV_BYTES + TOKEN_TAG_BYTES) return null;
    const iv = encrypted.subarray(0, TOKEN_IV_BYTES);
    const tag = encrypted.subarray(TOKEN_IV_BYTES, TOKEN_IV_BYTES + TOKEN_TAG_BYTES);
    const ciphertext = encrypted.subarray(TOKEN_IV_BYTES + TOKEN_TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(secret), iv);
    decipher.setAAD(TOKEN_AAD);
    decipher.setAuthTag(tag);
    payload = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch { return null; }
  let value: unknown;
  try { value = JSON.parse(payload) as unknown; } catch { return null; }
  const recordValue = record(value);
  if (!recordValue
    || recordValue.v !== TOKEN_VERSION
    || !AGENT_ID.test(String(recordValue.agentId))
    || !ENDPOINT_KEY.test(String(recordValue.endpointKey))
    || positiveInteger(recordValue.validationId) === null
    || positiveInteger(recordValue.expiresAt) === null
    || Math.floor((options.now ?? Date.now)() / 1_000) >= Number(recordValue.expiresAt)) return null;
  return {
    agentId: recordValue.agentId as string,
    endpointKey: recordValue.endpointKey as string,
    validationId: recordValue.validationId as number,
    expiresAt: recordValue.expiresAt as number,
  };
}
