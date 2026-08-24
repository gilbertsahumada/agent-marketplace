import type { MarketplaceAgent } from "@/src/business/entities/marketplace-agent";
import type { PublicAgentVerification, PublicVerificationSnapshot } from "@/src/business/entities/public-verification-snapshot";
import type { AgentCardViewModel, EvidenceStepViewModel, VerificationDriftViewModel } from "./presentation-types";

export function verificationViewModel(agent: MarketplaceAgent): VerificationDriftViewModel | null {
  return agent.verification ? {
    freshness: agent.verification.freshness,
    generatedAt: agent.verification.generatedAt,
    blockNumber: agent.verification.blockNumber,
    identityStatus: agent.verification.identity.status,
    identityMismatchFields: agent.verification.identity.mismatchFields,
    identityObservedAt: agent.verification.identity.observedAt,
    toolsStatus: agent.verification.tools.status,
    toolReachability: agent.verification.tools.reachability,
    toolProbeOutcomes: agent.verification.tools.probeOutcomes,
    declaredOnlyTools: agent.verification.tools.declaredOnly,
    observedOnlyTools: agent.verification.tools.observedOnly,
    toolsObservedAt: agent.verification.tools.observedAt,
  } : null;
}

export function evidenceForAgent(agent: MarketplaceAgent): EvidenceStepViewModel[] {
  const releaseReachability = agent.verification?.tools.reachability;
  const reachable = releaseReachability
    ? releaseReachability === "verified"
    : agent.endpointObservation.status === "observed_ok";
  const reachabilityProvenance = releaseReachability === "not_probed" ? "not_probed" : "observed";
  const reachabilityDetail = releaseReachability === "failed"
    ? `The release probe did not establish protocol-valid reachability (${agent.verification!.tools.probeOutcomes.join(", ")}).`
    : reachable
      ? "A service endpoint was observed as protocol-valid and reachable."
      : releaseReachability === "not_probed"
        ? "No endpoint probe was attempted in the current release snapshot."
        : "No recent endpoint observation is available.";
  const reachabilityObservedAt = agent.verification?.tools.observedAt
    ?? agent.endpointObservation.lastTestedAt;
  const quoteVerified = agent.hireability.status === "quote_verified";
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
      provenance: quoteVerified ? "observed" : "derived",
      detail: quoteVerified ? "An ERC-8183 seller quote was verified." : "No compatible ERC-8183 seller quote has been verified.",
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

export function agentCardViewModel(agent: MarketplaceAgent): AgentCardViewModel {
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
        : "listed_only",
    evidence: evidenceForAgent(agent),
    verification: verificationViewModel(agent),
    ...(agent.trustScore.total !== null ? { trustScore: agent.trustScore.total } : {}),
  };
}

export function snapshotAgentCardViewModel(
  agent: PublicAgentVerification,
  snapshot: PublicVerificationSnapshot,
  now = Date.now(),
): AgentCardViewModel {
  const endpointReachable = agent.tools.reachability === "verified";
  const snapshotCurrent = now <= Date.parse(snapshot.staleAfter)
    && Date.parse(snapshot.generatedAt) <= now + 5 * 60 * 1_000;
  const quoteVerified = snapshotCurrent && agent.qualification.status === "qualified";
  const verification: VerificationDriftViewModel = {
    freshness: snapshotCurrent ? "current" : "stale",
    generatedAt: snapshot.generatedAt,
    blockNumber: snapshot.blockNumber,
    identityStatus: agent.identity.status,
    identityMismatchFields: agent.identity.mismatchFields,
    identityObservedAt: agent.identity.observedAt,
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
    hireability: quoteVerified ? "hireable" : "listed_only",
    verification,
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
        provenance: "derived",
        detail: quoteVerified
          ? "The current release readiness snapshot qualifies this seller; a fresh quote is still required."
          : "No current ERC-8183 seller qualification is present in this release snapshot.",
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
