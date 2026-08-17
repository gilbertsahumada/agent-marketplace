import type { MarketplaceAgent } from "@/src/business/entities/marketplace-agent";
import type { AgentCardViewModel, EvidenceStepViewModel } from "./presentation-types";

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
    categories: agent.categories.map(({ category }) => category),
    href: `/agents/${agent.agentId}`,
    hireability: agent.hireability.canHire
      ? "hireable"
      : agent.hireability.status === "mcp_only"
        ? "mcp_only"
        : "listed_only",
    evidence: evidenceForAgent(agent),
    ...(agent.trustScore.total !== null ? { trustScore: agent.trustScore.total } : {}),
  };
}
