import type { MarketplaceAgent } from "@/src/business/entities/marketplace-agent";
import type { PublicAgentVerification, PublicVerificationSnapshot } from "@/src/business/entities/public-verification-snapshot";
import { deriveAgentPassportState, deriveSnapshotAgentPassportState } from "@/src/business/policies/evidence-passport-policy";
import { isReleaseAgentHireable, isReleaseQuoteCurrent, isVerificationSnapshotCurrent } from "@/src/business/policies/release-qualification-policy";
import type { AgentCardViewModel, EvidenceStepViewModel, VerificationDriftViewModel } from "./presentation-types";
import type { WorkerObservationTarget } from "@/src/business/entities/worker-observations";

export const hireabilityLabels: Record<AgentCardViewModel["hireability"], string> = {
  hireable: "Hireable now",
  mcp_only: "MCP only",
  quote_stale: "Quote expired",
  wallet_ambiguous: "Wallet attribution ambiguous",
  listed_only: "Not evaluated",
};

// Single home of the quote-on-request rule so card, profile and compare cannot disagree.
export function hireabilityLabelFor(view: AgentCardViewModel): string {
  return view.hireability === "listed_only" && view.quoteRequestAvailable === true
    ? "Quote on request"
    : hireabilityLabels[view.hireability];
}

const REACHABILITY_OBSERVATION_MAX_AGE_MS = 15 * 60_000;

function evidenceAge(observedAt: string, now = Date.now()): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(observedAt)) / 1_000));
  if (elapsedSeconds < 60) return "just now";
  if (elapsedSeconds < 3_600) return `${Math.floor(elapsedSeconds / 60)}m ago`;
  if (elapsedSeconds < 86_400) return `${Math.floor(elapsedSeconds / 3_600)}h ago`;
  return `${Math.floor(elapsedSeconds / 86_400)}d ago`;
}

export function verificationViewModel(agent: MarketplaceAgent): VerificationDriftViewModel | null {
  return agent.verification ? {
    freshness: agent.verification.freshness,
    generatedAt: agent.verification.generatedAt,
    blockNumber: agent.verification.blockNumber,
    identityStatus: agent.verification.identity.status,
    identityMismatchFields: agent.verification.identity.mismatchFields,
    identityObservedAt: agent.verification.identity.observedAt,
    identityOnchainProvenance: agent.verification.identity.provenance[1],
    ...(agent.verification.identity.walletAttribution
      ? { walletAttribution: agent.verification.identity.walletAttribution }
      : {}),
    toolsStatus: agent.verification.tools.status,
    toolReachability: agent.verification.tools.reachability,
    toolProbeOutcomes: agent.verification.tools.probeOutcomes,
    declaredOnlyTools: agent.verification.tools.declaredOnly,
    observedOnlyTools: agent.verification.tools.observedOnly,
    toolsObservedAt: agent.verification.tools.observedAt,
  } : null;
}

export function evidenceForAgent(agent: MarketplaceAgent, now = Date.now()): EvidenceStepViewModel[] {
  const releaseReachability = agent.verification?.tools.reachability;
  const releaseEvidenceCurrent = agent.verification?.freshness === "current";
  const reachable = releaseReachability
    ? releaseEvidenceCurrent && releaseReachability === "verified"
    : agent.endpointObservation.status === "observed_ok";
  const reachabilityProvenance = releaseReachability === "not_probed" ? "not_probed" : "observed";
  const reachabilityDetail = releaseReachability === "failed"
    ? `The release probe did not establish protocol-valid reachability (${agent.verification!.tools.probeOutcomes.join(", ")}).`
    : releaseReachability === "verified" && !releaseEvidenceCurrent
      ? "The protocol-valid observation belongs to a stale release snapshot and is not current reachability evidence."
    : reachable
      ? "A service endpoint was observed as protocol-valid and reachable."
      : releaseReachability === "not_probed"
        ? "No endpoint probe was attempted in the current release snapshot."
        : "No recent endpoint observation is available.";
  const reachabilityObservedAt = agent.verification?.tools.observedAt
    ?? agent.endpointObservation.lastTestedAt;
  const quoteVerified = agent.hireability.status === "quote_verified";
  const quoteStale = agent.hireability.status === "quote_stale";
  const quoteObservedAt = agent.verification?.qualification.observedAt;
  return [
    {
      kind: "declared",
      label: "Declared",
      status: "verified",
      provenance: "declared",
      detail: "Identity and services are present in the trust8004 snapshot.",
      source: "trust8004 public API",
      timestamp: agent.freshness.fetchedAt,
    },
    {
      kind: "reachable",
      label: "Reachable",
      status: reachable ? "verified" : "unknown",
      provenance: reachabilityProvenance,
      detail: reachabilityDetail,
      source: releaseReachability ? "marketplace verification release snapshot" : "trust8004 public API",
      ...(reachabilityObservedAt ? { timestamp: reachabilityObservedAt } : {}),
    },
    {
      kind: "quote",
      label: "Quote verified",
      status: quoteVerified ? "verified" : "unknown",
      provenance: quoteVerified || quoteStale ? "observed" : "derived",
      detail: quoteVerified
        ? `An ERC-8183 seller quote was verified ${quoteObservedAt ? evidenceAge(quoteObservedAt, now) : "recently"} and is inside the 60-second hireable-now window.`
        : quoteStale
          ? `A signed ERC-8183 quote was last verified ${quoteObservedAt ? evidenceAge(quoteObservedAt, now) : "more than 60 seconds ago"}; refresh before hiring.`
          : "No compatible ERC-8183 seller quote has been verified.",
      ...(quoteObservedAt && (quoteVerified || quoteStale) ? { timestamp: quoteObservedAt } : {}),
    },
    {
      kind: "job",
      label: "Job proven",
      status: "unknown",
      provenance: "onchain",
      detail: "No completed onchain job is linked to this marketplace agent.",
    },
  ];
}

export function agentCardViewModel(agent: MarketplaceAgent, provenAgentId?: string): AgentCardViewModel {
  const quoteRequestAvailable = agent.operator === "marketplace" && agent.services.some(({ name, endpoint }) => {
    const protocol = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    return endpoint !== null && (protocol === "a2a" || protocol === "erc8183" || protocol === "erc8183http");
  });
  return {
    agentId: agent.agentId,
    name: agent.name,
    description: agent.description ?? "No description declared.",
    ...(agent.imageUrl ? { imageUrl: agent.imageUrl } : {}),
    operator: agent.operator,
    quoteRequestAvailable,
    categories: agent.categories.map(({ category }) => category),
    href: `/hire/${agent.agentId}`,
    hireability: agent.hireability.canHire
      ? "hireable"
      : agent.hireability.status === "mcp_only"
        ? "mcp_only"
        : agent.hireability.status === "quote_stale"
          ? "quote_stale"
          : agent.hireability.status === "wallet_ambiguous"
            ? "wallet_ambiguous"
            : "listed_only",
    evidence: evidenceForAgent(agent),
    verification: verificationViewModel(agent),
    passportState: deriveAgentPassportState(agent, provenAgentId),
    monitoring: { state: "never_probed", attemptCount: 0 },
    ...(agent.trustScore.total !== null ? { trustScore: agent.trustScore.total } : {}),
  };
}

export function agentCardWithObservation(
  agent: MarketplaceAgent,
  target: WorkerObservationTarget | null,
  observationsAvailable: boolean,
  now = Date.now(),
  provenAgentId?: string,
  category?: MarketplaceAgent["categories"][number]["category"],
): AgentCardViewModel {
  const base = agentCardViewModel(agent, provenAgentId);
  if (!target) {
    const releaseObservation = currentReleaseObservation(agent);
    if (releaseObservation) return {
      ...base,
      monitoring: releaseObservation,
      evidence: base.evidence.map((step) => step.kind === "reachable" ? {
        ...step,
        status: agent.verification?.tools.reachability === "verified" ? "verified" : "failed",
        detail: agent.verification?.tools.reachability === "verified"
          ? "A protocol-valid endpoint response was observed in the dated release verification; this is historical evidence, not current Worker reachability."
          : "The dated release verification failed to establish a protocol-valid endpoint response; this is historical evidence, not a current Worker result.",
      } : step),
    };
    if (!hasDeclaredServiceEndpoint(agent)) return withoutDeclaredEndpoint(base);
  }
  if (!observationsAvailable) {
    return withoutCurrentObservation(
      base, "unavailable", "unavailable",
      "The monitoring feed is not connected, so no reachability claim can be made.",
      "feed_unavailable",
    );
  }
  if (!target) {
    return withoutCurrentObservation(
      base, "unavailable", "not_probed",
      "This agent is not part of the Worker's current monitoring scope, so no probe result is claimed.",
      "not_monitored",
    );
  }
  const latest = category ? target.latestByCategory[category] ?? null : target.latest;
  const metadataCurrent = latest !== null
    && target.currentMetadataUpdatedAt === latest.observedMetadataUpdatedAt;
  const observationCurrent = latest !== null
    && latest.probedAt <= now
    && now - latest.probedAt <= REACHABILITY_OBSERVATION_MAX_AGE_MS
    && metadataCurrent;
  const quoteCurrent = target.declarationState === "current"
    && latest?.outcome === "quote_verified"
    && observationCurrent
    && latest.quoteNegotiatedAt !== null
    && latest.quoteNegotiatedAt <= now
    && now - latest.quoteNegotiatedAt <= 60_000
    && latest.quoteExpiresAt !== null
    && latest.quoteExpiresAt > now;
  const reachable = target.declarationState === "current"
    && observationCurrent
    && ["quote_verified", "quote_rejected", "protocol_valid"].includes(latest.outcome);
  const historicallyReachable = latest !== null
    && ["quote_verified", "quote_rejected", "protocol_valid"].includes(latest.outcome);
  const reachabilityFailed = latest !== null
    && ["unreachable", "unsafe_url", "error"].includes(latest.outcome);
  const quoteFailed = latest !== null
    && ["quote_invalid", "quote_rejected"].includes(latest.outcome);
  const quoteObserved = latest?.outcome === "quote_verified";
  const quoteExpired = quoteObserved
    && latest.quoteExpiresAt !== null
    && latest.quoteExpiresAt <= now;
  const observedAt = latest ? new Date(latest.probedAt).toISOString() : undefined;
  const attemptCount = target.attemptCount;
  const attemptSummary = latest
    ? attemptCount === undefined
      ? `Last checked ${evidenceAge(observedAt!, now)}; the deployed Worker does not expose the exact attempt count.`
      : `${attemptCount} marketplace probe ${attemptCount === 1 ? "attempt" : "attempts"}; last checked ${evidenceAge(observedAt!, now)}.`
    : "No marketplace probe has been attempted.";
  return {
    ...base,
    categories: target.categories,
    hireability: quoteCurrent ? "hireable" : latest?.outcome === "quote_verified" ? "quote_stale" : "listed_only",
    passportState: base.passportState === "job_proven" ? "job_proven" : quoteCurrent ? "hireable" : latest ? "evaluated" : "registered",
    monitoring: latest ? {
      state: "probed",
      source: "worker",
      ...(attemptCount !== undefined ? { attemptCount } : {}),
      lastAttemptAt: observedAt!,
      latestOutcome: latest.outcome,
      ...(latest.errorCode ? { latestErrorCode: latest.errorCode } : {}),
      ...(latest.httpStatus !== null && latest.httpStatus !== undefined ? { latestHttpStatus: latest.httpStatus } : {}),
      ...(latest.durationMs !== null && latest.durationMs !== undefined ? { latestDurationMs: latest.durationMs } : {}),
    } : { state: "never_probed", attemptCount: 0 },
    evidence: base.evidence.map((step) => {
      if (step.kind === "reachable") return {
        ...step,
        status: reachable ? "verified" : reachabilityFailed ? "failed" : latest ? "unknown" : "unavailable",
        provenance: latest ? "observed" : "not_probed",
        detail: target.declarationState === "removed"
          ? "This endpoint is no longer declared; its last observation remains historical."
          : target.declarationState === "metadata_unavailable"
            ? "Current metadata could not be reconciled; the seller was not classified as unreachable."
            : reachable
              ? `The target returned a protocol-valid response. ${attemptSummary}`
              : historicallyReachable
                ? `The last probe returned a protocol-valid response, but it is older than the 15-minute monitoring window. ${attemptSummary}`
              : latest?.outcome === "unreachable"
                ? `The last bounded probe could not reach the target${latest.errorCode ? ` (${latest.errorCode})` : ""}. ${attemptSummary}`
                : `No protocol-valid response has been observed for this target. ${attemptSummary}`,
        source: "marketplace observation Worker",
        ...(observedAt ? { timestamp: observedAt } : {}),
      };
      if (step.kind === "quote") return {
        ...step,
        status: quoteCurrent ? "verified" : quoteFailed ? "failed" : latest ? "unknown" : "unavailable",
        provenance: latest ? "observed" : "not_probed",
        detail: quoteCurrent
          ? "A signed ERC-8183 quote is inside the 60-second observation window; Hire still requests a new quote."
          : quoteExpired
            ? "A signed ERC-8183 quote was verified during the last probe and has expired; Hire requests a new quote before wallet action."
          : quoteObserved
            ? "A signed ERC-8183 quote was verified during the last probe but is not current for hiring; Hire requests a new quote before wallet action."
            : "No current signed ERC-8183 quote is available.",
        source: "marketplace observation Worker",
        ...(observedAt ? { timestamp: observedAt } : {}),
      };
      return step;
    }),
  };
}

function hasDeclaredServiceEndpoint(agent: MarketplaceAgent): boolean {
  return agent.services.some(({ endpoint }) => endpoint !== null)
    || agent.endpoints.some(({ endpoint }) => endpoint.trim().length > 0);
}

function currentReleaseObservation(
  agent: MarketplaceAgent,
): AgentCardViewModel["monitoring"] | null {
  const tools = agent.verification?.tools;
  if (agent.verification?.freshness !== "current"
    || tools?.status !== "observed"
    || tools.observedAt === null) return null;
  return {
    state: "probed",
    source: "release_snapshot",
    attemptCount: 1,
    lastAttemptAt: tools.observedAt,
    latestOutcome: tools.reachability === "verified" ? "protocol_valid" : "error",
  };
}

function withoutDeclaredEndpoint(base: AgentCardViewModel): AgentCardViewModel {
  return {
    ...base,
    hireability: "listed_only",
    passportState: base.passportState === "job_proven" ? "job_proven" : "registered",
    monitoring: { state: "no_endpoint_declared", attemptCount: 0 },
    evidence: base.evidence.map((step) => {
      if (step.kind !== "reachable" && step.kind !== "quote") return step;
      const { timestamp: _timestamp, ...withoutTimestamp } = step;
      return {
        ...withoutTimestamp,
        status: "unavailable",
        provenance: "not_probed",
        detail: step.kind === "reachable"
          ? "No service endpoint is declared, so no reachability probe can be attempted."
          : "No A2A or ERC-8183 seller endpoint is declared, so a hiring quote cannot be requested.",
        source: "trust8004 public API",
      };
    }),
  };
}

export function agentCardWithObservations(
  agent: MarketplaceAgent,
  targets: readonly WorkerObservationTarget[],
  observationsAvailable: boolean,
  now = Date.now(),
  provenAgentId?: string,
  category?: MarketplaceAgent["categories"][number]["category"],
): AgentCardViewModel {
  const selected = [...targets].sort((left, right) => (
    targetRank(right, category, now) - targetRank(left, category, now)
    || relevantProbedAt(right, category) - relevantProbedAt(left, category)
    || left.transport.localeCompare(right.transport)
    || left.endpoint.localeCompare(right.endpoint)
  ))[0] ?? null;
  return agentCardWithObservation(
    agent, selected, observationsAvailable, now, provenAgentId, category,
  );
}

function relevantObservation(
  target: WorkerObservationTarget,
  category?: MarketplaceAgent["categories"][number]["category"],
) {
  return category ? target.latestByCategory[category] ?? null : target.latest;
}

function relevantProbedAt(
  target: WorkerObservationTarget,
  category?: MarketplaceAgent["categories"][number]["category"],
): number {
  return relevantObservation(target, category)?.probedAt ?? -1;
}

function targetRank(
  target: WorkerObservationTarget,
  category: MarketplaceAgent["categories"][number]["category"] | undefined,
  now: number,
): number {
  const latest = relevantObservation(target, category);
  const declaration = target.declarationState === "current" ? 100 : target.declarationState === "metadata_unavailable" ? 10 : 0;
  if (!latest) return declaration;
  const fresh = latest.probedAt <= now && now - latest.probedAt <= REACHABILITY_OBSERVATION_MAX_AGE_MS
    && target.currentMetadataUpdatedAt === latest.observedMetadataUpdatedAt;
  const quoteCurrent = fresh
    && latest.outcome === "quote_verified"
    && latest.quoteNegotiatedAt !== null
    && latest.quoteNegotiatedAt <= now
    && now - latest.quoteNegotiatedAt <= 60_000
    && latest.quoteExpiresAt !== null
    && latest.quoteExpiresAt > now;
  const outcome = latest.outcome === "quote_verified" ? 6
    : ["protocol_valid", "quote_rejected"].includes(latest.outcome) ? 5
      : latest.outcome === "reachable" ? 4
        : latest.outcome === "quote_invalid" ? 3
          : latest.outcome === "unreachable" ? 2 : 1;
  return declaration + (quoteCurrent ? 50 : fresh ? 20 : 0) + outcome;
}

function withoutCurrentObservation(
  base: AgentCardViewModel,
  status: "unavailable",
  provenance: "unavailable" | "not_probed",
  detail: string,
  monitoringState: "feed_unavailable" | "not_monitored" | "never_probed",
): AgentCardViewModel {
  return {
    ...base,
    hireability: "listed_only",
    passportState: base.passportState === "job_proven" ? "job_proven" : "registered",
    monitoring: { state: monitoringState, attemptCount: 0 },
    evidence: base.evidence.map((step) => {
      if (step.kind !== "reachable" && step.kind !== "quote") return step;
      const { timestamp: _timestamp, ...withoutTimestamp } = step;
      return {
        ...withoutTimestamp,
        status,
        provenance,
        detail,
        source: "marketplace observation Worker",
      };
    }),
  };
}

export function snapshotAgentCardViewModel(
  agent: PublicAgentVerification,
  snapshot: PublicVerificationSnapshot,
  now = Date.now(),
  provenAgentId?: string,
): AgentCardViewModel {
  const snapshotCurrent = isVerificationSnapshotCurrent(snapshot, now);
  const endpointReachable = snapshotCurrent && agent.tools.reachability === "verified";
  const quoteVerified = isReleaseAgentHireable(agent, snapshot, now);
  const quoteCurrent = isReleaseQuoteCurrent(agent.qualification.observedAt, now);
  const quoteStale = agent.qualification.status === "qualified" && (!quoteCurrent || !snapshotCurrent);
  const verification: VerificationDriftViewModel = {
    freshness: snapshotCurrent ? "current" : "stale",
    generatedAt: snapshot.generatedAt,
    blockNumber: snapshot.blockNumber,
    identityStatus: agent.identity.status,
    identityMismatchFields: agent.identity.mismatchFields,
    identityObservedAt: agent.identity.observedAt,
    identityOnchainProvenance: agent.identity.provenance[1],
    ...(agent.identity.walletAttribution ? { walletAttribution: agent.identity.walletAttribution } : {}),
    toolsStatus: agent.tools.status,
    toolReachability: agent.tools.reachability,
    toolProbeOutcomes: agent.tools.probeOutcomes,
    declaredOnlyTools: agent.tools.declaredOnly,
    observedOnlyTools: agent.tools.observedOnly,
    toolsObservedAt: agent.tools.observedAt,
  };
  return {
    agentId: agent.agentId,
    name: agent.name,
    description: "Curated candidate from the sanitized release snapshot; open its profile for live trust8004 metadata.",
    operator: agent.operator,
    categories: agent.categories,
    href: `/hire/${agent.agentId}`,
    hireability: quoteVerified ? "hireable" : quoteStale ? "quote_stale" : "listed_only",
    verification,
    passportState: deriveSnapshotAgentPassportState(agent, snapshot, now, provenAgentId),
    monitoring: { state: "never_probed", attemptCount: 0 },
    evidence: [
      {
        kind: "declared",
        label: "Declared",
        status: "verified",
        provenance: "declared",
        detail: "Identity was captured from the trust8004 public API in the release snapshot.",
        source: snapshot.source,
        timestamp: snapshot.generatedAt,
      },
      {
        kind: "reachable",
        label: "Reachable",
        status: endpointReachable ? "verified" : "unknown",
        provenance: agent.tools.reachability === "not_probed" ? "not_probed" : "observed",
        detail: endpointReachable
          ? "An MCP endpoint completed protocol validation during release verification."
          : !snapshotCurrent && agent.tools.reachability === "verified"
            ? "The protocol-valid observation belongs to a stale release snapshot and is not current reachability evidence."
          : agent.tools.reachability === "failed"
            ? `A probe was attempted but did not establish reachability (${agent.tools.probeOutcomes.join(", ")}).`
            : "No endpoint probe is available in this release snapshot.",
        source: snapshot.source,
        ...(agent.tools.observedAt ? { timestamp: agent.tools.observedAt } : {}),
      },
      {
        kind: "quote",
        label: "Quote verified",
        status: quoteVerified ? "verified" : "unknown",
        provenance: quoteVerified || quoteStale ? "observed" : "derived",
        detail: quoteVerified
          ? `The current release readiness snapshot qualifies this seller; the quote was verified ${evidenceAge(agent.qualification.observedAt, now)} ago and a fresh quote is still required before signing.`
          : quoteStale
            ? `A signed quote was last verified ${evidenceAge(agent.qualification.observedAt, now)} ago at ${agent.qualification.observedAt}; it is outside the 60-second hireable-now window.`
            : "No current ERC-8183 seller qualification is present in this release snapshot.",
        ...(quoteStale || quoteVerified ? { timestamp: agent.qualification.observedAt } : {}),
      },
      {
        kind: "job",
        label: "Job proven",
        status: "unknown",
        provenance: "onchain",
        detail: `No completed onchain job is linked to this ${agent.operator === "marketplace" ? "marketplace-operated seller" : "third-party candidate"}.`,
      },
    ],
  };
}
