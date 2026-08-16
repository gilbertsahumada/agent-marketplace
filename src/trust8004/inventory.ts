import { Trust8004Provider } from "./provider.js";
import {
  BSC_MAINNET_CHAIN_ID,
  CATALOG_COVERAGE,
  type BscCandidateInventory,
  type MarketplaceAgent,
  type MarketplaceCategory,
} from "./types.js";

export const KNOWN_HEYANON_AGENT_IDS = ["45650", "45381", "45422", "43129"] as const;

const CATEGORY_NOTES: Record<MarketplaceCategory, string> = {
  rebalancing: "Candidates inferred from declared metadata and tools; not operationally verified.",
  grid_trading: "No candidate is listed unless declared metadata and tools provide sufficient evidence.",
  yield_optimisation: "Candidates inferred from declared metadata and tools; not operationally verified.",
  health_factor_monitoring: "Candidates inferred from declared metadata and tools; not operationally verified.",
};

function hasPotentialGridEvidence(name: string, description: string | null): boolean {
  return /\bgrid(?: trading)?\b/i.test(`${name} ${description ?? ""}`);
}

export async function buildBscCandidateInventory(
  provider: Trust8004Provider,
  now: () => number = Date.now,
): Promise<BscCandidateInventory> {
  const gridPage = await provider.listAgents({ search: "grid", active: true, limit: 50 });
  const gridAgentIds = gridPage.items
    .filter((agent) =>
      hasPotentialGridEvidence(agent.name, agent.description)
      && Boolean(agent.mcpEndpoint || agent.a2aEndpoint),
    )
    .map((agent) => agent.agentId);
  const agentIds = [...new Set([...KNOWN_HEYANON_AGENT_IDS, ...gridAgentIds])];
  const agents: MarketplaceAgent[] = [];

  // Keep requests sequential so inventory generation cannot burst through the public quota.
  for (const agentId of agentIds) agents.push(await provider.getAgent(agentId));

  const categories = Object.fromEntries(
    (Object.keys(CATEGORY_NOTES) as MarketplaceCategory[]).map((category) => {
      const matchingIds = agents
        .filter((agent) => agent.categories.some((classification) => classification.category === category))
        .map((agent) => agent.agentId);
      return [category, {
        status: matchingIds.length > 0 ? "candidates" : "unverified",
        agentIds: matchingIds,
        note: matchingIds.length > 0
          ? CATEGORY_NOTES[category]
          : `${CATEGORY_NOTES[category]} The category is intentionally empty/unverified in this partial snapshot.`,
      }];
    }),
  ) as BscCandidateInventory["categories"];

  return {
    schemaVersion: 1,
    generatedAt: new Date(now()).toISOString(),
    chainId: BSC_MAINNET_CHAIN_ID,
    source: {
      name: "trust8004",
      baseUrl: provider.baseUrl,
      catalogCoverage: CATALOG_COVERAGE,
      note: "Partial trust8004 snapshot. Declared tools and derived categories are not verified capabilities.",
    },
    categories,
    agents,
  };
}
