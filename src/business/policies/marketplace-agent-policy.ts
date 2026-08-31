import { getMarketplaceInventoryEntry } from "../../data/inventory/marketplace-inventory.ts";
import type { MarketplaceAgentData } from "../../data/repositories/marketplace-agent-repository.ts";
import type { OnchainIdentityData } from "../../data/repositories/marketplace-agent-repository.ts";
import {
  isCatalogOperationalDeclaration,
  isCatalogSellerDeclaration,
  type CatalogCandidate,
  type CatalogCandidateObservation,
} from "../entities/catalog-candidate.ts";
import type {
  EvidenceRecord,
  MarketplaceAgent,
  MarketplaceCategory,
  MarketplaceHireability,
} from "../entities/marketplace-agent.ts";
import type { EndpointObservation } from "../../trust8004/types.ts";
import { isReleaseQuoteCurrent } from "./release-qualification-policy.ts";

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
  now = Date.now(),
): MarketplaceHireability {
  const declarations = [
    ...agent.services.map(({ name, endpoint }) => ({ name, endpoint })),
    ...agent.endpoints,
  ];
  const serviceKinds = declarations
    .filter(({ endpoint }) => Boolean(endpoint))
    .map(({ name }) => name ? serviceKind(name) : "other");
  const hasSellerProtocol = serviceKinds.includes("seller");
  const hasMcp = serviceKinds.includes("mcp");
  const observedAt = agent.freshness.fetchedAt;
  const walletAttribution = agent.verification?.identity.walletAttribution;

  if (walletAttribution?.status === "ambiguous") {
    return {
      status: "wallet_ambiguous",
      canHire: false,
      reason: `The seller wallet maps to ${walletAttribution.candidateCount} evaluated Agent IDs; payment cannot be attributed safely to one agent.`,
      evidence: evidence(
        "observed",
        "marketplace-readiness",
        agent.verification?.identity.observedAt ?? observedAt,
        true,
        "Wallet attribution is ambiguous within the evaluated set.",
      ),
    };
  }

  if (
    agent.verification?.qualification.status === "qualified"
    && agent.verification.selection !== "operator_explicit"
  ) {
    if (
      agent.verification.freshness !== "current"
      || !isReleaseQuoteCurrent(agent.verification.qualification.observedAt, now)
    ) {
      return {
        status: "quote_stale",
        canHire: false,
        reason: agent.verification.freshness === "stale"
          ? "A signed quote was verified in an expired release snapshot; refresh the seller evidence before hiring."
          : "A signed quote was verified, but it is older than 60 seconds; refresh it before hiring.",
        evidence: evidence(
          "observed",
          "marketplace-readiness",
          agent.verification.qualification.observedAt,
          true,
          agent.verification.freshness === "stale"
            ? "The last signed quote passed the release gate, but its release snapshot is expired."
            : "The last signed quote passed the release gate but is outside the 60-second hireable-now window.",
        ),
      };
    }
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
    status: "no_transport_declared",
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

const CATALOG_PLATFORM_SOURCES = new Set(["worker_probe", "buyer_refresh", "migration"]);

function newestCatalogPlatformObservation(candidate: CatalogCandidate): CatalogCandidateObservation | undefined {
  const observations = candidate.observations
    .filter((observation) => CATALOG_PLATFORM_SOURCES.has(observation.source)
      && (observation.validationKind === "reachability" || observation.validationKind === "protocol")
      && observation.verificationLevel === "platform_observed")
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);
  const admittedEndpointKey = candidate.admission?.endpointKey;
  return (admittedEndpointKey === null || admittedEndpointKey === undefined
    ? observations
    : observations.filter((observation) => observation.endpointKey === admittedEndpointKey))[0]
    ?? observations[0];
}

function catalogEndpointObservation(candidate: CatalogCandidate): EndpointObservation {
  const latest = newestCatalogPlatformObservation(candidate);
  if (!latest) {
    return {
      status: "not_observed",
      protocol: null,
      endpoint: null,
      lastTestedAt: null,
      httpStatus: null,
      capabilitiesCount: 0,
      requiresAuth: null,
      error: null,
    };
  }
  const declaration = candidate.declarations.find(({ endpointKey }) => endpointKey === latest.endpointKey);
  const protocol = latest.protocol === "mcp"
    ? "mcp" as const
    : latest.protocol === "erc8183_http"
      ? "erc8183_http" as const
    : latest.protocol === "web"
      ? "web" as const
      : "a2a" as const;
  return {
    status: latest.outcome === "protocol_valid" || latest.outcome === "quote_verified"
      ? "observed_ok" : "observed_failed",
    protocol,
    endpoint: declaration?.endpoint ?? null,
    lastTestedAt: new Date(latest.observedAt).toISOString(),
    httpStatus: latest.httpStatus,
    capabilitiesCount: 0,
    requiresAuth: null,
    error: latest.outcome === "protocol_valid" || latest.outcome === "quote_verified"
      ? null : latest.errorCode ?? latest.outcome,
  };
}

function catalogHireability(candidate: CatalogCandidate, now: number): MarketplaceHireability | null {
  const state = candidate.state;
  if (!state) return null;
  const observedAt = newestCatalogPlatformObservation(candidate)?.observedAt
    ?? candidate.registeredAt
    ?? now;
  const timestamp = new Date(observedAt).toISOString();
  const sellerDeclared = candidate.declarations.some(isCatalogSellerDeclaration);
  const admitted = state.commerceStatus === "admitted"
    && state.canRequestQuote
    && sellerDeclared;
  const readinessEvidence = (note: string, kind: EvidenceRecord["kind"] = "derived"): EvidenceRecord => evidence(
    kind,
    "marketplace-readiness",
    timestamp,
    false,
    note,
  );
  if (state.canPrepareHire) {
    return {
      status: "quote_verified",
      canHire: admitted,
      reason: "The normalized catalog has a fresh verified quote and current chain evidence for this admitted endpoint.",
      evidence: readinessEvidence("Derived from the normalized Worker admission and evidence state."),
    };
  }
  if (state.quoteStatus === "verified_historical") {
    return {
      status: "quote_stale",
      canHire: admitted,
      reason: "A signed quote was verified previously, but it is outside its validity window.",
      evidence: readinessEvidence("The quote remains in the append-only ledger but is no longer fresh.", "observed"),
    };
  }
  if (sellerDeclared) {
    return {
      status: "protocol_discovered",
      canHire: admitted,
      reason: state.commerceStatus === "admitted"
        ? "The seller is admitted and can request a fresh quote; a cached observation never authorizes a transaction."
        : "A compatible seller transport is declared, but marketplace admission is not complete.",
      evidence: readinessEvidence("Protocol declaration and commerce admission are distinct from hireability."),
    };
  }
  if (candidate.declarations.some((declaration) => isCatalogOperationalDeclaration(declaration)
    && (declaration.validationProtocol ?? declaration.protocol) === "mcp")) {
    return {
      status: "mcp_only",
      canHire: false,
      reason: "MCP reachability does not provide an ERC-8183 hiring path.",
      evidence: readinessEvidence("MCP is an operational transport, not commerce admission."),
    };
  }
  return {
    status: "no_transport_declared",
    canHire: false,
    reason: "No compatible A2A or ERC-8183 HTTP seller transport is declared.",
    evidence: readinessEvidence("The normalized catalog has no eligible seller transport."),
  };
}

function catalogCategoryAssignments(candidate: CatalogCandidate): MarketplaceAgent["categories"] {
  const observedAt = new Date(candidate.registeredAt ?? Date.now()).toISOString();
  return candidate.categories.map((category) => ({
    category,
    evidence: evidence(
      "derived",
      "marketplace-readiness",
      observedAt,
      false,
      "Category assignment comes from the normalized marketplace catalogue and is not proof of performance.",
    ),
  }));
}

export function selectHireAlternative(
  selected: MarketplaceAgent,
  candidates: readonly MarketplaceAgent[],
): MarketplaceAgent | null {
  const categories = new Set(selected.categories.map(({ category }) => category));
  const qualified = candidates.filter((candidate) =>
    candidate.agentId !== selected.agentId && candidate.hireability.canHire);
  return qualified.find((candidate) =>
    candidate.categories.some(({ category }) => categories.has(category)))
    ?? qualified[0]
    ?? null;
}

export function isAdmittedMarketplaceSeller(agent: MarketplaceAgent): boolean {
  return agent.operator === "marketplace" || agent.hireability.canHire;
}

export function toMarketplaceAgent(
  data: MarketplaceAgentData,
  options: { evaluateMarketplace: boolean },
): MarketplaceAgent {
  const inventory = getMarketplaceInventoryEntry(data.agentId);
  const fetchedAt = data.freshness.fetchedAt;
  const trustSource = "trust8004-public-api" as const;
  const evaluatesCandidate = options.evaluateMarketplace && inventory !== null;
  const catalog = data.catalogCandidate;
  const catalogHire = catalog ? catalogHireability(catalog, Date.now()) : null;
  const catalogObservation = catalog ? catalogEndpointObservation(catalog) : null;
  const catalogCategories = catalog ? catalogCategoryAssignments(catalog) : null;
  return {
    chainId: data.chainId,
    agentId: data.agentId,
    name: data.name,
    description: data.description,
    ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
    owner: data.owner,
    metadataUri: data.metadataUri,
    operator: catalog?.admission?.state === "admitted"
      ? "marketplace"
      : data.verification?.operator ?? inventory?.operator ?? "third_party",
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
    categoryEvaluation: catalog ? "evaluated" : evaluatesCandidate ? "evaluated" : "not_evaluated",
    categories: catalogCategories ?? (evaluatesCandidate ? inventory.categories.map((categoryEvidence) => ({
      category: categoryEvidence.category as MarketplaceCategory,
      evidence: evidence(
        "derived",
        "marketplace-inventory",
        fetchedAt,
        false,
        `${categoryEvidence.signal} Candidate mapping is not proof of operational capability.`,
      ),
    })) : []),
    services: data.services,
    endpoints: data.endpoints,
    tools: data.tools,
    capabilities: data.capabilities,
    endpointObservation: catalogObservation ?? data.endpointObservation,
    reputation: data.reputation,
    trustScore: data.trustScore,
    hireability: catalogHire ?? (evaluatesCandidate
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
      }),
    freshness: data.freshness,
    verification: data.verification ? {
      ...data.verification,
      identity: {
        ...data.verification.identity,
        provenance: data.verification.identity.provenance,
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
        catalog ? "marketplace-readiness" : trustSource,
        catalogObservation?.lastTestedAt ?? data.endpointObservation.lastTestedAt ?? fetchedAt,
        catalogObservation ? catalogObservation.status !== "not_observed" : data.endpointObservation.status !== "not_observed",
        catalogObservation
          ? catalogObservation.status === "not_observed"
            ? "No platform observation is available in the normalized Worker ledger."
            : "Latest platform endpoint observation from the normalized Worker ledger."
          : data.endpointObservation.status === "not_observed"
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
