import {
  isCatalogOperationalDeclaration,
  isCatalogOperationalObservation,
  type CatalogCandidate,
} from "@/src/business/entities/catalog-candidate";
import type { AgentCardViewModel, EvidenceStepViewModel } from "./presentation-types";
import type { AgentProtocolLabel } from "./presentation-types";

const PLATFORM_SOURCES = new Set(["marketplace_probe", "worker_probe", "buyer_refresh", "migration"]);
const FAILURE_OUTCOMES = new Set([
  "http_error", "timeout", "network_error", "invalid_response", "unsafe_url", "quote_rejected", "unreachable", "error",
]);

function isBuyerQuoteObservation(observation: CatalogCandidate["observations"][number]): boolean {
  if (observation.validationKind !== "quote") return true;
  return !isCapabilityProbeObservation(observation);
}

function observationDetails(observation: CatalogCandidate["observations"][number]): Record<string, unknown> | null {
  if (observation.details && typeof observation.details === "object" && !Array.isArray(observation.details)) {
    return observation.details as Record<string, unknown>;
  }
  const serialized = (observation as CatalogCandidate["observations"][number] & { detailsJson?: unknown }).detailsJson;
  if (typeof serialized !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isCapabilityProbeObservation(observation: CatalogCandidate["observations"][number]): boolean {
  return observation.validationKind === "quote"
    && observationDetails(observation)?.quoteKind === "capability_probe";
}

const BLOCKING_REASON_COPY: Record<string, string> = {
  NO_ELIGIBLE_OPERATIONAL_ENDPOINT: "No supported operational endpoint is available for marketplace hiring.",
  NO_QUOTE_TRANSPORT: "No compatible negotiation transport is available for requesting a quote.",
  MCP_QUOTE_TOOL_REQUIRED: "This MCP endpoint is reachable, but it does not expose the required quote tool yet.",
  FRESH_QUOTE_REQUIRED: "A fresh seller quote is required before preparing the transaction.",
  CURRENT_CHAIN_CHECK_REQUIRED: "Current onchain checks are required before preparing the transaction.",
  CATALOG_STATE_UNAVAILABLE: "Current marketplace capability data is unavailable for this agent.",
};

export function catalogBlockingMessage(reasons: string[] | undefined): string {
  if (!reasons?.length) return "Marketplace hiring is not currently available for this agent.";
  const messages = reasons.map((reason) => BLOCKING_REASON_COPY[reason]
    ?? "The marketplace returned an unsupported hiring blocker and failed closed.");
  return [...new Set(messages)].join(" ");
}

function isPlatformReachabilityObservation(
  candidate: CatalogCandidate,
  observation: CatalogCandidate["observations"][number],
): boolean {
  if (!PLATFORM_SOURCES.has(observation.source)
    || !isCatalogOperationalObservation(candidate, observation)) return false;
  if (observation.validationKind === "reachability" || observation.validationKind === "protocol") {
    return observation.verificationLevel === "platform_observed";
  }
  // v1 compatibility rows predate the normalized validation fields. Keep the
  // known platform sources readable, but never treat chain/quote rows as a
  // reachability observation merely because their outcome is protocol_valid.
  if (observation.validationKind !== undefined || observation.verificationLevel !== undefined) return false;
  if (observation.source === "marketplace_probe") {
    return observation.outcome === "protocol_valid"
      || observation.outcome === "quote_verified"
      || observation.outcome === "quote_rejected";
  }
  return (observation.source === "worker_probe"
    || observation.source === "buyer_refresh"
    || observation.source === "migration")
    && (observation.outcome === "protocol_valid" || FAILURE_OUTCOMES.has(observation.outcome));
}

function time(value: number): string { return new Date(value).toISOString(); }

function declaredProtocols(candidate: CatalogCandidate): AgentProtocolLabel[] {
  const labels = candidate.declarations.flatMap((declaration): AgentProtocolLabel[] => {
    const protocol = declaration.declaredProtocol ?? declaration.validationProtocol ?? declaration.protocol;
    if (protocol === "a2a") return ["A2A"];
    if (protocol === "mcp") return ["MCP"];
    if (protocol === "erc8183_http") return ["ERC-8183 HTTP"];
    if (protocol === "web") return ["Web"];
    if (protocol === "x402") return ["x402"];
    return [];
  });
  return [...new Set(labels)];
}

export function catalogCandidateCard(
  candidate: CatalogCandidate,
  now = Date.now(),
): AgentCardViewModel {
  const selectedEndpoint = candidate.state?.canRequestQuote ? candidate.state.capabilityEndpointKey : null;
  const platform = candidate.observations
    .filter((observation) => isPlatformReachabilityObservation(candidate, observation)
      && (!selectedEndpoint || observation.endpointKey === selectedEndpoint))
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);
  const browser = candidate.observations
    .filter((observation) => observation.source === "browser_reported")
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);
  const capableEndpointKey = candidate.state?.capabilityState === undefined
    ? candidate.admission?.endpointKey ?? null
    : candidate.state.capabilityEndpointKey ?? null;
  const capabilityObservation = candidate.observations
    .filter((observation) => isCapabilityProbeObservation(observation)
      && observation.outcome === "quote_verified"
      && isCatalogOperationalObservation(candidate, observation)
      && (capableEndpointKey === null || observation.endpointKey === capableEndpointKey))
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id)[0];
  const quote = candidate.observations
    .filter((observation) => isBuyerQuoteObservation(observation) && (observation.validationKind === "quote"
      && observation.verificationLevel === "cryptographic"
      && isCatalogOperationalObservation(candidate, observation)
      && (capableEndpointKey === null || observation.endpointKey === capableEndpointKey))
      || (observation.validationKind === undefined
        && PLATFORM_SOURCES.has(observation.source)
        && isCatalogOperationalObservation(candidate, observation)
        && (observation.outcome === "quote_verified"
          || observation.outcome === "quote_rejected"
          || observation.protocol === "erc8183")))
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id)[0];
  const transport = platform.find((observation) => observation.outcome === "protocol_valid"
    || observation.outcome === "quote_verified"
    || (observation.protocol !== "erc8183" && FAILURE_OUTCOMES.has(observation.outcome)))
    ?? capabilityObservation
    ?? (quote?.validationKind === "quote" && quote.verificationLevel === "cryptographic" ? quote : undefined);
  const capabilityReady = candidate.state?.capabilityState === "ready"
    && candidate.state.canRequestQuote === true
    && candidate.state.capabilityExpiresAt !== null
    && candidate.state.capabilityExpiresAt !== undefined
    && candidate.state.capabilityExpiresAt > now;
  const capabilityStale = candidate.state?.capabilityState === "stale"
    || (candidate.state?.capabilityState === "ready"
      && (candidate.state.capabilityExpiresAt === null
        || candidate.state.capabilityExpiresAt === undefined
        || candidate.state.capabilityExpiresAt <= now));
  const capabilityReachable = capabilityReady
    && (capabilityObservation !== undefined || candidate.state?.capabilityLastAttemptAt != null);
  const freshTransport = candidate.state?.canRequestQuote === true || capabilityReachable || ((transport?.outcome === "protocol_valid" || transport?.outcome === "quote_verified")
    && transport.expiresAt !== null && transport.expiresAt > now);
  const staleTransport = !capabilityReachable && (capabilityStale || ((transport?.outcome === "protocol_valid" || transport?.outcome === "quote_verified")
    && !freshTransport));
  const freshQuote = quote?.outcome === "quote_verified"
    && quote.expiresAt !== null && quote.expiresAt > now;
  const jobCount = candidate.state?.jobCount ?? 0;
  const completedJobCount = candidate.state?.completedJobCount ?? 0;
  // v2 state is the only commerce authority.  `marketplaceConfigured` is a
  // compatibility column and must never make an agent hireable by itself.
  const canRequestQuote = candidate.state?.canRequestQuote === true;
  const latest = platform[0] ?? capabilityObservation;
  const discoveryCheckedAt = candidate.state?.canRequestQuote && candidate.state.compatibilityState === "compatible"
    ? candidate.state.compatibilityCheckedAt ?? null : null;
  const discoveryIsLatest = discoveryCheckedAt !== null && (!latest || discoveryCheckedAt >= latest.observedAt);
  const evidence: EvidenceStepViewModel[] = [
    {
      kind: "declared",
      label: "Declared",
      status: "verified",
      provenance: "declared",
      detail: `${candidate.declarations.length} normalized public endpoint declaration${candidate.declarations.length === 1 ? "" : "s"}.`,
      source: "trust8004 catalog snapshot v2",
    },
    {
      kind: "reachable",
      label: "Reachable",
      status: freshTransport ? "verified" : transport && FAILURE_OUTCOMES.has(transport.outcome) ? "failed" : "unknown",
      provenance: discoveryIsLatest || transport ? "observed" : browser.length > 0 ? "unavailable" : "not_probed",
      detail: discoveryIsLatest
        ? "The selected negotiation endpoint responded and its required inputs were verified. This is a compatibility check, not a separate HTTP health measurement."
        : freshTransport
        ? capabilityReachable
          ? `The marketplace verified a ${candidate.state?.capabilityTransport?.toUpperCase() ?? transport?.protocol.toUpperCase() ?? "seller"} negotiation response. Quote capacity is ready for 24 hours.`
          : transport?.outcome === "quote_verified"
          ? transport.source === "browser_reported"
            ? `A browser-submitted signed quote was verified over ${transport.protocol.toUpperCase()}.`
            : `A platform quote request returned a verified response over ${transport.protocol.toUpperCase()}.`
          : `A platform probe verified a ${transport?.protocol.toUpperCase() ?? "seller"} endpoint response.`
      : staleTransport
          ? capabilityStale
            ? `The last seller capability check succeeded, but its 24-hour Ready-to-quote window has expired.`
            : `The last platform probe verified a ${transport?.protocol.toUpperCase() ?? "seller"} endpoint response, but it is stale. Last checked ${transport ? time(transport.observedAt) : "previously"}.`
        : transport && FAILURE_OUTCOMES.has(transport.outcome)
          ? `The latest platform attempt failed (${transport.errorCode ?? transport.outcome}).`
          : browser.length > 0
            ? "A browser submitted evidence, but browser-reported results never qualify platform reachability."
            : "No platform probe has been recorded yet.",
      ...(discoveryIsLatest ? { timestamp: time(discoveryCheckedAt!), source: "Negotiation discovery" }
        : transport ? { timestamp: time(transport.observedAt), source: `${transport.source} observation` } : {}),
    },
    {
      kind: "quote",
      label: "Ready to quote",
      status: capabilityReady ? "verified" : quote && FAILURE_OUTCOMES.has(quote.outcome) ? "failed" : "unknown",
      provenance: capabilityReady || quote ? "observed" : "not_probed",
      detail: capabilityReady
        ? "Quote capability and current negotiation requirements are verified. Public capability lasts 24 hours; a new buyer-session quote is still required before funding."
        : quote?.outcome === "quote_verified"
          ? "A signed quote was verified previously, but current public negotiation capability is not verified. A historical artifact cannot authorize a new buyer's transaction."
          : quote && FAILURE_OUTCOMES.has(quote.outcome)
            ? `The latest marketplace quote attempt failed (${quote.errorCode ?? quote.outcome}).`
            : "No signed ERC-8183 quote has been verified by the marketplace.",
      ...(capabilityReady && candidate.state?.capabilityLastAttemptAt != null
        ? { timestamp: time(candidate.state.capabilityLastAttemptAt), source: "Verified quote capability" }
        : quote ? { timestamp: time(quote.observedAt), source: `${quote.source} observation` } : {}),
    },
    {
      kind: "job",
      label: "Jobs",
      status: completedJobCount > 0 ? "verified" : jobCount > 0 ? "current" : "unknown",
      provenance: "onchain",
      detail: jobCount > 0
        ? `${jobCount} indexed ERC-8183 job${jobCount === 1 ? "" : "s"}; ${completedJobCount} completed. Completion does not imply result verification.`
        : "No indexed ERC-8183 job is linked to this candidate yet.",
      ...(jobCount > 0 ? { source: "commerce_jobs + chain-verified hire events" } : {}),
    },
  ];

  return {
    agentId: candidate.agentId,
    chainId: candidate.chainId,
    name: candidate.name ?? `Agent #${candidate.agentId}`,
    description: candidate.description ?? "No description declared.",
    ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
    operator: candidate.marketplaceConfigured ? "marketplace" : "third_party",
    quoteRequestAvailable: canRequestQuote,
    ...(candidate.state?.quoteRequestCount === undefined ? {} : { quoteRequestCount: candidate.state.quoteRequestCount }),
    ...(candidate.state?.quoteSuccessCount === undefined ? {} : { quoteSuccessCount: candidate.state.quoteSuccessCount }),
    ...(candidate.state?.lastQuoteAttemptAt === undefined ? {} : {
      lastQuoteAttemptAt: candidate.state.lastQuoteAttemptAt === null ? null : time(candidate.state.lastQuoteAttemptAt),
    }),
    ...(candidate.state?.jobCount === undefined ? {} : { jobCount: candidate.state.jobCount }),
    ...(candidate.state?.completedJobCount === undefined ? {} : { completedJobCount: candidate.state.completedJobCount }),
    ...(candidate.state?.capabilityState === undefined ? {} : { capabilityState: candidate.state.capabilityState }),
    ...(candidate.state?.capabilityExpiresAt === undefined ? {} : {
      capabilityExpiresAt: candidate.state.capabilityExpiresAt === null ? null : time(candidate.state.capabilityExpiresAt),
    }),
    buyerAction: candidate.state?.buyerAction ?? "unavailable",
    blockingReasons: candidate.state?.blockingReasons ?? ["CATALOG_STATE_UNAVAILABLE"],
    categories: candidate.categories,
    protocols: declaredProtocols(candidate),
    ...(candidate.state?.capabilityTransport ? { negotiationProtocol: candidate.state.capabilityTransport === "a2a" ? "A2A" as const : candidate.state.capabilityTransport === "mcp" ? "MCP" as const : "ERC-8183 HTTP" as const } : {}),
    href: `/hire/${candidate.agentId}${candidate.chainId === 97 ? "?network=testnet" : ""}`,
    hireability: candidate.state?.canPrepareHire === true && freshQuote
      ? "hireable"
      : candidate.declarations.some((declaration) => isCatalogOperationalDeclaration(declaration)
        && (declaration.validationProtocol ?? declaration.protocol) === "mcp")
        && !candidate.declarations.some((declaration) => isCatalogOperationalDeclaration(declaration)
          && (declaration.validationProtocol ?? declaration.protocol) !== "mcp")
        ? "mcp_only"
        : candidate.state?.quoteStatus === "verified_historical"
          || (quote?.outcome === "quote_verified" && !freshQuote)
          ? "quote_stale"
          : "listed_only",
    evidence,
    passportState: freshQuote && candidate.state?.canPrepareHire === true ? "hireable"
      : platform.length > 0 || capabilityObservation !== undefined || candidate.state?.capabilityState === "ready" ? "evaluated" : "registered",
    monitoring: discoveryIsLatest ? {
      state: "probed",
      source: "negotiation_discovery",
      lastAttemptAt: time(discoveryCheckedAt!),
    } : latest ? {
      state: "probed",
      source: "worker",
      attemptCount: candidate.platformAttemptCount ?? platform.length,
      lastAttemptAt: time(latest.observedAt),
      latestOutcome: latest.outcome === "network_error" || latest.outcome === "http_error"
        || latest.outcome === "timeout" || latest.outcome === "invalid_response"
        ? "unreachable"
        : latest.outcome === "quote_verified" || latest.outcome === "protocol_valid"
          || latest.outcome === "quote_rejected" || latest.outcome === "unsafe_url"
          || latest.outcome === "unreachable" || latest.outcome === "error"
          ? latest.outcome
          : "error",
      ...(latest.errorCode ? { latestErrorCode: latest.errorCode } : {}),
      ...(latest.httpStatus !== null ? { latestHttpStatus: latest.httpStatus } : {}),
      latestDurationMs: latest.durationMs,
    } : { state: "never_probed", attemptCount: 0 },
  };
}
