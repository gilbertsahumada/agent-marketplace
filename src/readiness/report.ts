import { KNOWN_HEYANON_AGENT_IDS, buildBscCandidateInventory } from "../trust8004/inventory.ts";
import type { Trust8004Provider } from "../trust8004/provider.ts";
import type { MarketplaceAgent, MarketplaceCategory } from "../trust8004/types.ts";
import { verifyMcpEndpoint, type McpVerifierOptions } from "../verification/mcp.ts";
import type { BscIdentityReader } from "../verification/onchain.ts";
import { buildBscVerificationReport } from "../verification/report.ts";
import type { IdentityVerification } from "../verification/types.ts";
import type { Gate1ProofReader } from "./gate1.ts";
import { verifyGate1Proof } from "./gate1.ts";
import { createProbeBudget } from "../verification/probe-budget.ts";
import { createHireabilityAssessor, finalizeHireabilityAssessment } from "./protocols.ts";
import type {
  BscMarketplaceReadinessReport,
  HireabilityAssessment,
  ReadinessCandidate,
} from "./types.ts";

export interface BuildReadinessReportOptions {
  provider: Trust8004Provider;
  identityReader: BscIdentityReader;
  gate1Reader: Gate1ProofReader;
  verifyMcp?: typeof verifyMcpEndpoint;
  mcpOptions?: McpVerifierOptions;
  assessHireability?: (
    agent: MarketplaceAgent,
    identity: IdentityVerification,
  ) => Promise<HireabilityAssessment>;
  additionalAgentIds?: readonly string[];
  marketplaceOperatedGridSellerAgentId?: string;
  now?: () => number;
}

function curatedCategories(
  inventory: Awaited<ReturnType<typeof buildBscCandidateInventory>>,
  agentId: string,
) {
  return (Object.keys(inventory.categories) as MarketplaceCategory[])
    .filter((category) => inventory.categories[category].agentIds.includes(agentId));
}

function qualification(
  activation: HireabilityAssessment,
  identity: IdentityVerification,
): ReadinessCandidate["qualification"] {
  const observedAt = activation.protocols
    .map((protocol) => protocol.quote?.observedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? identity.observedAt;
  const reasons: ReadinessCandidate["qualification"]["reasons"] = [];
  if (identity.status === "read_error") reasons.push("IDENTITY_UNAVAILABLE");
  else if (identity.status !== "match") reasons.push("IDENTITY_NOT_VERIFIED");
  if (identity.walletAttribution?.status === "ambiguous") reasons.push("WALLET_AMBIGUOUS");
  if (activation.declaredSellerProtocols.length === 0) reasons.push("SELLER_PROTOCOL_NOT_DECLARED");
  else if (activation.hireability === "unreachable") reasons.push("SELLER_PROTOCOL_UNAVAILABLE");
  else if (activation.hireability === "probe_incomplete") reasons.push("SELLER_PROBE_INCOMPLETE");
  if (activation.quoteStatus === "expired") reasons.push("QUOTE_EXPIRED");
  else if (activation.quoteStatus !== "verified") reasons.push("QUOTE_NOT_VERIFIED");
  return {
    status: identity.status === "read_error"
      || activation.hireability === "unreachable"
      || activation.hireability === "probe_incomplete"
      ? "unavailable"
      : reasons.length === 0
        ? "qualified"
        : "not_qualified",
    observedAt,
    reasons,
    provenance: "derived:marketplace-seller-qualification",
  };
}

export async function buildBscMarketplaceReadinessReport(
  options: BuildReadinessReportOptions,
): Promise<BscMarketplaceReadinessReport> {
  const now = options.now ?? Date.now;
  const inventory = await buildBscCandidateInventory(options.provider, now, {
    ...(options.additionalAgentIds ? { additionalAgentIds: options.additionalAgentIds } : {}),
    ...(options.marketplaceOperatedGridSellerAgentId ? { marketplaceOperatedGridSellerAgentId: options.marketplaceOperatedGridSellerAgentId } : {}),
  });
  const probeBudget = createProbeBudget({
    maxMcpEndpoints: 24,
    maxSellerEndpoints: 48,
    maxTotalEndpoints: 72,
    maxTotalDurationMs: 180_000,
    ...(options.mcpOptions?.monotonicNow ? { monotonicNow: options.mcpOptions.monotonicNow } : {}),
  });
  const verification = await buildBscVerificationReport({
    provider: options.provider,
    identityReader: options.identityReader,
    inventory,
    ...(options.verifyMcp ? { verifyMcp: options.verifyMcp } : {}),
    ...(options.mcpOptions ? { mcpOptions: options.mcpOptions } : {}),
    probeBudget,
    now,
  });
  const assessHireability = options.assessHireability ?? createHireabilityAssessor({
    probeBudget,
    ...(inventory.selection.marketplaceOperatedAgentIds[0]
      ? { marketplaceOperatedGridSellerAgentId: inventory.selection.marketplaceOperatedAgentIds[0] }
      : {}),
  });
  let candidates: ReadinessCandidate[] = [];

  for (const agent of inventory.agents) {
    const identity = verification.agents.find((entry) => entry.agentId === agent.agentId)?.identity;
    if (!identity) throw new Error(`Verification result missing for agent ${agent.agentId}`);
    const activation = await assessHireability(agent, identity);
    const categories = curatedCategories(inventory, agent.agentId);
    candidates.push({
      ...agent,
      categories,
      profileDerivedCategories: agent.categories,
      activation,
      selection: inventory.selection.marketplaceOperatedAgentIds.includes(agent.agentId)
        ? "marketplace_operated"
        : inventory.selection.explicitAgentIds.includes(agent.agentId)
          ? "operator_explicit"
          : "curated",
      qualification: qualification(activation, identity),
    });
  }

  const buyerProof = await verifyGate1Proof(options.gate1Reader, now);
  const finalizedAtMs = now();
  const finalizedAtSeconds = Math.floor(finalizedAtMs / 1_000);
  candidates = candidates.map((candidate) => {
    const activation = finalizeHireabilityAssessment(candidate.activation, finalizedAtSeconds);
    const identity = verification.agents.find((entry) => entry.agentId === candidate.agentId)?.identity;
    if (!identity) throw new Error(`Verification result missing for agent ${candidate.agentId}`);
    return { ...candidate, activation, qualification: qualification(activation, identity) };
  });
  const categories = Object.fromEntries(
    (Object.keys(inventory.categories) as MarketplaceCategory[]).map((category) => {
      const source = inventory.categories[category];
      const quoteVerifiedAgentIds = candidates
        .filter((agent) =>
          agent.activation.hireability === "quote_verified"
          && agent.categories.includes(category))
        .map((agent) => agent.agentId);
      const qualifiedAgentIds = candidates
        .filter((agent) =>
          agent.qualification.status === "qualified"
          && agent.categories.includes(category))
        .map((agent) => agent.agentId);
      return [category, { ...source, quoteVerifiedAgentIds, qualifiedAgentIds }];
    }),
  ) as BscMarketplaceReadinessReport["categories"];
  const quoteVerifiedAgentIds = candidates.filter(
    (agent) => agent.activation.hireability === "quote_verified",
  ).map((agent) => agent.agentId);
  const qualifiedSellerAgentIds = candidates.filter(
    (agent) => agent.qualification.status === "qualified",
  ).map((agent) => agent.agentId);
  const qualifiedCuratedAgentIds = candidates.filter(
    (agent) => agent.qualification.status === "qualified" && agent.selection === "curated",
  ).map((agent) => agent.agentId);
  const quoteVerifiedCategories = Object.values(categories).filter(
    (category) => category.quoteVerifiedAgentIds.length > 0,
  ).length;
  const knownAgentsPresent = KNOWN_HEYANON_AGENT_IDS.every((agentId) =>
    candidates.some((candidate) => candidate.agentId === agentId));
  const identityReadsComplete = verification.agents.every(
    (agent) => agent.identity.status !== "read_error",
  );
  const blockers: string[] = [];
  if (!knownAgentsPresent) blockers.push("The four known HeyAnon candidates are not all present.");
  if (!identityReadsComplete) blockers.push("One or more direct BSC identity reads failed.");
  if (buyerProof.status !== "verified") blockers.push("Gate 1 onchain proof is not verified.");
  const warnings: string[] = [];
  if (verification.summary.status === "attention_required") {
    warnings.push("Candidate verification contains identity, endpoint, or tool drift requiring attention.");
  }
  if (quoteVerifiedCategories < 4) {
    warnings.push("Real-agent ERC-8183 activation coverage is incomplete.");
  }
  if (categories.grid_trading.status === "unverified") {
    warnings.push("Grid Trading remains explicitly empty/unverified.");
  }
  if (candidates.some((agent) => agent.activation.probe.truncated)) {
    warnings.push("One or more seller protocol probes were truncated by the bounded execution policy.");
  }
  const qualificationNeedsAttention = candidates.some((agent) =>
    agent.qualification.status === "unavailable"
    || agent.activation.probe.truncated
    || (agent.activation.declaredSellerProtocols.length > 0
      && (agent.activation.hireability === "invalid_quote"
        || agent.activation.hireability === "expired_quote")),
  ) || verification.agents.some((agent) => agent.identity.status === "mismatch");
  const sellerQualification = {
    status: qualifiedSellerAgentIds.length > 0
      ? "passed" as const
      : qualificationNeedsAttention
        ? "attention_required" as const
        : "pending_no_qualified_seller" as const,
    qualifiedAgentIds: qualifiedSellerAgentIds,
    note: qualifiedSellerAgentIds.length > 0
      ? "At least one seller has matching direct identity and a currently valid signed ERC-8183 quote. Promotion remains manual."
      : "No seller currently has both matching direct identity and a valid signed ERC-8183 quote.",
  };

  return {
    schemaVersion: 3,
    generatedAt: new Date(finalizedAtMs).toISOString(),
    catalog: { chainId: 56, source: "trust8004", coverage: "partial" },
    verification,
    selection: inventory.selection,
    categories,
    candidates,
    activationCoverage: {
      status: quoteVerifiedCategories === 0
        ? "none"
        : quoteVerifiedCategories === 4
          ? "complete"
          : "partial",
      quoteVerifiedAgents: quoteVerifiedAgentIds.length,
      quoteVerifiedAgentIds,
      qualifiedSellerAgentIds,
      qualifiedCuratedAgentIds,
      quoteVerifiedCategories,
      requiredCategories: 4,
    },
    sellerQualification,
    buyerProof,
    frontendReady: blockers.length === 0,
    blockers,
    warnings,
  };
}
