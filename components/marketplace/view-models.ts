import type { MarketplaceAgent } from "@/src/business/entities/marketplace-agent";
import type { PublicAgentVerification, PublicVerificationSnapshot } from "@/src/business/entities/public-verification-snapshot";
import { deriveAgentPassportState, deriveSnapshotAgentPassportState } from "@/src/business/policies/evidence-passport-policy";
import { isReleaseAgentHireable, isReleaseQuoteCurrent, isVerificationSnapshotCurrent } from "@/src/business/policies/release-qualification-policy";
import type { AgentCardViewModel, EvidenceStepViewModel, VerificationDriftViewModel } from "./presentation-types";
import type { WorkerObservationTarget } from "@/src/business/entities/worker-observations";

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
  return {
    agentId: agent.agentId,
    name: agent.name,
    description: agent.description ?? "No description declared.",
    operator: agent.operator,
    categories: agent.categories.map(({ category }) => category),
    href: `/agents/${agent.agentId}`,
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
    passportHref: `/agents/${agent.agentId}/passport`,
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
  if (!observationsAvailable) {
    return withoutCurrentObservation(
      base, "unavailable", "unavailable",
      "Current marketplace observations are temporarily unavailable.",
    );
  }
  if (!target) {
    return withoutCurrentObservation(
      base, "unavailable", "not_probed",
      "No current marketplace observation exists for this declared agent.",
    );
  }
  const latest = category ? target.latestByCategory[category] ?? null : target.latest;
  const quoteCurrent = target.declarationState === "current"
    && latest?.outcome === "quote_verified"
    && now - latest.probedAt <= 60_000
    && latest.probedAt <= now
    && latest.quoteExpiresAt !== null
    && latest.quoteExpiresAt > now;
  const reachable = target.declarationState === "current"
    && latest !== null
    && ["quote_verified", "quote_rejected", "protocol_valid"].includes(latest.outcome);
  const observedAt = latest ? new Date(latest.probedAt).toISOString() : undefined;
  return {
    ...base,
    categories: target.categories,
    hireability: quoteCurrent ? "hireable" : latest?.outcome === "quote_verified" ? "quote_stale" : "listed_only",
    passportState: base.passportState === "job_proven" ? "job_proven" : quoteCurrent ? "hireable" : latest ? "evaluated" : "registered",
    evidence: base.evidence.map((step) => {
      if (step.kind === "reachable") return {
        ...step,
        status: reachable ? "verified" : latest ? "unknown" : "unavailable",
        provenance: latest ? "observed" : "not_probed",
        detail: target.declarationState === "removed"
          ? "This endpoint is no longer declared; its last observation remains historical."
          : target.declarationState === "metadata_unavailable"
            ? "Current metadata could not be reconciled; the seller was not classified as unreachable."
            : reachable
              ? "The current target returned a protocol-valid response."
              : latest?.outcome === "unreachable"
                ? "The current target did not answer within the bounded probe."
                : "No protocol-valid response has been observed for this target.",
        source: "marketplace observation Worker",
        ...(observedAt ? { timestamp: observedAt } : {}),
      };
      if (step.kind === "quote") return {
        ...step,
        status: quoteCurrent ? "verified" : latest ? "unknown" : "unavailable",
        provenance: latest ? "observed" : "not_probed",
        detail: quoteCurrent
          ? "A signed ERC-8183 quote is inside the 60-second observation window; Hire still requests a new quote."
          : latest?.outcome === "quote_verified"
            ? "A signed quote was verified historically but is no longer current."
            : "No current signed ERC-8183 quote is available.",
        source: "marketplace observation Worker",
        ...(observedAt ? { timestamp: observedAt } : {}),
      };
      return step;
    }),
  };
}

function withoutCurrentObservation(
  base: AgentCardViewModel,
  status: "unavailable",
  provenance: "unavailable" | "not_probed",
  detail: string,
): AgentCardViewModel {
  return {
    ...base,
    hireability: "listed_only",
    passportState: base.passportState === "job_proven" ? "job_proven" : "registered",
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
    href: `/agents/${agent.agentId}`,
    hireability: quoteVerified ? "hireable" : quoteStale ? "quote_stale" : "listed_only",
    verification,
    passportState: deriveSnapshotAgentPassportState(agent, snapshot, now, provenAgentId),
    passportHref: `/agents/${agent.agentId}/passport`,
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
