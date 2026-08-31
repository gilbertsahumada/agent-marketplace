import type { AgentValidationEvidence, AgentValidationReport } from "../entities/agent-validation.ts";
import type { HireabilityStatus } from "../entities/marketplace-agent.ts";
import {
  InvalidMarketplaceInputError,
  MarketplaceAgentNotFoundError,
  MarketplaceDataUnavailableError,
  MarketplaceRateLimitError,
} from "../errors/marketplace-errors.ts";
import { buildEvidencePassport } from "../policies/evidence-passport-policy.ts";

export interface AgentValidationRepository {
  validate(agentId: string): Promise<AgentValidationEvidence | null>;
}

function endpointStatus(evidence: AgentValidationEvidence): "verified" | "failed" | "not_probed" {
  if (evidence.endpointChecks.some(({ status }) => status === "verified")) return "verified";
  if (evidence.endpointChecks.some(({ status }) => status === "failed")) return "failed";
  return "not_probed";
}

function unpromotedHireabilityStatus(evidence: AgentValidationEvidence): HireabilityStatus {
  if (evidence.quote.status === "verified") return "quote_verified";
  if (evidence.endpointChecks.some(({ protocol }) => protocol === "a2a" || protocol === "erc8183_http")) {
    return "protocol_discovered";
  }
  if (evidence.endpointChecks.some(({ protocol }) => protocol === "mcp")) return "mcp_only";
  return "no_transport_declared";
}

export class ValidateMarketplaceAgent {
  constructor(
    private readonly repository: AgentValidationRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(input: { agentId: string }): Promise<AgentValidationReport> {
    if (!/^\d+$/.test(input.agentId)) throw new InvalidMarketplaceInputError("agentId must be numeric");
    let evidence: AgentValidationEvidence | null;
    try {
      evidence = await this.repository.validate(input.agentId);
    } catch (error) {
      if (error instanceof MarketplaceRateLimitError) throw error;
      throw new MarketplaceDataUnavailableError("validate agent", { cause: error });
    }
    if (!evidence) throw new MarketplaceAgentNotFoundError(input.agentId);

    const endpoint = endpointStatus(evidence);
    const quoteVerifiedCandidate = evidence.identity.status === "match" && evidence.quote.status === "verified";
    const status = evidence.identity.status === "match" && endpoint === "verified"
      ? "complete" as const
      : "attention_required" as const;
    const generatedAt = new Date(this.now()).toISOString();
    const passport = buildEvidencePassport({
      chainId: evidence.chainId,
      agentId: evidence.agent.agentId,
      name: evidence.agent.name,
      operator: evidence.agent.operator,
      indexedAt: evidence.agent.indexedAt,
      onchainIdentity: {
        status: evidence.identity.status === "read_error" ? "unavailable" : evidence.identity.status,
        observedAt: evidence.identity.observedAt,
        blockNumber: evidence.identity.blockNumber,
      },
      verification: {
        freshness: "current",
        identityStatus: evidence.identity.status,
        endpointStatus: endpoint,
        observedAt: evidence.endpointChecks.find(({ observedAt }) => observedAt !== null)?.observedAt
          ?? evidence.generatedAt,
        staleAfter: new Date(Date.parse(evidence.generatedAt) + 15 * 60 * 1_000).toISOString(),
      },
      hireability: {
        canHire: false,
        status: unpromotedHireabilityStatus(evidence),
        observedAt: evidence.quote.observedAt ?? evidence.generatedAt,
      },
      jobProofs: [],
      generatedAt,
    });

    return {
      schemaVersion: 1,
      chainId: 56,
      status,
      generatedAt,
      agent: evidence.agent,
      classification: {
        status: "not_assigned",
        categories: [],
        note: "Validation does not assign marketplace categories.",
      },
      promotion: {
        status: "manual_review_required",
        note: "Validation evidence never promotes an agent into the curated marketplace automatically.",
      },
      qualification: {
        status: quoteVerifiedCandidate ? "quote_verified_candidate" : "not_qualified",
        canHire: false,
        note: quoteVerifiedCandidate
          ? "The ad-hoc quote passed validation, but Hire remains disabled until the observation Worker records current evidence; Hire will still request a fresh quote."
          : "No matching direct identity plus current verified ERC-8183 quote was established.",
      },
      evidence: {
        identity: evidence.identity,
        endpointChecks: evidence.endpointChecks,
        quote: evidence.quote,
        observationSync: evidence.observationSync,
      },
      passport,
    };
  }
}
