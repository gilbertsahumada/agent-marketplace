import type { AgentEvidencePassport } from "../entities/evidence-passport.ts";
import {
  isCatalogOperationalDeclaration,
  isCatalogOperationalObservation,
  isCatalogSellerDeclaration,
  type CatalogCandidate,
  type CatalogCandidateObservation,
} from "../entities/catalog-candidate.ts";
import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";
import type { MainnetJobProof } from "../entities/mainnet-job-proof.ts";
import type { VerifiedHireEvent, VerifiedHireEventReader } from "../entities/verified-hire-event.ts";
import { buildEvidencePassport } from "../policies/evidence-passport-policy.ts";

export interface MarketplaceAgentReader {
  execute(input: { agentId: string }): Promise<MarketplaceAgent>;
}

export interface MainnetJobProofReader {
  listByAgentId(agentId: string): MainnetJobProof[];
}

export interface CatalogCandidateReader {
  execute(input: { agentId: string }): Promise<CatalogCandidate | null>;
}

// Chain reads prove on-chain identity/job state, not endpoint reachability.
// Keep only observations produced by an HTTP/MCP/ERC-8183 platform probe (plus
// the legacy marketplace probe during the compatibility window).
const PLATFORM_SOURCES = new Set(["marketplace_probe", "worker_probe", "buyer_refresh", "migration"]);
const FAILURE_OUTCOMES = new Set([
  "http_error", "timeout", "network_error", "invalid_response", "unsafe_url", "quote_rejected", "unreachable", "error",
]);

function newestPlatformObservation(candidate: CatalogCandidate): CatalogCandidateObservation[] {
  const observations = candidate.observations
    .filter((observation) => PLATFORM_SOURCES.has(observation.source)
      && (observation.validationKind === undefined
        || observation.validationKind === "reachability"
        || observation.validationKind === "protocol")
      && isCatalogOperationalObservation(candidate, observation))
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id);
  const admittedEndpointKey = candidate.admission?.endpointKey;
  if (admittedEndpointKey === null || admittedEndpointKey === undefined) return observations;
  const scoped = observations.filter((observation) => observation.endpointKey === admittedEndpointKey);
  return scoped.length > 0 ? scoped : observations;
}

function newestQuoteObservation(candidate: CatalogCandidate | null): CatalogCandidateObservation | undefined {
  const quotes = candidate?.observations
    .filter((observation) => (observation.validationKind === "quote"
      && observation.verificationLevel === "cryptographic")
      || (observation.validationKind === undefined
        && PLATFORM_SOURCES.has(observation.source)
        && (observation.outcome === "quote_verified" || observation.outcome === "quote_rejected")))
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id)[0];
  if (!candidate || !quotes) return quotes;
  const admittedEndpointKey = candidate.admission?.endpointKey;
  if (admittedEndpointKey === null || admittedEndpointKey === undefined) return quotes;
  const scoped = candidate.observations
    .filter((observation) => (observation.validationKind === "quote"
      && observation.verificationLevel === "cryptographic")
      || (observation.validationKind === undefined
        && PLATFORM_SOURCES.has(observation.source)
        && (observation.outcome === "quote_verified" || observation.outcome === "quote_rejected")))
    .filter((observation) => observation.endpointKey === admittedEndpointKey)
    .sort((left, right) => right.observedAt - left.observedAt || right.id - left.id)[0];
  return scoped ?? quotes;
}

export class GetAgentEvidencePassport {
  constructor(
    private readonly getAgent: MarketplaceAgentReader,
    private readonly jobProofs: MainnetJobProofReader,
    private readonly now: () => number = Date.now,
    private readonly catalogCandidates?: CatalogCandidateReader,
    private readonly hireEvents?: VerifiedHireEventReader,
  ) {}

  async execute(input: { agentId: string }): Promise<AgentEvidencePassport> {
    const [agent, catalogCandidate, hireEvents] = await Promise.all([
      this.getAgent.execute(input),
      this.catalogCandidates?.execute(input) ?? Promise.resolve(null),
      this.readHireEvents(input.agentId),
    ]);
    return this.build(agent, catalogCandidate, this.jobProofs.listByAgentId(agent.agentId), hireEvents);
  }

  async executeWithAgent(input: { agentId: string }): Promise<{
    agent: MarketplaceAgent;
    passport: AgentEvidencePassport;
    catalogCandidate: CatalogCandidate | null;
    jobProofs: MainnetJobProof[];
  }> {
    const [agent, catalogCandidate, hireEvents] = await Promise.all([
      this.getAgent.execute(input),
      this.catalogCandidates?.execute(input) ?? Promise.resolve(null),
      this.readHireEvents(input.agentId),
    ]);
    const jobProofs = this.jobProofs.listByAgentId(agent.agentId);
    return {
      agent,
      passport: this.build(agent, catalogCandidate, jobProofs, hireEvents),
      catalogCandidate,
      jobProofs,
    };
  }

  // The feed fails closed to null; an absent feed is "no verified activity",
  // never an error that hides the rest of the Passport.
  private async readHireEvents(agentId: string): Promise<VerifiedHireEvent[]> {
    if (!this.hireEvents) return [];
    try {
      return await this.hireEvents.listByAgent({ chainId: 56, agentId }) ?? [];
    } catch {
      return [];
    }
  }

  private build(
    agent: MarketplaceAgent,
    catalogCandidate: CatalogCandidate | null,
    jobProofs: MainnetJobProof[],
    hireEvents: VerifiedHireEvent[],
  ): AgentEvidencePassport {
    const now = this.now();
    const platform = catalogCandidate ? newestPlatformObservation(catalogCandidate) : [];
    const quote = newestQuoteObservation(catalogCandidate);
    const latestEndpoint = platform.find(({ outcome }) => outcome === "protocol_valid"
      || outcome === "quote_verified" || FAILURE_OUTCOMES.has(outcome));
    const endpointExpiresAt = latestEndpoint?.expiresAt ?? null;
    const endpointIsFresh = latestEndpoint !== undefined
      && endpointExpiresAt !== null && endpointExpiresAt > now;
    const endpointFailed = latestEndpoint !== undefined && FAILURE_OUTCOMES.has(latestEndpoint.outcome);
    const quoteIsFresh = quote !== undefined && quote.expiresAt !== null && quote.expiresAt > now;
    const compatibleDeclaration = catalogCandidate?.declarations.some(isCatalogSellerDeclaration) ?? false;
    // The normalized v2 state is the commerce authority.  Keep this fail-closed
    // during the compatibility window instead of promoting the legacy flag.
    // `canHire` means an admitted executable seller can negotiate a fresh
    // quote.  `canPrepareHire` remains the stricter transaction-preview gate.
    const canHire = catalogCandidate?.state?.commerceStatus === "admitted"
      && catalogCandidate.state.canRequestQuote
      && compatibleDeclaration;
    const hireabilityStatus = quoteIsFresh
      ? "quote_verified" as const
      : quote
        ? "quote_stale" as const
        : compatibleDeclaration
          ? "protocol_discovered" as const
          : catalogCandidate?.declarations.some((declaration) => isCatalogOperationalDeclaration(declaration)
            && (declaration.validationProtocol ?? declaration.protocol) === "mcp")
            ? "mcp_only" as const
            : "not_evaluated" as const;
    const observedAt = latestEndpoint ? new Date(latestEndpoint.observedAt).toISOString() : null;

    return buildEvidencePassport({
      chainId: agent.chainId,
      agentId: agent.agentId,
      name: agent.name,
      operator: agent.operator,
      indexedAt: agent.freshness.fetchedAt,
      onchainIdentity: {
        status: agent.onchainIdentity.status,
        observedAt: agent.onchainIdentity.observedAt,
        blockNumber: agent.onchainIdentity.blockNumber,
      },
      verification: latestEndpoint ? {
        freshness: endpointIsFresh || endpointFailed ? "current" : "stale",
        identityStatus: agent.onchainIdentity.status === "match" ? "match"
          : agent.onchainIdentity.status === "mismatch" ? "mismatch" : "read_error",
        endpointStatus: endpointIsFresh ? "verified" : endpointFailed ? "failed" : "not_probed",
        observedAt: observedAt!,
        staleAfter: new Date(endpointExpiresAt ?? latestEndpoint.observedAt + 15 * 60_000).toISOString(),
      } : null,
      hireability: {
        canHire,
        status: hireabilityStatus,
        observedAt: quote ? new Date(quote.observedAt).toISOString() : observedAt,
      },
      jobProofs,
      hireEvents,
      generatedAt: new Date(now).toISOString(),
    });
  }
}
