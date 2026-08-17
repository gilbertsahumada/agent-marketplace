import { KNOWN_HEYANON_AGENT_IDS, buildBscCandidateInventory } from "../trust8004/inventory.js";
import type { Trust8004Provider } from "../trust8004/provider.js";
import type { MarketplaceAgent, MarketplaceCategory } from "../trust8004/types.js";
import { verifyMcpEndpoint, type McpVerifierOptions } from "../verification/mcp.js";
import type { BscIdentityReader } from "../verification/onchain.js";
import { buildBscVerificationReport } from "../verification/report.js";
import type { IdentityVerification } from "../verification/types.js";
import type { Gate1ProofReader } from "./gate1.js";
import { verifyGate1Proof } from "./gate1.js";
import { createHireabilityAssessor } from "./protocols.js";
import type {
  BscMarketplaceReadinessReport,
  HireabilityAssessment,
  ReadinessCandidate,
} from "./types.js";

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
  now?: () => number;
}

export async function buildBscMarketplaceReadinessReport(
  options: BuildReadinessReportOptions,
): Promise<BscMarketplaceReadinessReport> {
  const now = options.now ?? Date.now;
  const inventory = await buildBscCandidateInventory(options.provider, now);
  const verification = await buildBscVerificationReport({
    provider: options.provider,
    identityReader: options.identityReader,
    ...(options.verifyMcp ? { verifyMcp: options.verifyMcp } : {}),
    ...(options.mcpOptions ? { mcpOptions: options.mcpOptions } : {}),
    now,
  });
  const assessHireability = options.assessHireability ?? createHireabilityAssessor();
  const candidates: ReadinessCandidate[] = [];

  for (const agent of inventory.agents) {
    const identity = verification.agents.find((entry) => entry.agentId === agent.agentId)?.identity;
    if (!identity) throw new Error(`Verification result missing for agent ${agent.agentId}`);
    candidates.push({ ...agent, activation: await assessHireability(agent, identity) });
  }

  const buyerProof = await verifyGate1Proof(options.gate1Reader, now);
  const categories = Object.fromEntries(
    (Object.keys(inventory.categories) as MarketplaceCategory[]).map((category) => {
      const source = inventory.categories[category];
      const quoteVerifiedAgentIds = candidates
        .filter((agent) =>
          agent.activation.hireability === "quote_verified"
          && agent.categories.some((entry) => entry.category === category))
        .map((agent) => agent.agentId);
      return [category, { ...source, quoteVerifiedAgentIds }];
    }),
  ) as BscMarketplaceReadinessReport["categories"];
  const quoteVerifiedAgents = candidates.filter(
    (agent) => agent.activation.hireability === "quote_verified",
  ).length;
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

  return {
    schemaVersion: 1,
    generatedAt: new Date(now()).toISOString(),
    catalog: { chainId: 56, source: "trust8004", coverage: "partial" },
    verification,
    categories,
    candidates,
    activationCoverage: {
      status: quoteVerifiedCategories === 0
        ? "none"
        : quoteVerifiedCategories === 4
          ? "complete"
          : "partial",
      quoteVerifiedAgents,
      quoteVerifiedCategories,
      requiredCategories: 4,
    },
    buyerProof,
    frontendReady: blockers.length === 0,
    blockers,
    warnings,
  };
}
