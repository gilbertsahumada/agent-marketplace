import { isSyntacticallyPublicHttpsUrl } from "../trust8004/safe-url";

export type CatalogProbeProtocol = "a2a" | "mcp" | "web" | "erc8183_http";
export type CatalogProbeOutcome =
  | "protocol_valid"
  | "http_error"
  | "timeout"
  | "network_error"
  | "invalid_response"
  | "unsafe_url"
  | "error";

export interface CatalogProbeTarget {
  readonly agentKey: string;
  readonly endpointKey: string;
  readonly protocol: CatalogProbeProtocol;
  readonly endpoint: string;
  readonly priority: number;
  readonly consecutiveFailures: number;
}

export interface CatalogProbeObservation {
  readonly outcome: CatalogProbeOutcome;
  readonly observedAt: number;
  readonly expiresAt: number | null;
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly durationMs: number;
  readonly capabilityCount: number;
  readonly method: "GET" | "POST";
}

export interface CatalogProbePhaseSummary {
  readonly phase: "catalog_probe";
  readonly status: "ok";
  readonly processedTargets: number;
  readonly outcomes: Partial<Record<CatalogProbeOutcome, number>>;
}

interface CatalogProbeDependencies {
  selectTargets(input: { limit: number; nowMs: number }): Promise<CatalogProbeTarget[]>;
  probe(target: CatalogProbeTarget): Promise<CatalogProbeObservation>;
  commit(target: CatalogProbeTarget, observation: CatalogProbeObservation): Promise<void>;
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const EVIDENCE_TTL_MS = 15 * 60_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("INVALID_RESPONSE");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new Error("INVALID_RESPONSE");
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = body.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
    if (!data) throw new Error("INVALID_RESPONSE");
    return JSON.parse(data) as unknown;
  }
  return JSON.parse(body) as unknown;
}

function routeUrl(endpoint: string, route: string): string {
  const url = new URL(endpoint);
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith(`/${route}`)) url.pathname = `${path}/${route}`.replace(/\/{2,}/g, "/");
  return url.toString();
}

function mcpHeaders(sessionId?: string): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
  };
}

async function mcpProbe(
  target: CatalogProbeTarget,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<{ status: number; capabilityCount: number }> {
  const initialize = await fetchImpl(target.endpoint, {
    method: "POST",
    redirect: "error",
    headers: mcpHeaders(),
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "bnb-agent-probe", version: "1.0.0" },
      },
    }),
  });
  if (!initialize.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: initialize.status });
  const initialized = record(await boundedJson(initialize));
  if (initialized.jsonrpc !== "2.0" || typeof record(initialized.result).protocolVersion !== "string") {
    throw new Error("INVALID_RESPONSE");
  }
  const sessionId = initialize.headers.get("mcp-session-id") ?? undefined;
  const notification = await fetchImpl(target.endpoint, {
    method: "POST",
    redirect: "error",
    headers: mcpHeaders(sessionId),
    signal,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  if (!notification.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: notification.status });
  const tools = await fetchImpl(target.endpoint, {
    method: "POST",
    redirect: "error",
    headers: mcpHeaders(sessionId),
    signal,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  if (!tools.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: tools.status });
  const values = record(record(await boundedJson(tools)).result).tools;
  if (!Array.isArray(values) || !values.every((tool) => typeof record(tool).name === "string")) {
    throw new Error("INVALID_RESPONSE");
  }
  return { status: tools.status, capabilityCount: values.length };
}

async function getProbe(
  target: CatalogProbeTarget,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<{ status: number; capabilityCount: number }> {
  const destination = target.protocol === "a2a"
    ? routeUrl(target.endpoint, ".well-known/agent-card.json")
    : target.protocol === "erc8183_http"
      ? routeUrl(target.endpoint, "status")
      : target.endpoint;
  const response = await fetchImpl(destination, {
    method: "GET",
    redirect: "error",
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: response.status });
  const value = record(await boundedJson(response));
  if (target.protocol === "a2a") {
    if (typeof value.name !== "string" || typeof value.url !== "string" || !Array.isArray(value.skills)
      || new URL(value.url).origin !== new URL(target.endpoint).origin) throw new Error("INVALID_RESPONSE");
    return { status: response.status, capabilityCount: value.skills.length };
  }
  if (target.protocol === "erc8183_http" && value.status !== "ok") throw new Error("INVALID_RESPONSE");
  return { status: response.status, capabilityCount: 0 };
}

export async function probeCatalogEndpoint(
  target: CatalogProbeTarget,
  options: { fetchImpl?: typeof fetch; timeoutMs: number; now?: () => number },
): Promise<CatalogProbeObservation> {
  const now = options.now ?? Date.now;
  const observedAt = now();
  const method = target.protocol === "mcp" ? "POST" : "GET";
  if (!isSyntacticallyPublicHttpsUrl(target.endpoint)) {
    return { outcome: "unsafe_url", observedAt, expiresAt: null, httpStatus: null,
      errorCode: "CATALOG_UNSAFE_URL", durationMs: 0, capabilityCount: 0, method };
  }
  try {
    const signal = AbortSignal.timeout(options.timeoutMs);
    const result = target.protocol === "mcp"
      ? await mcpProbe(target, options.fetchImpl ?? fetch, signal)
      : await getProbe(target, options.fetchImpl ?? fetch, signal);
    return {
      outcome: "protocol_valid",
      observedAt,
      expiresAt: observedAt + EVIDENCE_TTL_MS,
      httpStatus: result.status,
      errorCode: null,
      durationMs: Math.max(0, now() - observedAt),
      capabilityCount: result.capabilityCount,
      method,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status : null;
    const outcome: CatalogProbeOutcome = name === "AbortError" || name === "TimeoutError"
      ? "timeout"
      : error instanceof TypeError
        ? "network_error"
        : status === null ? "invalid_response" : "http_error";
    return {
      outcome,
      observedAt,
      expiresAt: null,
      httpStatus: status,
      errorCode: outcome === "timeout" ? "CATALOG_TIMEOUT"
        : outcome === "network_error" ? "CATALOG_NETWORK_ERROR"
          : outcome === "http_error" ? `CATALOG_HTTP_${status}` : "CATALOG_INVALID_RESPONSE",
      durationMs: Math.max(0, now() - observedAt),
      capabilityCount: 0,
      method,
    };
  }
}

export async function runCatalogProbePhase(
  input: { limit: number; nowMs: number; timeoutMs: number },
  dependencies: CatalogProbeDependencies,
): Promise<CatalogProbePhaseSummary> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("CATALOG_PROBE_LIMIT");
  const targets = await dependencies.selectTargets({ limit: input.limit, nowMs: input.nowMs });
  const outcomes: Partial<Record<CatalogProbeOutcome, number>> = {};
  for (const target of targets) {
    const observation = await dependencies.probe(target);
    await dependencies.commit(target, observation);
    outcomes[observation.outcome] = (outcomes[observation.outcome] ?? 0) + 1;
  }
  return { phase: "catalog_probe", status: "ok", processedTargets: targets.length, outcomes };
}
