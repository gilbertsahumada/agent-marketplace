import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { BscIdentityReader } from "../verification/onchain.ts";
import { isPublicIpAddress } from "../verification/safe-http.ts";

export const FUNNEL_SCHEMA_VERSION = 1 as const;
export const FUNNEL_PAGE_SIZE = 2_000;
export const FUNNEL_MAX_REQUESTS_PER_MINUTE = 55;
export const FUNNEL_MINIMUM_REQUEST_INTERVAL_MS = 1_100;
export const FUNNEL_MAX_RESPONSE_BYTES = 16 * 1_024 * 1_024;
export const FUNNEL_CANDIDATE_BUDGET = 5_000;

type JsonRecord = Record<string, unknown>;
export type ProtocolBucket =
  | "a2aOnly"
  | "erc8183Only"
  | "both"
  | "mcpOnly"
  | "otherOrNone"
  | "protocolUnknown";

export interface FunnelAgentInput {
  chainId: number | string;
  agentId: number | string;
  registeredAt?: unknown;
  blockNumber?: unknown;
  metadataStatus?: unknown;
  metadataReason?: unknown;
  metadataReasonCode?: unknown;
  services?: unknown;
  endpoints?: unknown;
  a2aEndpoint?: unknown;
  mcpEndpoint?: unknown;
}

export interface FunnelGate {
  name: string;
  passed: boolean;
  detail: string;
}

export interface FunnelSnapshot {
  schemaVersion: typeof FUNNEL_SCHEMA_VERSION;
  generatedAt: string;
  chainId: 56;
  cutoff: { blockNumber: string; observedAt: string };
  source: {
    baseUrl: string;
    listPath: "/api/app/agents";
    detailPathTemplate: "/api/app/agents/56:AGENT_ID";
    params: Record<string, string>;
    rateLimitHeaders: Record<string, string[]>;
  };
  registeredTotal: number;
  countOnlyTotal: number;
  metadata: { ok: number; httpUnreachable: number; other: number };
  protocols: Record<ProtocolBucket, number>;
  candidates: {
    declaringAgents: number;
    declaredEndpoints: number;
    publicHttpsEndpoints: number;
    topDomains: { hostname: string; count: number }[];
  };
  scan: {
    pages: number;
    requestedPageSize: number;
    observedPageSize: number;
    firstAgentId: string | null;
    lastAgentId: string | null;
    requests: number;
    retries: 0;
    http429Responses: number;
    maximumRequestsPerRollingMinute: number;
    maxPageBytes: number;
    missingRegisteredAt: number;
    duplicateAgentIds: number;
    durationMs: number;
    errors: string[];
  };
  apiValidation: {
    listRoute: boolean;
    detailRoute: boolean;
    rateLimitAdvertised: number | null;
    requestedLimitAccepted: boolean;
    ascendingSampleConfirmed: boolean;
    detailFieldsObserved: boolean;
    onchainWalletSource: "getAgentWallet" | "ownerOf";
    onchainWalletBlockNumber: string;
  };
  wp1Blocked: boolean;
  gates: FunnelGate[];
  sourceSha256: string;
}

export interface RunFunnelSnapshotOptions {
  baseUrl?: string;
  pageSize?: number;
  minimumRequestIntervalMs?: number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  fetch?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  generatedAt?: string;
  onPage?: (progress: {
    pages: number;
    offset: number;
    processed: number;
    expectedTotal: number;
  }) => void | Promise<void>;
  identityReader: BscIdentityReader;
}

interface ParsedAgent {
  agentId: string;
  registeredAt: number | null;
  blockNumber: string | null;
  metadata: "ok" | "httpUnreachable" | "other";
  bucket: ProtocolBucket;
  declaresA2aOrErc8183: boolean;
  candidateEndpoints: string[];
}

interface ParsedPage {
  agents: ParsedAgent[];
  total: number;
  limit: number;
  offset: number;
}

interface JsonResponse {
  value: unknown;
  bytes: number;
}

const RATE_LIMIT_HEADER = /^(?:x-)?ratelimit-(?:limit|remaining|reset)$/i;
const ZERO_ADDRESS = /^0x0{40}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;

function record(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`WP0_SCHEMA:${path}`);
  }
  return value as JsonRecord;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`WP0_SCHEMA:${path}`);
  }
  return value;
}

function optionalTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function positiveInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`WP0_CONFIG:${path}`);
  return value;
}

function numericString(value: unknown, path: string): string {
  const candidate = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;
  if (typeof candidate !== "string" || !/^\d+$/.test(candidate)) {
    throw new Error(`WP0_SCHEMA:${path}`);
  }
  return BigInt(candidate).toString();
}

function jsonArray(value: unknown): unknown[] | null {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizedProtocol(value: unknown): "a2a" | "erc8183" | "mcp" | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "a2a") return "a2a";
  if (normalized === "erc8183") return "erc8183";
  if (normalized === "mcp") return "mcp";
  return null;
}

function metadataState(input: FunnelAgentInput): "ok" | "httpUnreachable" | "other" {
  const raw = input.metadataReasonCode ?? input.metadataReason ?? input.metadataStatus;
  if (typeof raw !== "string") return "other";
  const normalized = raw.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (["ok", "resolved", "success", "available"].includes(normalized)) return "ok";
  if (normalized === "http_unreachable") return "httpUnreachable";
  return "other";
}

function protocolDeclarations(input: FunnelAgentInput): {
  a2a: boolean;
  erc8183: boolean;
  mcp: boolean;
  malformed: boolean;
  candidateEndpoints: string[];
} {
  const services = jsonArray(input.services);
  const endpoints = jsonArray(input.endpoints);
  if (!services || !endpoints) {
    return { a2a: false, erc8183: false, mcp: false, malformed: true, candidateEndpoints: [] };
  }
  let a2a = typeof input.a2aEndpoint === "string" && input.a2aEndpoint.trim().length > 0;
  let mcp = typeof input.mcpEndpoint === "string" && input.mcpEndpoint.trim().length > 0;
  let erc8183 = false;
  let malformed = false;
  const candidates: string[] = [];
  for (const entry of [...services, ...endpoints]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      malformed = true;
      continue;
    }
    const item = entry as JsonRecord;
    const label = item.name ?? item.type ?? item.protocol;
    const hasLabel = "name" in item || "type" in item || "protocol" in item;
    if (hasLabel && typeof label !== "string") malformed = true;
    const protocol = normalizedProtocol(label);
    if (protocol === "a2a") a2a = true;
    if (protocol === "erc8183") erc8183 = true;
    if (protocol === "mcp") mcp = true;
    const endpoint = item.endpoint ?? item.url;
    if ((protocol === "a2a" || protocol === "erc8183") && typeof endpoint === "string") {
      candidates.push(endpoint);
    }
  }
  return {
    a2a,
    erc8183,
    mcp,
    malformed,
    candidateEndpoints: [...new Set(candidates)].slice(0, 2),
  };
}

export function classifyProtocolBucket(input: FunnelAgentInput): ProtocolBucket {
  const declarations = protocolDeclarations(input);
  if (metadataState(input) !== "ok" || declarations.malformed) return "protocolUnknown";
  if (declarations.a2a && declarations.erc8183) return "both";
  if (declarations.erc8183) return "erc8183Only";
  if (declarations.a2a) return "a2aOnly";
  if (declarations.mcp) return "mcpOnly";
  return "otherOrNone";
}

export function isPublicHttpsEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
      return false;
    }
    const address = hostname.replace(/^\[|\]$/g, "");
    if (isIP(address)) return isPublicIpAddress(address);
    return true;
  } catch {
    return false;
  }
}

function publicHostname(endpoint: string): string | null {
  if (!isPublicHttpsEndpoint(endpoint)) return null;
  return new URL(endpoint).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function parseAgent(value: unknown, index: number): ParsedAgent {
  const item = record(value, `items[${index}]`) as FunnelAgentInput & JsonRecord;
  if (Number(item.chainId) !== 56) throw new Error(`WP0_SCHEMA:items[${index}].chainId`);
  const agentId = numericString(item.agentId, `items[${index}].agentId`);
  const registeredAt = optionalTimestamp(item.registeredAt);
  const declarations = protocolDeclarations(item);
  const metadata = declarations.malformed ? "other" : metadataState(item);
  const bucket = metadata === "ok" ? classifyProtocolBucket(item) : "protocolUnknown";
  return {
    agentId,
    registeredAt,
    blockNumber: item.blockNumber === null || item.blockNumber === undefined
      ? null
      : numericString(item.blockNumber, `items[${index}].blockNumber`),
    metadata,
    bucket,
    declaresA2aOrErc8183: metadata === "ok" && (declarations.a2a || declarations.erc8183),
    candidateEndpoints: metadata === "ok" ? declarations.candidateEndpoints : [],
  };
}

function parsePage(value: unknown): ParsedPage {
  const response = record(value, "response");
  const rawItems = response.items;
  if (!Array.isArray(rawItems)) throw new Error("WP0_SCHEMA:response.items");
  return {
    agents: rawItems.map(parseAgent),
    total: nonNegativeInteger(response.total, "response.total"),
    limit: nonNegativeInteger(response.limit, "response.limit"),
    offset: nonNegativeInteger(response.offset, "response.offset"),
  };
}

function isAscending(previous: ParsedAgent | undefined, current: ParsedAgent): boolean {
  if (!previous || previous.registeredAt === null || current.registeredAt === null) return true;
  return current.registeredAt >= previous.registeredAt;
}

function sampleIdsMatch(original: string[], current: string[], allowNewSuffix: boolean): boolean {
  if (!allowNewSuffix) {
    return current.length === original.length
      && original.every((agentId, index) => current[index] === agentId);
  }
  if (current.length < original.length
    || !original.every((agentId, index) => current[index] === agentId)) {
    return false;
  }
  const seen = new Set(original);
  for (const agentId of current.slice(original.length)) {
    if (seen.has(agentId)) return false;
    seen.add(agentId);
  }
  return true;
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, sortedValue(entry)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortedValue(value));
}

export function computeSourceSha256(value: unknown): string {
  const withoutHash = { ...(record(value, "artifact")) };
  delete withoutHash.sourceSha256;
  return createHash("sha256").update(canonicalJson(withoutHash)).digest("hex");
}

function protocolTotal(protocols: FunnelSnapshot["protocols"]): number {
  return Object.values(protocols).reduce((sum, count) => sum + count, 0);
}

function metadataTotal(metadata: FunnelSnapshot["metadata"]): number {
  return metadata.ok + metadata.httpUnreachable + metadata.other;
}

function containsSensitiveEvidence(snapshot: FunnelSnapshot): boolean {
  const serialized = JSON.stringify(snapshot);
  return /authorization|bearer\s|private[_-]?key|BEGIN [A-Z ]+PRIVATE KEY|https:\/\/[^/\s"']+:[^/\s"']+@/i.test(serialized);
}

function evaluateGates(snapshot: FunnelSnapshot, assumeHash = false): FunnelGate[] {
  const drift = snapshot.countOnlyTotal === 0
    ? snapshot.registeredTotal === 0 ? 0 : Number.POSITIVE_INFINITY
    : Math.abs(snapshot.registeredTotal - snapshot.countOnlyTotal) / snapshot.countOnlyTotal;
  return [
    { name: "protocolBucketsSum", passed: protocolTotal(snapshot.protocols) === snapshot.registeredTotal, detail: `${protocolTotal(snapshot.protocols)}/${snapshot.registeredTotal}` },
    { name: "metadataBucketsSum", passed: metadataTotal(snapshot.metadata) === snapshot.registeredTotal, detail: `${metadataTotal(snapshot.metadata)}/${snapshot.registeredTotal}` },
    { name: "countOnlyDriftBelowOnePercent", passed: drift < 0.01, detail: Number.isFinite(drift) ? drift.toFixed(6) : "infinite" },
    { name: "ascendingSampleConfirmed", passed: snapshot.apiValidation.ascendingSampleConfirmed, detail: snapshot.apiValidation.ascendingSampleConfirmed ? "confirmed" : "mismatch" },
    { name: "rateBudget", passed: snapshot.scan.maximumRequestsPerRollingMinute <= FUNNEL_MAX_REQUESTS_PER_MINUTE && snapshot.scan.http429Responses === 0, detail: `${snapshot.scan.maximumRequestsPerRollingMinute}/55; 429=${snapshot.scan.http429Responses}` },
    { name: "apiContractRevalidated", passed: snapshot.apiValidation.listRoute && snapshot.apiValidation.detailRoute && snapshot.apiValidation.rateLimitAdvertised === 60 && snapshot.apiValidation.requestedLimitAccepted && snapshot.apiValidation.detailFieldsObserved, detail: "list, detail, rate=60, limit, fields" },
    { name: "artifactSanitized", passed: snapshot.scan.errors.length === 0 && !containsSensitiveEvidence(snapshot), detail: snapshot.scan.errors.length === 0 ? "sanitized" : "errors-present" },
    { name: "onchainWalletRevalidated", passed: snapshot.apiValidation.onchainWalletSource === "getAgentWallet" || snapshot.apiValidation.onchainWalletSource === "ownerOf", detail: snapshot.apiValidation.onchainWalletSource },
    { name: "wp1SizingWithinBudget", passed: snapshot.candidates.declaringAgents <= FUNNEL_CANDIDATE_BUDGET && snapshot.candidates.declaredEndpoints <= FUNNEL_CANDIDATE_BUDGET, detail: `agents=${snapshot.candidates.declaringAgents}; endpoints=${snapshot.candidates.declaredEndpoints}` },
    { name: "sourceSha256Reproducible", passed: assumeHash || snapshot.sourceSha256 === computeSourceSha256(snapshot), detail: assumeHash || snapshot.sourceSha256 === computeSourceSha256(snapshot) ? "verified" : "mismatch" },
  ];
}

export function validateFunnelSnapshot(snapshot: FunnelSnapshot): FunnelGate[] {
  return evaluateGates(snapshot);
}

function maxRequestsInRollingMinute(starts: number[]): number {
  let maximum = 0;
  let left = 0;
  for (let right = 0; right < starts.length; right += 1) {
    while (starts[right]! - starts[left]! >= 60_000) left += 1;
    maximum = Math.max(maximum, right - left + 1);
  }
  return maximum;
}

function sanitizedBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("WP0_CONFIG:baseUrl");
  }
  return url.origin;
}

async function boundedResponseBytes(response: Response, maxResponseBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxResponseBytes) {
    await response.body?.cancel();
    throw new Error("WP0_RESPONSE_TOO_LARGE");
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxResponseBytes) {
        await reader.cancel();
        throw new Error("WP0_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function runFunnelSnapshot(options: RunFunnelSnapshotOptions): Promise<FunnelSnapshot> {
  const baseUrl = sanitizedBaseUrl(options.baseUrl ?? "https://trust8004.xyz");
  const pageSize = positiveInteger(options.pageSize ?? FUNNEL_PAGE_SIZE, "pageSize");
  const minimumInterval = positiveInteger(
    options.minimumRequestIntervalMs ?? FUNNEL_MINIMUM_REQUEST_INTERVAL_MS,
    "minimumRequestIntervalMs",
  );
  if (minimumInterval < Math.ceil(60_000 / FUNNEL_MAX_REQUESTS_PER_MINUTE)) {
    throw new Error("WP0_CONFIG:minimumRequestIntervalMs exceeds rate budget");
  }
  const requestTimeoutMs = positiveInteger(options.requestTimeoutMs ?? 180_000, "requestTimeoutMs");
  const maxResponseBytes = positiveInteger(options.maxResponseBytes ?? FUNNEL_MAX_RESPONSE_BYTES, "maxResponseBytes");
  const fetchImpl = options.fetch ?? fetch;
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const generatedAt = options.generatedAt ?? new Date(now()).toISOString();
  const startedAt = now();
  const requestStarts: number[] = [];
  const rateHeaders = new Map<string, Set<string>>();
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let http429Responses = 0;

  const requestJson = async (path: string, params?: URLSearchParams): Promise<JsonResponse> => {
    const remaining = minimumInterval - (now() - lastRequestAt);
    if (remaining > 0) await wait(remaining);
    lastRequestAt = now();
    requestStarts.push(lastRequestAt);
    const url = new URL(path, baseUrl);
    if (params) url.search = params.toString();
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    for (const [name, rawValue] of response.headers.entries()) {
      if (!RATE_LIMIT_HEADER.test(name) && name.toLowerCase() !== "retry-after") continue;
      const value = rawValue.slice(0, 128);
      const values = rateHeaders.get(name.toLowerCase()) ?? new Set<string>();
      values.add(value);
      rateHeaders.set(name.toLowerCase(), values);
    }
    if (response.status === 429) http429Responses += 1;
    if (!response.ok) throw new Error(`WP0_HTTP:${response.status}`);
    const bytes = await boundedResponseBytes(response, maxResponseBytes);
    try {
      return { value: JSON.parse(new TextDecoder().decode(bytes)) as unknown, bytes: bytes.byteLength };
    } catch {
      throw new Error("WP0_INVALID_JSON");
    }
  };

  await options.identityReader.assertChain();
  const cutoffBlock = await options.identityReader.getBlockNumber();
  const listParams = new URLSearchParams({
    chainId: "56",
    limit: String(pageSize),
    offset: "0",
    includeReputation: "false",
    includeCategoryCounts: "false",
    includeMetadataReasonCounts: "true",
    includeTotal: "true",
    sortBy: "registered",
    sortOrder: "asc",
  });
  const countParams = new URLSearchParams(listParams);
  countParams.set("limit", "1");
  countParams.set("countOnly", "true");
  const countResponse = parsePage((await requestJson("/api/app/agents", countParams)).value);

  const metadata = { ok: 0, httpUnreachable: 0, other: 0 };
  const protocols: Record<ProtocolBucket, number> = {
    a2aOnly: 0,
    erc8183Only: 0,
    both: 0,
    mcpOnly: 0,
    otherOrNone: 0,
    protocolUnknown: 0,
  };
  const hostCounts = new Map<string, number>();
  const pageOffsets: number[] = [];
  const pageIds = new Map<number, string[]>();
  const seenIds = new Set<string>();
  let firstAgentId: string | null = null;
  let lastAgentId: string | null = null;
  let previous: ParsedAgent | undefined;
  let expectedTotal: number | null = null;
  let processed = 0;
  let observedPageSize = 0;
  let maxPageBytes = 0;
  let declaringAgents = 0;
  let declaredEndpoints = 0;
  let publicHttpsEndpoints = 0;
  let missingRegisteredAt = 0;
  let duplicateAgentIds = 0;

  for (let offset = 0; expectedTotal === null || offset < expectedTotal; offset += pageSize) {
    const params = new URLSearchParams(listParams);
    params.set("offset", String(offset));
    const response = await requestJson("/api/app/agents", params);
    const page = parsePage(response.value);
    if (page.offset !== offset) throw new Error("WP0_PAGE_OFFSET_MISMATCH");
    expectedTotal ??= page.total;
    observedPageSize = Math.max(observedPageSize, page.agents.length);
    maxPageBytes = Math.max(maxPageBytes, response.bytes);
    pageOffsets.push(offset);
    pageIds.set(offset, page.agents.map((entry) => entry.agentId));
    for (const entry of page.agents) {
      if (seenIds.has(entry.agentId)) {
        duplicateAgentIds += 1;
        continue;
      }
      if (!isAscending(previous, entry)) throw new Error("WP0_ORDER_NOT_ASCENDING");
      seenIds.add(entry.agentId);
      previous = entry;
      firstAgentId ??= entry.agentId;
      lastAgentId = entry.agentId;
      processed += 1;
      if (entry.registeredAt === null) missingRegisteredAt += 1;
      metadata[entry.metadata] += 1;
      protocols[entry.bucket] += 1;
      if (entry.declaresA2aOrErc8183) declaringAgents += 1;
      declaredEndpoints += entry.candidateEndpoints.length;
      for (const endpoint of entry.candidateEndpoints) {
        const hostname = publicHostname(endpoint);
        if (!hostname) continue;
        publicHttpsEndpoints += 1;
        hostCounts.set(hostname, (hostCounts.get(hostname) ?? 0) + 1);
      }
    }
    await options.onPage?.({
      pages: pageOffsets.length,
      offset,
      processed,
      expectedTotal,
    });
    if (page.agents.length === 0) break;
  }

  if (firstAgentId === null) throw new Error("WP0_EMPTY_CATALOG");
  const sampleIndexes = [0, Math.floor((pageOffsets.length - 1) / 2), pageOffsets.length - 1];
  let ascendingSampleConfirmed = true;
  for (const index of sampleIndexes) {
    const offset = pageOffsets[index]!;
    const params = new URLSearchParams(listParams);
    params.set("offset", String(offset));
    const sample = parsePage((await requestJson("/api/app/agents", params)).value);
    const originalIds = pageIds.get(offset)!;
    const currentIds = sample.agents.map((entry) => entry.agentId);
    const allowNewSuffix = index === pageOffsets.length - 1
      && offset + pageSize > expectedTotal;
    if (!sampleIdsMatch(originalIds, currentIds, allowNewSuffix)) {
      ascendingSampleConfirmed = false;
    }
  }

  const detailResponse = await requestJson(`/api/app/agents/56:${encodeURIComponent(firstAgentId)}`);
  const detail = record(detailResponse.value, "detail");
  const detailFieldsObserved = ["services", "endpoints", "registeredAt", "blockNumber"]
    .every((field) => field in detail)
    && ("metadataReasonCode" in detail || "metadataStatus" in detail || "metadataReason" in detail);
  const onchainWalletBlock = await options.identityReader.getBlockNumber();
  const identity = await options.identityReader.readIdentity(firstAgentId, onchainWalletBlock);
  const onchainWalletSource = typeof identity.agentWallet === "string"
    && ADDRESS.test(identity.agentWallet)
    && !ZERO_ADDRESS.test(identity.agentWallet)
    ? "getAgentWallet"
    : "ownerOf";
  const advertised = [...(rateHeaders.get("x-ratelimit-limit") ?? rateHeaders.get("ratelimit-limit") ?? [])]
    .map(Number)
    .find((value) => Number.isSafeInteger(value) && value > 0) ?? null;
  const topDomains = [...hostCounts.entries()]
    .map(([hostname, count]) => ({ hostname, count }))
    .sort((left, right) => right.count - left.count || left.hostname.localeCompare(right.hostname))
    .slice(0, 10);
  const snapshot: FunnelSnapshot = {
    schemaVersion: FUNNEL_SCHEMA_VERSION,
    generatedAt,
    chainId: 56,
    cutoff: { blockNumber: cutoffBlock.toString(), observedAt: generatedAt },
    source: {
      baseUrl,
      listPath: "/api/app/agents",
      detailPathTemplate: "/api/app/agents/56:AGENT_ID",
      params: Object.fromEntries([...listParams.entries()].filter(([name]) => name !== "offset")),
      rateLimitHeaders: Object.fromEntries([...rateHeaders.entries()].map(([name, values]) => [name, [...values].sort()])),
    },
    registeredTotal: processed,
    countOnlyTotal: countResponse.total,
    metadata,
    protocols,
    candidates: { declaringAgents, declaredEndpoints, publicHttpsEndpoints, topDomains },
    scan: {
      pages: pageOffsets.length,
      requestedPageSize: pageSize,
      observedPageSize,
      firstAgentId,
      lastAgentId,
      requests: requestStarts.length,
      retries: 0,
      http429Responses,
      maximumRequestsPerRollingMinute: maxRequestsInRollingMinute(requestStarts),
      maxPageBytes,
      missingRegisteredAt,
      duplicateAgentIds,
      durationMs: Math.max(0, now() - startedAt),
      errors: [],
    },
    apiValidation: {
      listRoute: true,
      detailRoute: true,
      rateLimitAdvertised: advertised,
      requestedLimitAccepted: pageSize === FUNNEL_PAGE_SIZE
        ? observedPageSize === FUNNEL_PAGE_SIZE
        : observedPageSize === pageSize,
      ascendingSampleConfirmed,
      detailFieldsObserved,
      onchainWalletSource,
      onchainWalletBlockNumber: onchainWalletBlock.toString(),
    },
    wp1Blocked: declaringAgents > FUNNEL_CANDIDATE_BUDGET || declaredEndpoints > FUNNEL_CANDIDATE_BUDGET,
    gates: [],
    sourceSha256: "",
  };
  snapshot.gates = evaluateGates(snapshot, true);
  snapshot.sourceSha256 = computeSourceSha256(snapshot);
  return snapshot;
}
