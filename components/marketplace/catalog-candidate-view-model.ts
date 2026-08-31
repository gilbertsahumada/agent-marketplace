import type { CatalogCandidate } from "@/src/business/entities/catalog-candidate";
import type { AgentCardViewModel, EvidenceStepViewModel } from "./presentation-types";

const PLATFORM_SOURCES = new Set(["marketplace_probe", "worker_probe", "buyer_refresh", "migration"]);
const FAILURE_OUTCOMES = new Set([
  "http_error", "timeout", "network_error", "invalid_response", "unsafe_url", "quote_rejected", "unreachable", "error",
]);

function time(value: number): string { return new Date(value).toISOString(); }

export function catalogCandidateCard(
  candidate: CatalogCandidate,
  now = Date.now(),
): AgentCardViewModel {
  const platform = candidate.observations
    .filter((observation) => PLATFORM_SOURCES.has(observation.source))
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);
  const browser = candidate.observations
    .filter((observation) => observation.source === "browser_reported")
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);
  const quote = candidate.observations
    .filter((observation) => (observation.validationKind === "quote"
      && observation.verificationLevel === "cryptographic")
      || (observation.validationKind === undefined
        && PLATFORM_SOURCES.has(observation.source)
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
          ? `A platform quote request returned a verified response over ${transport.protocol.toUpperCase()}.`
          : `A platform probe returned a protocol-valid ${transport.protocol.toUpperCase()} response.`
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
