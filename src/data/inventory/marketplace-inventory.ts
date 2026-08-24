import type { MarketplaceCategory } from "../../trust8004/types.js";

export interface InventoryCategoryEvidence {
  category: MarketplaceCategory;
  signal: string;
  provenance: "derived:marketplace-inventory";
  verificationStatus: "candidate_unverified";
}

export interface MarketplaceInventoryEntry {
  chainId: 56;
  agentId: string;
  categories: readonly InventoryCategoryEvidence[];
  operator: "third_party" | "marketplace";
}

const entries = [
  {
    chainId: 56,
    agentId: "45650",
    operator: "third_party",
    categories: [{
      category: "rebalancing",
      signal: "Curated V3 liquidity range and rebalancing candidate.",
      provenance: "derived:marketplace-inventory",
      verificationStatus: "candidate_unverified",
    }],
  },
  {
    chainId: 56,
    agentId: "45381",
    operator: "third_party",
    categories: [{
      category: "health_factor_monitoring",
      signal: "Curated Aave health-factor and collateral-monitoring candidate.",
      provenance: "derived:marketplace-inventory",
      verificationStatus: "candidate_unverified",
    }],
  },
  {
    chainId: 56,
    agentId: "45422",
    operator: "third_party",
    categories: [{
      category: "yield_optimisation",
      signal: "Curated Beefy vault and yield candidate.",
      provenance: "derived:marketplace-inventory",
      verificationStatus: "candidate_unverified",
    }],
  },
  {
    chainId: 56,
    agentId: "43129",
    operator: "third_party",
    categories: [
      {
        category: "yield_optimisation",
        signal: "Curated Venus supply-yield candidate.",
        provenance: "derived:marketplace-inventory",
        verificationStatus: "candidate_unverified",
      },
      {
        category: "health_factor_monitoring",
        signal: "Curated Venus account-liquidity and collateral candidate.",
        provenance: "derived:marketplace-inventory",
        verificationStatus: "candidate_unverified",
      },
    ],
  },
] as const satisfies readonly MarketplaceInventoryEntry[];

export const MARKETPLACE_INVENTORY = {
  schemaVersion: 1,
  chainId: 56,
  catalogCoverage: "partial",
  provenance: "derived:marketplace-inventory",
  entries,
  categories: {
    rebalancing: {
      status: "candidates",
      agentIds: ["45650"],
      evidence: "One curated candidate is mapped from declared metadata and tools.",
      provenance: "derived:marketplace-inventory",
      verificationStatus: "candidate_unverified",
    },
    grid_trading: {
      status: "unverified",
      agentIds: [],
      evidence: "No curated BSC seller has sufficient Grid Trading evidence.",
      provenance: "derived:marketplace-inventory",
      verificationStatus: "candidate_unverified",
    },
    yield_optimisation: {
      status: "candidates",
      agentIds: ["45422", "43129"],
      evidence: "Two curated candidates are mapped from declared metadata and tools.",
      provenance: "derived:marketplace-inventory",
      verificationStatus: "candidate_unverified",
    },
    health_factor_monitoring: {
      status: "candidates",
      agentIds: ["45381", "43129"],
      evidence: "Two curated candidates are mapped from declared metadata and tools.",
      provenance: "derived:marketplace-inventory",
      verificationStatus: "candidate_unverified",
    },
  },
} as const;

export function marketplaceInventoryEntries(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MarketplaceInventoryEntry[] {
  const configuredAgentId = Reflect.get(env, "ERC8183_MAINNET_SELLER_AGENT_ID")?.trim();
  if (!configuredAgentId || !/^\d+$/.test(configuredAgentId) || BigInt(configuredAgentId) <= 0n) {
    return [...MARKETPLACE_INVENTORY.entries];
  }
  const normalized = BigInt(configuredAgentId).toString();
  if (MARKETPLACE_INVENTORY.entries.some(({ agentId }) => agentId === normalized)) return [...MARKETPLACE_INVENTORY.entries];
  return [...MARKETPLACE_INVENTORY.entries, {
    chainId: 56,
    agentId: normalized,
    operator: "marketplace",
    categories: [{
      category: "grid_trading",
      signal: "Marketplace-operated deterministic Grid planner; no trading execution or custody.",
      provenance: "derived:marketplace-inventory",
      verificationStatus: "candidate_unverified",
    }],
  }];
}

const entriesById = new Map<string, MarketplaceInventoryEntry>(
  MARKETPLACE_INVENTORY.entries.map((entry) => [entry.agentId, entry]),
);

export function getMarketplaceInventoryEntry(agentId: string): MarketplaceInventoryEntry | null {
  return entriesById.get(agentId) ?? marketplaceInventoryEntries().find((entry) => entry.agentId === agentId) ?? null;
}

export function isMarketplaceInventoryAgent(agentId: string): boolean {
  return getMarketplaceInventoryEntry(agentId) !== null;
}
