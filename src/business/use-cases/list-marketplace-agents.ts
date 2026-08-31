import { marketplaceInventoryEntries } from "../../data/inventory/marketplace-inventory.ts";
import {
  DEFAULT_REGISTERED_AGENT_SORT,
  MARKETPLACE_DATA_SORTS,
  type MarketplaceAgentRepository,
  type MarketplaceDataSort,
} from "../../data/repositories/marketplace-agent-repository.ts";
import { InvalidMarketplaceInputError, MarketplaceDataUnavailableError } from "../errors/marketplace-errors.ts";
import {
  MARKETPLACE_CATEGORIES,
  type MarketplaceAgent,
  type MarketplaceAgentPage,
  type MarketplaceCategory,
} from "../entities/marketplace-agent.ts";
import {
  isAdmittedMarketplaceSeller,
  toMarketplaceAgent,
} from "../policies/marketplace-agent-policy.ts";

export { DEFAULT_REGISTERED_AGENT_SORT, MARKETPLACE_DATA_SORTS };
export type MarketplaceSort = MarketplaceDataSort;

export const MARKETPLACE_AVAILABILITIES = ["all", "hireable", "mcp_only"] as const;
export type MarketplaceAvailability = (typeof MARKETPLACE_AVAILABILITIES)[number];

interface BaseListInput {
  q?: string;
  sort?: MarketplaceDataSort;
  page?: number;
  limit?: number;
}

export type ListMarketplaceAgentsInput =
  | (BaseListInput & { view: "all" })
  | (BaseListInput & {
    view: "marketplace";
    category?: MarketplaceCategory;
    availability?: MarketplaceAvailability;
  });

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidMarketplaceInputError(`${name} must be a positive integer`);
  }
  return value;
}

function validateInput(input: ListMarketplaceAgentsInput): { page: number; limit: number; q?: string } {
  const page = positiveInteger(input.page ?? 1, "page");
  const limit = positiveInteger(input.limit ?? 12, "limit");
  if (limit > 24) throw new InvalidMarketplaceInputError("limit must be at most 24");
  const q = input.q?.trim();
  if (q && q.length > 120) throw new InvalidMarketplaceInputError("q must be at most 120 characters");
  return { page, limit, ...(q ? { q } : {}) };
}

function sortAgents(agents: MarketplaceAgent[], sort: MarketplaceDataSort | undefined): void {
  agents.sort((left, right) => {
    if (sort === "agent_id") return BigInt(left.agentId) < BigInt(right.agentId) ? -1 : 1;
    if (sort === "newest") {
      return (right.freshness.indexedUpdatedAt ?? "").localeCompare(left.freshness.indexedUpdatedAt ?? "");
    }
    if (sort === "reputation") {
      return (right.reputation.averageScore ?? -1) - (left.reputation.averageScore ?? -1)
        || right.reputation.totalFeedbacks - left.reputation.totalFeedbacks;
    }
    return (right.trustScore.total ?? -1) - (left.trustScore.total ?? -1);
  });
}

function categorySummaries(agents: MarketplaceAgent[]) {
  return MARKETPLACE_CATEGORIES.map((category) => {
    const count = agents.filter((agent) =>
      agent.categories.some((assignment) => assignment.category === category)).length;
    return { category, count, status: count > 0 ? "candidates" as const : "unverified" as const };
  });
}

export class ListMarketplaceAgents {
  constructor(private readonly repository: MarketplaceAgentRepository) {}

  async execute(input: ListMarketplaceAgentsInput): Promise<MarketplaceAgentPage> {
    const validated = validateInput(input);
    if (input.view === "all") {
      try {
        const source = await this.repository.listRegisteredPage({
          page: validated.page,
          limit: validated.limit,
          ...(validated.q ? { q: validated.q } : {}),
          sort: input.sort ?? DEFAULT_REGISTERED_AGENT_SORT,
        });
        return {
          view: "all",
          items: source.items.map((record) =>
            toMarketplaceAgent(record, { evaluateMarketplace: false })),
          pagination: {
            page: Math.floor(source.offset / source.limit) + 1,
            pageSize: source.limit,
            total: source.total,
            totalPages: source.total === 0 ? 0 : Math.ceil(source.total / source.limit),
          },
          categories: categorySummaries([]),
          catalogCoverage: "partial",
          fetchedAt: source.fetchedAt,
        };
      } catch (error) {
        throw new MarketplaceDataUnavailableError("list registered agents", { cause: error });
      }
    }

    const records = [];
    try {
      for (const entry of marketplaceInventoryEntries()) {
        const record = await this.repository.getById(entry.agentId);
        if (!record) throw new Error(`Curated agent ${entry.agentId} is unavailable`);
        records.push(record);
      }
    } catch (error) {
      throw new MarketplaceDataUnavailableError("list marketplace agents", { cause: error });
    }

    const unique = new Map<string, MarketplaceAgent>();
    for (const record of records) {
      unique.set(record.agentId, toMarketplaceAgent(record, { evaluateMarketplace: true }));
    }
    let agents = [...unique.values()].filter(isAdmittedMarketplaceSeller);
    if (validated.q) {
      const needle = validated.q.toLocaleLowerCase();
      agents = agents.filter((agent) => [
        agent.agentId,
        agent.name,
        agent.description ?? "",
        ...agent.tools,
        ...agent.capabilities,
      ].some((value) => value.toLocaleLowerCase().includes(needle)));
    }
    if (input.availability === "hireable") agents = agents.filter((agent) => agent.hireability.canHire);
    if (input.availability === "mcp_only") {
      agents = agents.filter((agent) => agent.hireability.status === "mcp_only");
    }
    sortAgents(agents, input.sort);
    const categories = categorySummaries(agents);
    if (input.category) {
      agents = agents.filter((agent) =>
        agent.categories.some((assignment) => assignment.category === input.category));
    }

    const total = agents.length;
    const offset = (validated.page - 1) * validated.limit;
    return {
      view: "marketplace",
      items: agents.slice(offset, offset + validated.limit),
      pagination: {
        page: validated.page,
        pageSize: validated.limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / validated.limit),
      },
      categories,
      catalogCoverage: "partial",
      fetchedAt: records.reduce(
        (latest, record) => record.freshness.fetchedAt > latest ? record.freshness.fetchedAt : latest,
        records[0]!.freshness.fetchedAt,
      ),
    };
  }
}
