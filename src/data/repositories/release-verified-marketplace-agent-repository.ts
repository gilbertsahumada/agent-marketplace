import type { PublicAgentVerification } from "../../business/entities/public-verification-snapshot.ts";
import type { PublicVerificationRepository } from "./public-verification-repository.ts";
import type {
  MarketplaceAgentData,
  MarketplaceAgentDataPage,
  MarketplaceAgentRepository,
  MarketplaceDataSort,
  OnchainIdentityData,
} from "./marketplace-agent-repository.ts";

function attachedVerification(
  agent: PublicAgentVerification,
  snapshot: ReturnType<PublicVerificationRepository["getSnapshot"]>,
  now: number,
): NonNullable<MarketplaceAgentData["verification"]> {
  const freshness = Date.parse(snapshot.generatedAt) <= now + 5 * 60_000
    && now <= Date.parse(snapshot.staleAfter)
    ? "current" as const
    : "stale" as const;
  return {
    freshness,
    generatedAt: snapshot.generatedAt,
    staleAfter: snapshot.staleAfter,
    blockNumber: snapshot.blockNumber,
    selection: agent.selection,
    operator: agent.operator,
    qualification: agent.qualification,
    identity: agent.identity,
    tools: agent.tools,
  };
}

export class ReleaseVerifiedMarketplaceAgentRepository implements MarketplaceAgentRepository {
  constructor(
    private readonly source: MarketplaceAgentRepository,
    private readonly verification: PublicVerificationRepository,
    private readonly now: () => number = Date.now,
  ) {}

  private attach(record: MarketplaceAgentData | null): MarketplaceAgentData | null {
    if (!record) return null;
    const snapshot = this.verification.getSnapshot();
    const evidence = snapshot.agents.find(({ agentId }) => agentId === record.agentId);
    return evidence ? {
      ...record,
      verification: attachedVerification(evidence, snapshot, this.now()),
    } : record;
  }

  async listRegisteredPage(options: {
    page: number;
    limit: number;
    q?: string;
    sort?: MarketplaceDataSort;
  }): Promise<MarketplaceAgentDataPage> {
    const page = await this.source.listRegisteredPage(options);
    return { ...page, items: page.items.map((record) => this.attach(record)!) };
  }

  async getById(agentId: string): Promise<MarketplaceAgentData | null> {
    return this.attach(await this.source.getById(agentId));
  }

  getOnchainIdentity(agentId: string): Promise<OnchainIdentityData> {
    return this.source.getOnchainIdentity(agentId);
  }
}
