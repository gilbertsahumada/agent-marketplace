import {
  isCatalogOperationalObservation,
  type CatalogCandidate,
} from "@/src/business/entities/catalog-candidate";
import type { AgentCardViewModel, EvidenceStepViewModel } from "./presentation-types";

const PLATFORM_SOURCES = new Set(["marketplace_probe", "worker_probe", "buyer_refresh", "migration"]);
const FAILURE_OUTCOMES = new Set([
  "http_error", "timeout", "network_error", "invalid_response", "unsafe_url", "quote_rejected", "unreachable", "error",
]);

const BLOCKING_REASON_COPY: Record<string, string> = {
  NO_ELIGIBLE_OPERATIONAL_ENDPOINT: "No supported operational endpoint is available for marketplace hiring.",
  COMMERCE_NOT_ADMITTED: "This seller has not been admitted to the marketplace hiring flow.",
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

export function catalogCandidateCard(
  candidate: CatalogCandidate,
  now = Date.now(),
): AgentCardViewModel {
  const platform = candidate.observations
    .filter((observation) => isPlatformReachabilityObservation(candidate, observation))
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);
  const browser = candidate.observations
    .filter((observation) => observation.source === "browser_reported")
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);
  const quote = candidate.observations
    .filter((observation) => (observation.validationKind === "quote"
      && observation.verificationLevel === "cryptographic"
      && isCatalogOperationalObservation(candidate, observation)
      && (candidate.admission?.endpointKey === null
        || candidate.admission?.endpointKey === undefined
        || observation.endpointKey === candidate.admission.endpointKey))
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
    ?? (quote?.validationKind === "quote" && quote.verificationLevel === "cryptographic" ? quote : undefined);
  const freshTransport = (transport?.outcome === "protocol_valid" || transport?.outcome === "quote_verified")
    && transport.expiresAt !== null && transport.expiresAt > now;
  const staleTransport = (transport?.outcome === "protocol_valid" || transport?.outcome === "quote_verified")
    && !freshTransport;
  const freshQuote = quote?.outcome === "quote_verified"
    && quote.expiresAt !== null && quote.expiresAt > now;
  // v2 state is the only commerce authority.  `marketplaceConfigured` is a
  // compatibility column and must never make an agent hireable by itself.
  const canRequestQuote = candidate.state?.canRequestQuote === true;
  const latest = platform[0];
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
      provenance: transport ? "observed" : browser.length > 0 ? "unavailable" : "not_probed",
      detail: freshTransport
        ? transport.outcome === "quote_verified"
          ? transport.source === "browser_reported"
            ? `A browser-submitted signed quote was verified over ${transport.protocol.toUpperCase()}.`
            : `A platform quote request returned a verified response over ${transport.protocol.toUpperCase()}.`
          : `A platform probe returned a protocol-valid ${transport.protocol.toUpperCase()} response.`
        : staleTransport
          ? `The last platform probe returned a protocol-valid ${transport.protocol.toUpperCase()} response, but it is stale. Last checked ${time(transport.observedAt)}.`
        : transport && FAILURE_OUTCOMES.has(transport.outcome)
          ? `The latest platform attempt failed (${transport.errorCode ?? transport.outcome}).`
          : browser.length > 0
            ? "A browser submitted evidence, but browser-reported results never qualify platform reachability."
            : "No platform probe has been recorded yet.",
      ...(transport ? { timestamp: time(transport.observedAt), source: `${transport.source} observation` } : {}),
    },
    {
      kind: "quote",
      label: "Quote verified",
      status: freshQuote ? "verified" : quote && FAILURE_OUTCOMES.has(quote.outcome) ? "failed" : "unknown",
      provenance: quote ? "observed" : "not_probed",
      detail: freshQuote
        ? "A signed ERC-8183 quote was verified and remains inside its declared validity window."
        : quote?.outcome === "quote_verified"
          ? "A signed ERC-8183 quote was verified previously and is now stale; requesting a quote runs validation again."
          : quote && FAILURE_OUTCOMES.has(quote.outcome)
            ? `The latest marketplace quote attempt failed (${quote.errorCode ?? quote.outcome}).`
            : "No signed ERC-8183 quote has been verified by the marketplace.",
      ...(quote ? { timestamp: time(quote.observedAt), source: `${quote.source} observation` } : {}),
    },
    {
      kind: "job",
      label: "Job proven",
      status: "unknown",
      provenance: "onchain",
      detail: "No completed onchain job is linked to this indexed candidate.",
    },
  ];

  return {
    agentId: candidate.agentId,
    name: candidate.name ?? `Agent #${candidate.agentId}`,
    description: candidate.description ?? "No description declared.",
    ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
    operator: candidate.admission?.state === "admitted" ? "marketplace" : "third_party",
    quoteRequestAvailable: canRequestQuote,
    buyerAction: candidate.state?.buyerAction ?? "unavailable",
    blockingReasons: candidate.state?.blockingReasons ?? ["CATALOG_STATE_UNAVAILABLE"],
    categories: candidate.categories,
    href: `/agents/${candidate.agentId}`,
    hireability: canRequestQuote ? (freshQuote ? "hireable" : "quote_stale") : "listed_only",
    evidence,
    passportState: freshQuote && candidate.state?.canPrepareHire === true ? "hireable"
      : platform.length > 0 ? "evaluated" : "registered",
    passportHref: `/agents/${candidate.agentId}/passport`,
    monitoring: latest ? {
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
