import type {
  BrowserValidationResult,
  BrowserValidationTarget,
} from "../business/entities/browser-validation.ts";
export type {
  BrowserValidationOutcome,
  BrowserValidationProtocol,
  BrowserValidationResult,
  BrowserValidationTarget,
} from "../business/entities/browser-validation.ts";

interface ValidationOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  monotonicNow?: () => number;
  timeoutMs?: number;
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const VALID_FOR_MS = 15 * 60_000;

function safePublicUrl(endpoint: string): URL | null {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return null;
    if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return null;
    return url;
  } catch {
    return null;
  }
}

function routeUrl(endpoint: URL, route: string): string {
  const result = new URL(endpoint);
  const path = result.pathname.replace(/\/+$/, "");
  if (path.endsWith(`/${route}`)) return result.toString();
  result.pathname = `${path}/${route}`.replace(/\/{2,}/g, "/");
  return result.toString();
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) {
    throw new Error("RESPONSE_TOO_LARGE");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error("RESPONSE_TOO_LARGE");
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
    if (!data) throw new Error("INVALID_RESPONSE");
    return JSON.parse(data) as unknown;
  }
  return JSON.parse(text) as unknown;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

function headers(sessionId?: string): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
  };
}

async function validateMcp(url: URL, fetchImpl: typeof fetch, signal: AbortSignal): Promise<{
  status: number;
  capabilityCount: number;
}> {
  const initialize = await fetchImpl(url, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: headers(),
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "bnb-agent-marketplace-browser", version: "1.0.0" },
      },
    }),
  });
  if (!initialize.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: initialize.status });
  const initialized = record(await boundedJson(initialize));
  if (initialized.jsonrpc !== "2.0" || !record(initialized.result).protocolVersion) {
    throw new Error("INVALID_RESPONSE");
  }
  const sessionId = initialize.headers.get("mcp-session-id") ?? undefined;
  const notification = await fetchImpl(url, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: headers(sessionId),
    signal,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  if (!notification.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: notification.status });
  const toolsResponse = await fetchImpl(url, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: headers(sessionId),
    signal,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  if (!toolsResponse.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: toolsResponse.status });
  const tools = record(record(await boundedJson(toolsResponse)).result).tools;
  if (!Array.isArray(tools) || !tools.every((tool) => typeof record(tool).name === "string")) {
    throw new Error("INVALID_RESPONSE");
  }
  return { status: toolsResponse.status, capabilityCount: tools.length };
}

async function validateGet(
  target: BrowserValidationTarget,
  url: URL,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<{ status: number; capabilityCount: number }> {
  const destination = target.protocol === "a2a"
    ? routeUrl(url, ".well-known/agent-card.json")
    : target.protocol === "erc8183_http"
      ? routeUrl(url, "status")
      : url.toString();
  const response = await fetchImpl(destination, {
    method: "GET",
    credentials: "omit",
    redirect: "error",
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: response.status });
  const value = record(await boundedJson(response));
  if (target.protocol === "a2a") {
    if (typeof value.name !== "string" || typeof value.url !== "string" || !Array.isArray(value.skills)) {
      throw new Error("INVALID_RESPONSE");
    }
    if (new URL(value.url).origin !== url.origin) throw new Error("INVALID_RESPONSE");
    return { status: response.status, capabilityCount: value.skills.length };
  }
  if (target.protocol === "erc8183_http" && value.status !== "ok") throw new Error("INVALID_RESPONSE");
  return { status: response.status, capabilityCount: 0 };
}

export async function validateEndpointInBrowser(
  target: BrowserValidationTarget,
  options: ValidationOptions = {},
): Promise<BrowserValidationResult> {
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? performance.now.bind(performance);
  const startedAt = monotonicNow();
  const observedAtMs = now();
  const method: BrowserValidationResult["method"] = target.protocol === "mcp" ? "POST" : "GET";
  const base = {
    source: "browser_reported" as const,
    protocol: target.protocol,
    endpoint: target.endpoint,
    observedAt: new Date(observedAtMs).toISOString(),
    durationMs: 0,
    capabilityCount: 0,
    method,
  };
  const url = safePublicUrl(target.endpoint);
  if (!url) {
    return {
      ...base,
      outcome: "unsafe_url",
      expiresAt: null,
      httpStatus: null,
      errorCode: "BROWSER_UNSAFE_URL",
      message: "This declaration is not a safe public HTTPS endpoint.",
      cors: false,
    };
  }

  try {
    const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    const result = target.protocol === "mcp"
      ? await validateMcp(url, options.fetchImpl ?? fetch, signal)
      : await validateGet(target, url, options.fetchImpl ?? fetch, signal);
    return {
      ...base,
      outcome: "protocol_valid",
      expiresAt: new Date(observedAtMs + VALID_FOR_MS).toISOString(),
      httpStatus: result.status,
      durationMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
      capabilityCount: result.capabilityCount,
      errorCode: null,
      message: "The endpoint returned a protocol-valid response to this browser.",
      cors: true,
    };
  } catch (error) {
    const durationMs = Math.max(0, Math.round(monotonicNow() - startedAt));
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return { ...base, outcome: "timeout", expiresAt: null, httpStatus: null, durationMs,
        errorCode: "BROWSER_TIMEOUT", message: "The browser validation timed out.", cors: true };
    }
    if (error instanceof TypeError) {
      return { ...base, outcome: "cors_blocked", expiresAt: null, httpStatus: null, durationMs,
        errorCode: "BROWSER_FETCH_BLOCKED", message: "The browser could not read this endpoint. CORS or browser network policy may be blocking it; this is not proof that the agent is unreachable.", cors: false };
    }
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status : null;
    return {
      ...base,
      outcome: status === null ? "invalid_response" : "http_error",
      expiresAt: null,
      httpStatus: status,
      durationMs,
      errorCode: status === null ? "BROWSER_INVALID_RESPONSE" : `BROWSER_HTTP_${status}`,
      message: status === null
        ? "The endpoint responded, but its payload did not satisfy the declared protocol."
        : `The endpoint returned HTTP ${status}.`,
      cors: true,
    };
  }
}
