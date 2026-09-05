export type OperationalStatus =
  | "pending"
  | "browser_observed"
  | "platform_reachable"
  | "platform_failed"
  | "invalid_declaration"
  | "unsafe"
  | "unsupported";

export type Freshness = "never" | "live" | "historical" | "stale";
export type CommerceStatus = "none" | "declared" | "admission_pending" | "admitted" | "suspended";
export type QuoteStatus = "not_supported" | "not_requested" | "verified_fresh" | "verified_historical" | "rejected";
export type BuyerAction = "unavailable" | "check_availability" | "request_quote" | "prepare_hire";
export type SellerCapabilityState = "unsupported" | "discovered" | "ready" | "stale" | "failed" | "suspended";

interface EndpointFact {
  endpointKey: string;
  role: string;
  eligibility: string;
  validationProtocol: string | null;
}

interface ObservationFact {
  id: number;
  endpointKey: string | null;
  source: string;
  outcome: string;
  observedAt: number;
  expiresAt: number | null;
  validationKind?: string;
  verificationLevel?: string;
  details?: unknown;
  detailsJson?: string;
}

interface AdmissionFact {
  state: string;
  endpointKey: string | null;
}

export interface CapabilityFact {
  endpointKey?: string;
  transport?: "a2a" | "mcp" | "erc8183_http";
  state: SellerCapabilityState;
  lastSuccessAt?: number | null;
  capabilityExpiresAt?: number | null;
  lastAttemptAt?: number | null;
  consecutiveFailures?: number;
  lastErrorCode?: string | null;
}

/**
 * Collapse the per-endpoint capability ledger into the best seller-level
 * projection. An agent can publish more than one compatible transport; a
 * failed probe on one endpoint must not hide a still-valid capability on
 * another. Ready (and unexpired) always wins, followed by the most useful
 * non-terminal state in the ledger's stable order.
 */
export function selectBestCapability<T extends CapabilityFact>(
  rows: readonly T[],
  nowMs: number,
): T | null {
  // `ready` is a time-bounded public projection. A row without an expiry is
  // legacy/incomplete evidence and must not be allowed to remain hireable
  // indefinitely; the migration marks those rows as discovered instead.
  const ready = rows.find((row) => row.state === "ready"
    && row.capabilityExpiresAt !== null
    && row.capabilityExpiresAt !== undefined
    && row.capabilityExpiresAt > nowMs);
  if (ready) return ready;
  // A scheduler tick may be delayed (or a catalog page may be served between
  // ticks). Do not leak an expired `ready` projection into the public state in
  // that gap. It is still useful evidence, but it is now stale and must not be
  // counted by the Ready-to-quote facet.
  const normalizedRows = rows.map((row) => row.state === "ready"
    && (row.capabilityExpiresAt === null
      || row.capabilityExpiresAt === undefined
      || row.capabilityExpiresAt <= nowMs)
    ? { ...row, state: row.capabilityExpiresAt === null || row.capabilityExpiresAt === undefined
      ? "discovered" as SellerCapabilityState
      : "stale" as SellerCapabilityState } as T
    : row);
  const rank: Record<SellerCapabilityState, number> = {
    discovered: 4,
    stale: 3,
    failed: 2,
    suspended: 1,
    unsupported: 0,
    ready: 0,
  };
  return [...normalizedRows].sort((left, right) => (rank[right.state] ?? -1) - (rank[left.state] ?? -1))[0] ?? null;
}

export interface CatalogEvidenceState {
  operationalStatus: OperationalStatus;
  freshness: Freshness;
  commerceStatus: CommerceStatus;
  capabilityState: SellerCapabilityState;
  capabilityEndpointKey?: string;
  capabilityTransport?: "a2a" | "mcp" | "erc8183_http";
  capabilityExpiresAt: number | null;
  capabilityLastAttemptAt: number | null;
  capabilityLastErrorCode: string | null;
  quoteStatus: QuoteStatus;
  buyerAction: BuyerAction;
  canRequestBrowserValidation: boolean;
  canRequestInfrastructureValidation: boolean;
  canRequestQuote: boolean;
  canPrepareHire: boolean;
  quoteRequestCount: number;
  quoteSuccessCount: number;
  lastQuoteAttemptAt: number | null;
  jobCount: number;
  completedJobCount: number;
  fundedJobCount: number;
  submittedJobCount: number;
  blockingReasons: string[];
}

const FAILURE_OUTCOMES = new Set([
  "http_error", "timeout", "network_error", "invalid_response", "unsafe_url",
  "unreachable", "error",
]);
const PLATFORM_SOURCES = new Set(["worker_probe", "buyer_refresh", "migration"]);
const PLATFORM_VALIDATION_KINDS = new Set(["reachability", "protocol"]);

function newest(left: ObservationFact | undefined, right: ObservationFact): ObservationFact {
  if (!left || right.observedAt > left.observedAt
    || (right.observedAt === left.observedAt && right.id > left.id)) return right;
  return left;
}

function freshness(observation: ObservationFact | undefined, nowMs: number): Freshness {
  if (!observation) return "never";
  if (observation.expiresAt === null) return "historical";
  return observation.expiresAt > nowMs ? "live" : "stale";
}

function isBuyerQuote(observation: ObservationFact): boolean {
  if (observation.validationKind !== "quote") return false;
  // Capability probes produce a signed, read-only readiness receipt. They are
  // public capacity evidence, never the buyer's active quote for a brief.
  const details = observation.details && typeof observation.details === "object"
    ? observation.details as Record<string, unknown>
    : typeof observation.detailsJson === "string" ? (() => {
      try {
        const parsed: unknown = JSON.parse(observation.detailsJson!);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed as Record<string, unknown> : null;
      } catch { return null; }
    })() : null;
  if (details?.quoteKind === "capability_probe") return false;
  return true;
}

export function deriveCatalogEvidenceState(input: {
  endpoints: readonly EndpointFact[];
  observations: readonly ObservationFact[];
  admission: AdmissionFact | null;
  capability?: CapabilityFact | null;
  quoteStats?: { requestCount: number; successCount: number; lastAttemptAt: number | null };
  jobStats?: { total: number; completed: number; funded: number; submitted: number };
  nowMs: number;
}): CatalogEvidenceState {
  const eligible = input.endpoints.filter((endpoint) => endpoint.role === "operational"
    && endpoint.eligibility === "eligible" && endpoint.validationProtocol !== null);
  const endpointKeys = new Set(eligible.map(({ endpointKey }) => endpointKey));
  const relevant = input.observations.filter((observation) => observation.endpointKey === null
    || endpointKeys.has(observation.endpointKey));
  const platform = relevant.filter((observation) => PLATFORM_SOURCES.has(observation.source)
    && PLATFORM_VALIDATION_KINDS.has(observation.validationKind ?? "")
    && observation.verificationLevel === "platform_observed");
  const browser = relevant.filter((observation) => observation.source === "browser_reported");
  const latestPlatformByEndpoint = new Map<string, ObservationFact>();
  for (const observation of platform) {
    const key = observation.endpointKey ?? "agent";
    latestPlatformByEndpoint.set(key, newest(latestPlatformByEndpoint.get(key), observation));
  }
  const latestPlatform = [...latestPlatformByEndpoint.values()];
  const successful = platform.filter((observation) => observation.outcome === "protocol_valid")
    .reduce<ObservationFact | undefined>(newest, undefined);
  const browserSuccess = browser.some((observation) => observation.outcome === "protocol_valid");
  const reachable = latestPlatform.some((observation) => observation.outcome === "protocol_valid");
  const failed = latestPlatform.length > 0 && latestPlatform.every((observation) => FAILURE_OUTCOMES.has(observation.outcome));

  let operationalStatus: OperationalStatus;
  if (reachable) operationalStatus = "platform_reachable";
  else if (failed) operationalStatus = "platform_failed";
  else if (browserSuccess) operationalStatus = "browser_observed";
  else if (eligible.length > 0) operationalStatus = "pending";
  else if (input.endpoints.some(({ eligibility }) => eligibility === "invalid_declaration")) operationalStatus = "invalid_declaration";
  else if (input.endpoints.some(({ eligibility }) => eligibility === "unsafe")) operationalStatus = "unsafe";
  else operationalStatus = "unsupported";

  const eligibleCommerce = input.endpoints.filter(({ role, eligibility, validationProtocol }) =>
    role === "operational" && eligibility === "eligible"
    && (validationProtocol === "a2a" || validationProtocol === "mcp" || validationProtocol === "erc8183_http"));
  const hasEligibleCommerceDeclaration = eligibleCommerce.length > 0;
  const hasNonMcpCommerceDeclaration = eligibleCommerce.some(({ validationProtocol }) =>
    validationProtocol === "a2a" || validationProtocol === "erc8183_http");
  const hasMcpCommerceDeclaration = eligibleCommerce.some(({ validationProtocol }) => validationProtocol === "mcp");
  const fallbackCapability: CapabilityFact | null = hasEligibleCommerceDeclaration
    ? { state: "discovered" }
    : null;
  const rawCapability = input.capability ?? fallbackCapability;
  const capability = rawCapability?.state === "ready"
    ? rawCapability.capabilityExpiresAt === null || rawCapability.capabilityExpiresAt === undefined
      ? { ...rawCapability, state: "discovered" as const }
      : rawCapability.capabilityExpiresAt <= input.nowMs
        ? { ...rawCapability, state: "stale" as const }
        : rawCapability
    : rawCapability;
  const capabilityState = capability?.state ?? "unsupported";
  const capabilityExpiresAt = capability?.capabilityExpiresAt ?? null;
  // `catalog_agent_admission` is retained only as a migration/backfill input;
  // the capability projection is the runtime authority from 0023 onward.
  const commerceStatus: CommerceStatus = !hasEligibleCommerceDeclaration ? "none"
    : capabilityState === "suspended" ? "suspended"
      : capabilityState === "ready" ? "admitted" : "declared";
  const commerceEndpointKey = capability?.endpointKey ?? null;
  const quoteEvidence = relevant.filter((observation) => isBuyerQuote(observation)
    && observation.verificationLevel === "cryptographic"
    && (commerceEndpointKey === null || observation.endpointKey === commerceEndpointKey)
    && (observation.outcome === "quote_verified" || observation.outcome === "quote_rejected"))
    .reduce<ObservationFact | undefined>(newest, undefined);
  const quoteStatus: QuoteStatus = commerceStatus === "none" ? "not_supported"
    : quoteEvidence?.outcome === "quote_rejected" ? "rejected"
      : quoteEvidence?.outcome === "quote_verified"
        ? quoteEvidence.expiresAt !== null && quoteEvidence.expiresAt > input.nowMs
          ? "verified_fresh" : "verified_historical"
        : "not_requested";
  const freshOnchain = relevant.some((observation) => observation.validationKind === "chain"
    && observation.verificationLevel === "onchain"
    && (commerceEndpointKey === null || observation.endpointKey === null || observation.endpointKey === commerceEndpointKey)
    && observation.expiresAt !== null && observation.expiresAt > input.nowMs);
  const capabilityIsReady = capabilityState === "ready"
    && capabilityExpiresAt !== null
    && capabilityExpiresAt !== undefined
    && capabilityExpiresAt > input.nowMs;
  const mcpQuoteSupported = hasMcpCommerceDeclaration
    && capability?.transport === "mcp"
    && capabilityIsReady;
  const mcpQuoteUnsupported = capability?.transport === "mcp"
    && capabilityState === "failed"
    && ["MCP_TOOLS_INVALID", "MCP_QUOTE_TOOL_REQUIRED", "MCP_QUOTE_SCHEMA_INVALID"].includes(capability.lastErrorCode ?? "");
  // A2A and ERC-8183 HTTP declarations are immediately actionable: a buyer
  // may ask for a quote before the first marketplace probe. MCP is different:
  // a generic MCP endpoint is not enough until its exact negotiation tool has
  // been proven by a capability probe.
  const canRequestQuote = (hasNonMcpCommerceDeclaration || mcpQuoteSupported)
    && capabilityState !== "unsupported"
    && capabilityState !== "suspended"
    && !mcpQuoteUnsupported;
  const canPrepareHire = canRequestQuote && quoteStatus === "verified_fresh" && freshOnchain;
  const canRequestBrowserValidation = eligible.length > 0;
  const canRequestInfrastructureValidation = eligible.length > 0;
  const buyerAction: BuyerAction = canPrepareHire ? "prepare_hire"
    : canRequestQuote ? "request_quote"
      : canRequestInfrastructureValidation ? "check_availability" : "unavailable";
  const blockingReasons: string[] = [];
  if (eligible.length === 0) blockingReasons.push("NO_ELIGIBLE_OPERATIONAL_ENDPOINT");
  if (!canRequestQuote) blockingReasons.push(
    hasMcpCommerceDeclaration && !hasNonMcpCommerceDeclaration
      ? "MCP_QUOTE_TOOL_REQUIRED" : "NO_QUOTE_TRANSPORT",
  );
  if (canRequestQuote && quoteStatus !== "verified_fresh") blockingReasons.push("FRESH_QUOTE_REQUIRED");
  if (quoteStatus === "verified_fresh" && !freshOnchain) blockingReasons.push("CURRENT_CHAIN_CHECK_REQUIRED");

  return {
    operationalStatus,
    freshness: freshness(successful, input.nowMs),
    commerceStatus,
    capabilityState,
    ...(capability?.endpointKey ? { capabilityEndpointKey: capability.endpointKey } : {}),
    ...(capability?.transport ? { capabilityTransport: capability.transport } : {}),
    capabilityExpiresAt,
    capabilityLastAttemptAt: capability?.lastAttemptAt ?? null,
    capabilityLastErrorCode: capability?.lastErrorCode ?? null,
    quoteStatus,
    buyerAction,
    canRequestBrowserValidation,
    canRequestInfrastructureValidation,
    canRequestQuote,
    canPrepareHire,
    quoteRequestCount: input.quoteStats?.requestCount ?? 0,
    quoteSuccessCount: input.quoteStats?.successCount ?? 0,
    lastQuoteAttemptAt: input.quoteStats?.lastAttemptAt ?? null,
    jobCount: input.jobStats?.total ?? 0,
    completedJobCount: input.jobStats?.completed ?? 0,
    fundedJobCount: input.jobStats?.funded ?? 0,
    submittedJobCount: input.jobStats?.submitted ?? 0,
    blockingReasons,
  };
}
