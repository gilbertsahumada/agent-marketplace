import { Trust8004Provider } from "./provider.ts";
import { MARKETPLACE_INVENTORY, marketplaceInventoryEntries } from "../data/inventory/marketplace-inventory.ts";
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
  /** Every configured marketplace-operated seller; supersedes the single Grid ID when present. */
  marketplaceOperatedAgentIds?: readonly string[];
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
  const operatedSource = options.marketplaceOperatedAgentIds
    ?? (options.marketplaceOperatedGridSellerAgentId ? [options.marketplaceOperatedGridSellerAgentId] : []);
  const marketplaceOperatedAgentIds = [...new Set(operatedSource.map(normalizedAgentId))].filter((agentId) => !curatedSet.has(agentId));
  // Category membership of an operated seller comes from the inventory entry
  // built for it (its slug decides the category), never from the Grid default.
  const operatedCategories = new Map<string, MarketplaceCategory[]>();
  for (const entry of marketplaceInventoryEntries()) {
    if (entry.operator === "marketplace") operatedCategories.set(entry.agentId, entry.categories.map(({ category }) => category));
  }
  for (const agentId of marketplaceOperatedAgentIds) {
    if (!operatedCategories.has(agentId) && agentId === options.marketplaceOperatedGridSellerAgentId) operatedCategories.set(agentId, ["grid_trading"]);
  }
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
      const operatedHere = marketplaceOperatedAgentIds.filter((agentId) => (operatedCategories.get(agentId) ?? []).includes(category));
      const matchingIds = operatedHere.length > 0
        ? (category === "grid_trading" ? operatedHere : [...source.agentIds, ...operatedHere])
        : [...source.agentIds];
      return [category, {
        status: matchingIds.length > 0 ? "candidates" : source.status,
        agentIds: matchingIds,
        note: operatedHere.length > 0
          ? `${operatedHere.length === 1 ? "One" : operatedHere.length} marketplace-operated deterministic seller${operatedHere.length === 1 ? " is" : "s are"} explicitly configured; qualification remains evidence-gated.`
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
