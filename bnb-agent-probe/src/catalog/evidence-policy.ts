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
}

interface AdmissionFact {
  state: string;
  endpointKey: string | null;
}

export interface CatalogEvidenceState {
  operationalStatus: OperationalStatus;
  freshness: Freshness;
  commerceStatus: CommerceStatus;
  quoteStatus: QuoteStatus;
  buyerAction: BuyerAction;
  canRequestBrowserValidation: boolean;
  canRequestInfrastructureValidation: boolean;
  canRequestQuote: boolean;
  canPrepareHire: boolean;
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

export function deriveCatalogEvidenceState(input: {
  endpoints: readonly EndpointFact[];
  observations: readonly ObservationFact[];
  admission: AdmissionFact | null;
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

  const commerceStatus: CommerceStatus = input.admission?.state === "admitted" ? "admitted"
    : input.admission?.state === "suspended" ? "suspended"
      : input.admission?.state === "candidate" ? "admission_pending"
        : input.endpoints.some(({ validationProtocol }) => validationProtocol === "erc8183_http") ? "declared" : "none";
  const commerceEndpointKey = input.admission?.endpointKey ?? null;
  const quoteEvidence = relevant.filter((observation) => observation.validationKind === "quote"
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
  const canRequestQuote = (commerceStatus === "admitted" || commerceStatus === "admission_pending")
    && input.admission?.endpointKey !== null;
  const canPrepareHire = canRequestQuote && quoteStatus === "verified_fresh" && freshOnchain;
  const canRequestBrowserValidation = eligible.length > 0;
  const canRequestInfrastructureValidation = eligible.length > 0;
  const buyerAction: BuyerAction = canPrepareHire ? "prepare_hire"
    : canRequestQuote ? "request_quote"
      : canRequestInfrastructureValidation ? "check_availability" : "unavailable";
  const blockingReasons: string[] = [];
  if (eligible.length === 0) blockingReasons.push("NO_ELIGIBLE_OPERATIONAL_ENDPOINT");
  if (commerceStatus !== "admitted") blockingReasons.push("COMMERCE_NOT_ADMITTED");
  if (commerceStatus === "admitted" && quoteStatus !== "verified_fresh") blockingReasons.push("FRESH_QUOTE_REQUIRED");
  if (quoteStatus === "verified_fresh" && !freshOnchain) blockingReasons.push("CURRENT_CHAIN_CHECK_REQUIRED");

  return {
    operationalStatus,
    freshness: freshness(successful, input.nowMs),
    commerceStatus,
    quoteStatus,
    buyerAction,
    canRequestBrowserValidation,
    canRequestInfrastructureValidation,
    canRequestQuote,
    canPrepareHire,
    blockingReasons,
  };
}
