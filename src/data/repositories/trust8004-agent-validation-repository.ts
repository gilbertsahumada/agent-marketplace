import "server-only";
import type {
  AgentValidationEvidence,
  AgentValidationEndpointCheck,
  AgentValidationObservationSync,
} from "../../business/entities/agent-validation.ts";
import type { AgentValidationRepository } from "../../business/use-cases/validate-marketplace-agent.ts";
import { createHireabilityAssessor } from "../../readiness/protocols.ts";
import type { HireabilityAssessment } from "../../readiness/types.ts";
import { Trust8004Provider } from "../../trust8004/provider.ts";
import type { BscCandidateInventory, MarketplaceAgent } from "../../trust8004/types.ts";
import { buildBscVerificationReport, type BuildVerificationReportOptions } from "../../verification/report.ts";
import { createBscIdentityReader, type BscIdentityReader } from "../../verification/onchain.ts";
import { createProbeBudget } from "../../verification/probe-budget.ts";
import type { BscVerificationReport, IdentityVerification } from "../../verification/types.ts";
import { AsyncTtlCache } from "../cache/async-ttl-cache.ts";

const VALIDATION_TTL_MS = 60 * 1_000;
const VALIDATION_TIMEOUT_MS = 30 * 1_000;
interface ValidationProvider {
  readonly baseUrl?: string;
  getAgent(agentId: string): Promise<MarketplaceAgent>;
}

export interface Trust8004AgentValidationRepositoryOptions {
  provider?: ValidationProvider;
  identityReader?: BscIdentityReader;
  cache?: AsyncTtlCache;
  buildVerificationReport?: (options: BuildVerificationReportOptions) => Promise<BscVerificationReport>;
  assessHireability?: (agent: MarketplaceAgent, identity: IdentityVerification) => Promise<HireabilityAssessment>;
  marketplaceOperatedGridSellerAgentId?: string;
  now?: () => number;
}

const NO_GLOBAL_OBSERVATION_WRITE: AgentValidationObservationSync = {
  status: "not_attempted",
  attempted: 0,
  recorded: 0,
  failed: 0,
  notConfigured: 0,
};

function validationInventory(agent: MarketplaceAgent, generatedAt: string, baseUrl: string): BscCandidateInventory {
  const emptyCategory = () => ({
    status: "unverified" as const,
    agentIds: [] as string[],
    note: "Ad-hoc validation never assigns marketplace categories.",
  });
  const categories: BscCandidateInventory["categories"] = {
    rebalancing: emptyCategory(),
    grid_trading: emptyCategory(),
    yield_optimisation: emptyCategory(),
    health_factor_monitoring: emptyCategory(),
  };
  return {
    schemaVersion: 2,
    generatedAt,
    chainId: 56,
    selection: {
      curatedAgentIds: [],
      marketplaceOperatedAgentIds: [],
      explicitAgentIds: [agent.agentId],
      evaluatedAgentIds: [agent.agentId],
    },
    source: {
      name: "trust8004",
      baseUrl,
      catalogCoverage: "partial",
      note: "One explicitly requested BSC profile; not a complete category inventory.",
    },
    categories,
    agents: [agent],
  };
}

function publicProbeError(
  error: { code: string; message: string } | null,
  protocol: AgentValidationEndpointCheck["protocol"],
): AgentValidationEndpointCheck["error"] {
  if (!error) return null;
  const code = /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : "PROBE_FAILED";
  return {
    code,
    message: protocol === "mcp"
      ? "The declared MCP endpoint did not complete validation."
      : "The declared ERC-8183 seller endpoint did not complete validation.",
  };
}

function publicIdentityError(
  error: IdentityVerification["error"],
): IdentityVerification["error"] {
  if (!error) return null;
  return {
    code: /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : "IDENTITY_READ_FAILED",
    message: "The direct BSC identity read did not complete validation.",
  };
}

function mcpCheck(endpoint: BscVerificationReport["agents"][number]["mcpEndpoints"][number]): AgentValidationEndpointCheck {
  return {
    protocol: "mcp",
    status: endpoint.status === "protocol_valid"
      ? "verified"
      : endpoint.status === "not_probed"
        ? "not_probed"
        : "failed",
    declaredTools: endpoint.declaredTools,
    observedTools: endpoint.observedTools,
    declaredOnlyTools: endpoint.comparison.declaredOnly,
    observedOnlyTools: endpoint.comparison.observedOnly,
    observedAt: endpoint.observedAt,
    error: publicProbeError(endpoint.error, "mcp"),
  };
}

function sellerCheck(protocol: HireabilityAssessment["protocols"][number]): AgentValidationEndpointCheck {
  return {
    protocol: protocol.transport,
    status: protocol.status === "quote_verified" || protocol.status === "protocol_valid"
      ? "verified"
      : protocol.status === "not_probed"
        ? "not_probed"
        : "failed",
    declaredTools: [],
    observedTools: protocol.agentCardSkills ?? [],
    declaredOnlyTools: [],
    observedOnlyTools: [],
    observedAt: protocol.observedAt,
    error: publicProbeError(protocol.error, protocol.transport),
  };
}

function quoteEvidence(activation: HireabilityAssessment): AgentValidationEvidence["quote"] {
  const verified = activation.protocols.find((protocol) => protocol.quoteStatus === "verified" && protocol.quote)?.quote;
  const status = activation.quoteStatus === "not_applicable"
    ? "not_requested"
    : activation.quoteStatus;
  return {
    status,
    provider: verified?.provider ?? null,
    currency: verified?.currency ?? null,
    priceRaw: verified?.price ?? null,
    expiresAt: verified ? new Date(verified.quoteExpiresAt * 1_000).toISOString() : null,
    observedAt: verified?.observedAt ?? null,
  };
}

export class Trust8004AgentValidationRepository implements AgentValidationRepository {
  private readonly provider: ValidationProvider;
  private readonly identityReader: BscIdentityReader;
  private readonly cache: AsyncTtlCache;
  private readonly buildVerificationReport: (options: BuildVerificationReportOptions) => Promise<BscVerificationReport>;
  private readonly assessHireabilityOverride: ((agent: MarketplaceAgent, identity: IdentityVerification) => Promise<HireabilityAssessment>) | undefined;
  private readonly marketplaceOperatedGridSellerAgentId: string | undefined;
  private readonly now: () => number;

  constructor(options: Trust8004AgentValidationRepositoryOptions = {}) {
    this.provider = options.provider ?? new Trust8004Provider();
    this.identityReader = options.identityReader ?? createBscIdentityReader();
    this.cache = options.cache ?? new AsyncTtlCache();
    this.buildVerificationReport = options.buildVerificationReport ?? buildBscVerificationReport;
    this.assessHireabilityOverride = options.assessHireability;
    this.marketplaceOperatedGridSellerAgentId = options.marketplaceOperatedGridSellerAgentId;
    this.now = options.now ?? Date.now;
  }

  validate(agentId: string): Promise<AgentValidationEvidence | null> {
    return this.cache.get(`agent-validation:${agentId}`, VALIDATION_TTL_MS, async () => {
      let agent: MarketplaceAgent;
      try {
        agent = await this.provider.getAgent(agentId);
      } catch (error) {
        if (error && typeof error === "object" && "status" in error && error.status === 404) return null;
        throw error;
      }

      const generatedAt = new Date(this.now()).toISOString();
      const inventory = validationInventory(agent, generatedAt, this.provider.baseUrl ?? "https://trust8004.xyz");
      const probeBudget = createProbeBudget({
        maxMcpEndpoints: 1,
        maxSellerEndpoints: 2,
        maxTotalEndpoints: 3,
        maxTotalDurationMs: VALIDATION_TIMEOUT_MS,
      });
      const verification = await this.buildVerificationReport({
        provider: this.provider as Trust8004Provider,
        identityReader: this.identityReader,
        inventory,
        probeBudget,
        maxMcpEndpointsPerAgent: 1,
        now: this.now,
      });
      const verifiedAgent = verification.agents[0];
      if (!verifiedAgent || verifiedAgent.agentId !== agent.agentId) {
        throw new Error("Ad-hoc verification did not return the requested agent");
      }
      const assessHireability = this.assessHireabilityOverride ?? createHireabilityAssessor({
        probeBudget,
        maxEndpointsPerAgent: 2,
        timeoutMs: 10_000,
        now: this.now,
        ...(this.marketplaceOperatedGridSellerAgentId
          ? { marketplaceOperatedGridSellerAgentId: this.marketplaceOperatedGridSellerAgentId }
          : {}),
      });
      const activation = await assessHireability(agent, verifiedAgent.identity);
      const observationSync = NO_GLOBAL_OBSERVATION_WRITE;
      const identity = verifiedAgent.identity;
      const declaredServices = new Map<string, { name: string; hasEndpoint: boolean; tools: string[] }>();
      for (const service of agent.services) {
        declaredServices.set(`${service.name}:${service.endpoint ?? ""}`, {
          name: service.name,
          hasEndpoint: service.endpoint !== null,
          tools: service.tools,
        });
      }
      for (const endpoint of agent.endpoints) {
        const name = endpoint.name ?? "Endpoint";
        const key = `${name}:${endpoint.endpoint}`;
        if (!declaredServices.has(key)) {
          declaredServices.set(key, { name, hasEndpoint: true, tools: [] });
        }
      }

      return {
        chainId: 56,
        agent: {
          agentId: agent.agentId,
          name: agent.name,
          description: agent.description,
          owner: agent.owner,
          metadataUri: agent.metadataUri,
          operator: this.marketplaceOperatedGridSellerAgentId === agent.agentId ? "marketplace" : "third_party",
          indexedAt: agent.freshness.fetchedAt,
          declaredServices: [...declaredServices.values()],
        },
        identity: {
          status: identity.status,
          ownerMatches: identity.checks.ownerMatches,
          metadataUriMatches: identity.checks.metadataUriMatches,
          agentWallet: identity.onchain.agentWallet,
          registryAddress: identity.onchain.registryAddress,
          blockNumber: identity.onchain.blockNumber,
          observedAt: identity.observedAt,
          error: publicIdentityError(identity.error),
        },
        endpointChecks: [
          ...verifiedAgent.mcpEndpoints.map(mcpCheck),
          ...activation.protocols.map(sellerCheck),
        ],
        quote: quoteEvidence(activation),
        observationSync,
        generatedAt: verification.generatedAt,
      };
    });
  }
}
