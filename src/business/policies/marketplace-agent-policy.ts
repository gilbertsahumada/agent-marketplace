import { getMarketplaceInventoryEntry } from "../../data/inventory/marketplace-inventory.js";
import type { MarketplaceAgentData } from "../../data/repositories/marketplace-agent-repository.js";
import type { OnchainIdentityData } from "../../data/repositories/marketplace-agent-repository.js";
import type {
  EvidenceRecord,
  MarketplaceAgent,
  MarketplaceCategory,
  MarketplaceHireability,
} from "../entities/marketplace-agent.js";

function evidence(
  kind: EvidenceRecord["kind"],
  source: EvidenceRecord["source"],
  observedAt: string,
  verifiedDirectly: boolean,
  note: string,
): EvidenceRecord {
  return { kind, source, observedAt, verifiedDirectly, note };
}

function serviceKind(name: string): "mcp" | "seller" | "other" {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "mcp") return "mcp";
  if (normalized === "a2a" || normalized === "erc8183") return "seller";
  return "other";
}

export function determineHireability(
  agent: MarketplaceAgentData,
): MarketplaceHireability {
  const serviceKinds = agent.services
    .filter((service) => Boolean(service.endpoint))
    .map((service) => serviceKind(service.name));
  const hasSellerProtocol = serviceKinds.includes("seller");
  const hasMcp = serviceKinds.includes("mcp");
  const observedAt = agent.freshness.fetchedAt;

  if (
    agent.verification?.freshness === "current"
    && agent.verification.qualification.status === "qualified"
  ) {
    return {
      status: "quote_verified",
      canHire: true,
      reason: "The seller passed the release qualification gate; every new quote is reverified before wallet connection.",
      evidence: evidence(
        "derived",
        "marketplace-readiness",
        agent.verification.qualification.observedAt,
        false,
        "Current readiness qualification combines verified identity and signed-quote evidence.",
      ),
    };
  }

  if (hasSellerProtocol) {
    return {
      status: "protocol_discovered",
      canHire: false,
      reason: "A seller protocol is declared, but no signed ERC-8183 quote is verified in this catalogue record.",
      evidence: evidence(
        "derived",
        "marketplace-inventory",
        observedAt,
        false,
        "Protocol discovery alone never enables Hire.",
      ),
    };
  }
  if (hasMcp) {
    return {
      status: "mcp_only",
      canHire: false,
      reason: "MCP is declared, but MCP availability is not ERC-8183 hireability.",
      evidence: evidence(
        "derived",
        "marketplace-inventory",
        observedAt,
        false,
        "No verified ERC-8183 seller quote is present.",
      ),
    };
  }
  return {
    status: "not_declared",
    canHire: false,
    reason: "No A2A or HTTP ERC-8183 seller service is declared.",
    evidence: evidence(
      "derived",
      "marketplace-inventory",
      observedAt,
      false,
      "No compatible seller transport is declared.",
    ),
  };
}

export function toMarketplaceAgent(
  data: MarketplaceAgentData,
  options: { evaluateMarketplace: boolean },
): MarketplaceAgent {
  const inventory = getMarketplaceInventoryEntry(data.agentId);
  const fetchedAt = data.freshness.fetchedAt;
  const trustSource = "trust8004-public-api" as const;
  const evaluatesCandidate = options.evaluateMarketplace && inventory !== null;
  return {
    chainId: data.chainId,
    agentId: data.agentId,
    name: data.name,
    description: data.description,
    owner: data.owner,
    metadataUri: data.metadataUri,
    operator: data.verification?.operator ?? inventory?.operator ?? "third_party",
    indexedIdentity: {
      owner: data.owner,
      metadataUri: data.metadataUri,
      evidence: evidence(
        "onchain",
        trustSource,
        fetchedAt,
        false,
        "Indexed by trust8004; not verified directly onchain by this catalogue use case.",
      ),
    },
    onchainIdentity: {
      status: "not_requested",
      owner: null,
      agentWallet: null,
      metadataUri: null,
      registryAddress: null,
      blockNumber: null,
      observedAt: null,
      checks: { ownerMatches: null, metadataUriMatches: null },
      error: null,
      evidence: null,
    },
    categoryEvaluation: evaluatesCandidate ? "evaluated" : "not_evaluated",
    categories: (evaluatesCandidate ? inventory.categories : []).map((categoryEvidence) => ({
      category: categoryEvidence.category as MarketplaceCategory,
      evidence: evidence(
        "derived",
        "marketplace-inventory",
        fetchedAt,
        false,
        `${categoryEvidence.signal} Candidate mapping is not proof of operational capability.`,
      ),
    })),
    services: data.services,
    endpoints: data.endpoints,
    tools: data.tools,
    capabilities: data.capabilities,
    endpointObservation: data.endpointObservation,
    reputation: data.reputation,
    trustScore: data.trustScore,
    hireability: evaluatesCandidate
      ? determineHireability(data)
      : {
        status: "not_evaluated",
        canHire: false,
        reason: "This registered agent is outside the curated marketplace inventory and was not evaluated for hiring.",
        evidence: evidence(
          "derived",
          "marketplace-inventory",
          fetchedAt,
          false,
          "Global registry presence does not imply marketplace classification or hireability.",
        ),
      },
    freshness: data.freshness,
    verification: data.verification ? {
      ...data.verification,
      identity: {
        ...data.verification.identity,
        provenance: ["declared", "onchain"],
      },
      tools: {
        ...data.verification.tools,
        provenance: data.verification.tools.status === "not_probed" ? "not_probed" : "observed",
      },
    } : null,
    catalogCoverage: "partial",
    provenance: {
      identity: evidence(
        "onchain",
        trustSource,
        fetchedAt,
        false,
        "Indexed by trust8004; not verified directly onchain by this catalogue use case.",
      ),
      services: evidence(
        "declared",
        trustSource,
        fetchedAt,
        false,
        "Declared services and tools are not verified capabilities.",
      ),
      endpointObservation: evidence(
        "observed",
        trustSource,
        data.endpointObservation.lastTestedAt ?? fetchedAt,
        data.endpointObservation.status !== "not_observed",
        data.endpointObservation.status === "not_observed"
          ? "No persisted endpoint observation is available."
          : "Persisted endpoint observation reported by trust8004.",
      ),
      reputation: evidence(
        "onchain",
        trustSource,
        fetchedAt,
        false,
        "Indexed reputation summary; not re-read directly from BSC by this use case.",
      ),
      trustScore: evidence(
        "derived",
        trustSource,
        data.trustScore.calculatedAt ?? fetchedAt,
        false,
        "Calculated by trust8004 and not independently recalculated by the marketplace.",
      ),
    },
  };
}

export function attachOnchainIdentity(
  agent: MarketplaceAgent,
  identity: OnchainIdentityData,
): MarketplaceAgent {
  if (identity.status === "unavailable") {
    return {
      ...agent,
      onchainIdentity: {
        status: "unavailable",
        owner: null,
        agentWallet: null,
        metadataUri: null,
        registryAddress: identity.registryAddress,
        blockNumber: identity.blockNumber,
        observedAt: identity.observedAt,
        checks: { ownerMatches: null, metadataUriMatches: null },
        error: identity.error,
        evidence: evidence(
          "onchain",
          "bsc-rpc",
          identity.observedAt,
          false,
          "Direct BSC identity read was unavailable; indexed identity remains separate.",
        ),
      },
    };
  }
  const ownerMatches = agent.indexedIdentity.owner !== null
    && agent.indexedIdentity.owner.toLowerCase() === identity.owner.toLowerCase();
  const metadataUriMatches = agent.indexedIdentity.metadataUri === identity.metadataUri;
  return {
    ...agent,
    onchainIdentity: {
      status: ownerMatches && metadataUriMatches ? "match" : "mismatch",
      owner: identity.owner,
      agentWallet: identity.agentWallet,
      metadataUri: identity.metadataUri,
      registryAddress: identity.registryAddress,
      blockNumber: identity.blockNumber,
      observedAt: identity.observedAt,
      checks: { ownerMatches, metadataUriMatches },
      error: null,
      evidence: evidence(
        "onchain",
        "bsc-rpc",
        identity.observedAt,
        true,
        "Read directly from the BSC ERC-8004 registry at the recorded block.",
      ),
    },
  };
}
