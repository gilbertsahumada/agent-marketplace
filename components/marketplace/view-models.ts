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
    declaredOnlyTools: agent.verification.tools.declaredOnly,
    observedOnlyTools: agent.verification.tools.observedOnly,
    toolsObservedAt: agent.verification.tools.observedAt,
  } : null;
}

export function evidenceForAgent(agent: MarketplaceAgent): EvidenceStepViewModel[] {
  const reachable = agent.endpointObservation.status === "observed_ok";
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
      provenance: "observed",
      detail: reachable ? "A service endpoint was observed as reachable." : "No recent endpoint observation is available.",
      source: "trust8004 public API",
      ...(agent.endpointObservation.lastTestedAt ? { timestamp: agent.endpointObservation.lastTestedAt } : {}),
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
  const toolsObserved = agent.tools.status === "observed";
  const verification: VerificationDriftViewModel = {
    freshness: now <= Date.parse(snapshot.staleAfter) ? "current" : "stale",
    generatedAt: snapshot.generatedAt,
    blockNumber: snapshot.blockNumber,
    identityStatus: agent.identity.status,
    identityMismatchFields: agent.identity.mismatchFields,
    identityObservedAt: agent.identity.observedAt,
    toolsStatus: agent.tools.status,
    declaredOnlyTools: agent.tools.declaredOnly,
    observedOnlyTools: agent.tools.observedOnly,
    toolsObservedAt: agent.tools.observedAt,
  };
  return {
    agentId: agent.agentId,
    name: agent.name,
    description: "Curated candidate from the sanitized release snapshot; open its profile for live trust8004 metadata.",
    operator: "third_party",
    categories: agent.categories,
    href: `/agents/${agent.agentId}`,
    hireability: "listed_only",
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
        status: toolsObserved ? "verified" : "unknown",
        provenance: toolsObserved ? "observed" : "not_probed",
        detail: toolsObserved ? "An MCP endpoint was observed during release verification." : "No endpoint probe is available in this release snapshot.",
        source: snapshot.source,
        ...(agent.tools.observedAt ? { timestamp: agent.tools.observedAt } : {}),
      },
      {
        kind: "quote",
        label: "Quote verified",
        status: "unknown",
        provenance: "derived",
        detail: "Live ERC-8183 qualification is unavailable while the catalogue source is offline.",
      },
      {
        kind: "job",
        label: "Job proven",
        status: "unknown",
        provenance: "onchain",
        detail: "No completed onchain job is linked to this third-party candidate.",
      },
    ],
  };
}
