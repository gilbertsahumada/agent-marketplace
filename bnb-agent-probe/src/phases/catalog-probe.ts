import { isSyntacticallyPublicHttpsUrl } from "../trust8004/safe-url";

export type CatalogProbeProtocol = "a2a" | "mcp" | "erc8183_http";
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
  /** Whether this attempt is allowed to update the shared endpoint projection. */
  readonly isRepresentative?: boolean;
  readonly leaseOwner?: string;
  readonly queueDelayMs?: number;
  readonly leaseWaitMs?: number;
}

export interface CatalogProbeObservation {
  readonly attemptId?: string;
  readonly outcome: CatalogProbeOutcome;
  readonly observedAt: number;
  readonly expiresAt: number | null;
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly durationMs: number;
  readonly capabilityCount: number;
  readonly method: "GET" | "POST";
  readonly stageDurationsMs?: Readonly<Record<string, number>>;
  readonly commerceCapability?: "erc8183_a2a" | null;
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
  onAttempt?: (attempt: {
    attemptId: string;
    agentKey: string;
    endpointKey: string;
    protocol: CatalogProbeProtocol;
    priority: number;
    source: "worker_probe";
    outcome: CatalogProbeOutcome;
    errorCode: string | null;
    durationMs: number;
    stageDurationsMs: Readonly<Record<string, number>>;
    queueDelayMs: number;
    leaseWaitMs: number;
    retryDecision: "refresh_scheduled" | "backoff_scheduled";
  }) => void;
}

const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const MINUTE = 60_000;
const EVIDENCE_TTL_BY_PROTOCOL = {
  a2a: 12 * 60 * MINUTE,
  mcp: 24 * 60 * MINUTE,
  erc8183_http: 6 * 60 * MINUTE,
} as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

async function boundedJson(response: Response, maxResponseBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error("INVALID_RESPONSE");
  }
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxResponseBytes) {
    await response.body?.cancel();
    throw new Error("INVALID_RESPONSE");
  }
  if (response.body === null) throw new Error("INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maxResponseBytes) {
      await reader.cancel();
      throw new Error("INVALID_RESPONSE");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder().decode(bytes);
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

function canonicalPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed.length === 0 ? "/" : trimmed;
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
  clock: () => number,
  maxResponseBytes: number,
): Promise<{ status: number; capabilityCount: number; stageDurationsMs: Record<string, number>; commerceCapability: null }> {
  const stageDurationsMs: Record<string, number> = {};
  let stageStarted = clock();
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
  stageDurationsMs.initialize = Math.max(0, Math.round(clock() - stageStarted));
  if (!initialize.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: initialize.status });
  const initialized = record(await boundedJson(initialize, maxResponseBytes));
  if (initialized.jsonrpc !== "2.0" || typeof record(initialized.result).protocolVersion !== "string") {
    throw new Error("INVALID_RESPONSE");
  }
  const sessionId = initialize.headers.get("mcp-session-id") ?? undefined;
  stageStarted = clock();
  const notification = await fetchImpl(target.endpoint, {
    method: "POST",
    redirect: "error",
    headers: mcpHeaders(sessionId),
    signal,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  stageDurationsMs.initialized = Math.max(0, Math.round(clock() - stageStarted));
  if (!notification.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: notification.status });
  stageStarted = clock();
  const tools = await fetchImpl(target.endpoint, {
    method: "POST",
    redirect: "error",
    headers: mcpHeaders(sessionId),
    signal,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  stageDurationsMs.toolsList = Math.max(0, Math.round(clock() - stageStarted));
  if (!tools.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: tools.status });
  const values = record(record(await boundedJson(tools, maxResponseBytes)).result).tools;
  if (!Array.isArray(values) || !values.every((tool) => typeof record(tool).name === "string")) {
    throw new Error("INVALID_RESPONSE");
  }
  return { status: tools.status, capabilityCount: values.length, stageDurationsMs, commerceCapability: null };
}

async function getProbe(
  target: CatalogProbeTarget,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  clock: () => number,
  maxResponseBytes: number,
): Promise<{ status: number; capabilityCount: number; stageDurationsMs: Record<string, number>; commerceCapability: "erc8183_a2a" | null }> {
  const destination = target.protocol === "a2a"
    ? routeUrl(target.endpoint, ".well-known/agent-card.json")
    : target.protocol === "erc8183_http"
      ? routeUrl(target.endpoint, "health")
      : target.endpoint;
  const requestStarted = clock();
  const response = await fetchImpl(destination, {
    method: "GET",
    redirect: "error",
    headers: { accept: "application/json" },
    signal,
  });
  const requestDuration = Math.max(0, Math.round(clock() - requestStarted));
  if (!response.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: response.status });
  const value = record(await boundedJson(response, maxResponseBytes));
  if (target.protocol === "a2a") {
    if (typeof value.name !== "string" || typeof value.url !== "string" || !Array.isArray(value.skills)
      || !isSyntacticallyPublicHttpsUrl(value.url)) throw new Error("INVALID_RESPONSE");
    const declaredUrl = new URL(target.endpoint);
    const cardUrl = new URL(value.url);
    if (cardUrl.origin !== declaredUrl.origin
      || canonicalPath(cardUrl.pathname) !== canonicalPath(declaredUrl.pathname)) {
      throw new Error("INVALID_RESPONSE");
    }
    const skillIds = value.skills.map((skill) => record(skill).id);
    if (skillIds.some((id) => typeof id !== "string")) throw new Error("INVALID_RESPONSE");
    const commerceCapability = skillIds.some((id) => id === "negotiate" || id === "negotiate-erc8183-job")
      && skillIds.includes("notify_funded") ? "erc8183_a2a" : null;
    return { status: response.status, capabilityCount: value.skills.length,
      stageDurationsMs: { agentCard: requestDuration }, commerceCapability };
  }
  if (target.protocol === "erc8183_http" && value.status !== "ok") throw new Error("INVALID_RESPONSE");
  return { status: response.status, capabilityCount: 0, stageDurationsMs: { health: requestDuration }, commerceCapability: null };
}

export async function probeCatalogEndpoint(
  target: CatalogProbeTarget,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs: number;
    maxResponseBytes?: number;
    freshnessMs?: number;
    now?: () => number;
    clock?: () => number;
  },
): Promise<CatalogProbeObservation> {
  const now = options.now ?? Date.now;
  const clock = options.clock ?? (() => performance.now());
  const observedAt = now();
  const startedAt = clock();
  const method = target.protocol === "mcp" ? "POST" : "GET";
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!isSyntacticallyPublicHttpsUrl(target.endpoint)) {
    return { outcome: "unsafe_url", observedAt, expiresAt: null, httpStatus: null,
      errorCode: "CATALOG_UNSAFE_URL", durationMs: 0, capabilityCount: 0, method,
      stageDurationsMs: { preflight: 0 } };
  }
  try {
    const signal = AbortSignal.timeout(options.timeoutMs);
    const result = target.protocol === "mcp"
      ? await mcpProbe(target, options.fetchImpl ?? fetch, signal, clock, maxResponseBytes)
      : await getProbe(target, options.fetchImpl ?? fetch, signal, clock, maxResponseBytes);
    return {
      outcome: "protocol_valid",
      observedAt,
      expiresAt: observedAt + (options.freshnessMs ?? (target.priority >= 100
        ? 15 * MINUTE
        : EVIDENCE_TTL_BY_PROTOCOL[target.protocol])),
      httpStatus: result.status,
      errorCode: null,
      durationMs: Math.max(0, Math.round(clock() - startedAt)),
      capabilityCount: result.capabilityCount,
      method,
      stageDurationsMs: result.stageDurationsMs,
      commerceCapability: result.commerceCapability,
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
      durationMs: Math.max(0, Math.round(clock() - startedAt)),
      capabilityCount: 0,
      method,
      stageDurationsMs: { failed: Math.max(0, Math.round(clock() - startedAt)) },
    };
  }
}

export async function runCatalogProbePhase(
  input: { limit: number; nowMs: number; timeoutMs: number; concurrency?: number },
  dependencies: CatalogProbeDependencies,
): Promise<CatalogProbePhaseSummary> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("CATALOG_PROBE_LIMIT");
  const concurrency = input.concurrency ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > input.limit) {
    throw new Error("CATALOG_PROBE_CONCURRENCY");
  }
  const targets = await dependencies.selectTargets({ limit: input.limit, nowMs: input.nowMs });
  const outcomes: Partial<Record<CatalogProbeOutcome, number>> = {};
  for (let offset = 0; offset < targets.length; offset += concurrency) {
    const batch = targets.slice(offset, offset + concurrency);
    const observations = await Promise.all(batch.map(async (target) => {
      const observation = await dependencies.probe(target);
      return { target, observation: { ...observation, attemptId: observation.attemptId ?? crypto.randomUUID() } };
    }));
    for (const { target, observation } of observations) {
      await dependencies.commit(target, observation);
      dependencies.onAttempt?.({
        attemptId: observation.attemptId,
        agentKey: target.agentKey,
        endpointKey: target.endpointKey,
        protocol: target.protocol,
        priority: target.priority,
        source: "worker_probe",
        outcome: observation.outcome,
        errorCode: observation.errorCode,
        durationMs: observation.durationMs,
        stageDurationsMs: observation.stageDurationsMs ?? {},
        queueDelayMs: target.queueDelayMs ?? 0,
        leaseWaitMs: target.leaseWaitMs ?? 0,
        retryDecision: observation.outcome === "protocol_valid" ? "refresh_scheduled" : "backoff_scheduled",
      });
      outcomes[observation.outcome] = (outcomes[observation.outcome] ?? 0) + 1;
    }
  }
  return { phase: "catalog_probe", status: "ok", processedTargets: targets.length, outcomes };
}
