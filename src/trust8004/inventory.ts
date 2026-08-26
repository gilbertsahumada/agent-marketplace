import { Trust8004Provider } from "./provider.ts";
import { MARKETPLACE_INVENTORY } from "../data/inventory/marketplace-inventory.ts";
import {
  BSC_MAINNET_CHAIN_ID,
  CATALOG_COVERAGE,
  type BscCandidateInventory,
  type MarketplaceAgent,
  type MarketplaceCategory,
} from "./types.ts";

export const KNOWN_HEYANON_AGENT_IDS = MARKETPLACE_INVENTORY.entries.map((entry) => entry.agentId);
export const MAX_EXPLICIT_QUALIFICATION_AGENT_IDS = 20;

export interface BuildBscCandidateInventoryOptions {
  additionalAgentIds?: readonly string[];
  marketplaceOperatedGridSellerAgentId?: string;
}

export const MAX_UINT256_AGENT_ID = (1n << 256n) - 1n;

function normalizedAgentId(agentId: string): string {
  if (!/^\d+$/.test(agentId)) throw new Error(`agentId must be numeric: ${agentId}`);
  const value = BigInt(agentId);
  if (value > MAX_UINT256_AGENT_ID) throw new Error(`agentId exceeds uint256: ${agentId}`);
  return value.toString();
}

export async function buildBscCandidateInventory(
  provider: Trust8004Provider,
  now: () => number = Date.now,
  options: BuildBscCandidateInventoryOptions = {},
): Promise<BscCandidateInventory> {
  const requestedExplicitIds = options.additionalAgentIds ?? [];
  const curatedAgentIds = [...KNOWN_HEYANON_AGENT_IDS];
  const curatedSet = new Set<string>(curatedAgentIds);
  const marketplaceOperatedAgentIds = options.marketplaceOperatedGridSellerAgentId
    ? [normalizedAgentId(options.marketplaceOperatedGridSellerAgentId)].filter((agentId) => !curatedSet.has(agentId))
    : [];
  const operatedSet = new Set(marketplaceOperatedAgentIds);
  const explicitAgentIds = [...new Set(requestedExplicitIds.map(normalizedAgentId))]
    .filter((agentId) => !curatedSet.has(agentId) && !operatedSet.has(agentId));
  if (explicitAgentIds.length > MAX_EXPLICIT_QUALIFICATION_AGENT_IDS) {
    throw new Error(`At most ${MAX_EXPLICIT_QUALIFICATION_AGENT_IDS} explicit agent IDs may be evaluated`);
  }
  const agentIds = [...curatedAgentIds, ...marketplaceOperatedAgentIds, ...explicitAgentIds];
  const explicitSet = new Set(explicitAgentIds);
  const agents: MarketplaceAgent[] = [];

  // Keep profile reads sequential and bounded; never scan or classify the global catalogue here.
  for (const agentId of agentIds) {
    const agent = await provider.getAgent(agentId);
    agents.push(explicitSet.has(agentId) ? { ...agent, categories: [] } : agent);
  }

  const categories = Object.fromEntries(
    (Object.keys(MARKETPLACE_INVENTORY.categories) as MarketplaceCategory[]).map((category) => {
      const source = MARKETPLACE_INVENTORY.categories[category];
      const matchingIds = category === "grid_trading" && marketplaceOperatedAgentIds.length > 0
        ? marketplaceOperatedAgentIds
        : [...source.agentIds];
      return [category, {
        status: matchingIds.length > 0 ? "candidates" : source.status,
        agentIds: matchingIds,
        note: category === "grid_trading" && marketplaceOperatedAgentIds.length > 0
          ? "One marketplace-operated deterministic Grid seller is explicitly configured; qualification remains evidence-gated."
          : source.evidence,
      }];
    }),
  ) as BscCandidateInventory["categories"];

  return {
    schemaVersion: 2,
    generatedAt: new Date(now()).toISOString(),
    chainId: BSC_MAINNET_CHAIN_ID,
    selection: { curatedAgentIds, marketplaceOperatedAgentIds, explicitAgentIds, evaluatedAgentIds: agentIds },
    source: {
      name: "trust8004",
      baseUrl: provider.baseUrl,
      catalogCoverage: CATALOG_COVERAGE,
      note: "Partial trust8004 snapshot. Only curated and explicitly supplied IDs were evaluated; no global classification was performed.",
    },
    categories,
    agents,
  };
}
