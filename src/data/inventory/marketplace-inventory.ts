import type { MarketplaceCategory } from "../../trust8004/types.ts";
import { configuredHostedSellerAgentIds } from "../../shared/hosted-seller-env.ts";

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

// Each configured marketplace-operated seller joins the curated inventory
// under its own category. Signals stay descriptive: operating a seller is
// not evidence that it is hireable; the Worker's observations decide that.
const HOSTED_SELLER_SIGNALS: Record<string, { category: MarketplaceCategory; signal: string }> = {
  grid: { category: "grid_trading", signal: "Marketplace-operated deterministic Grid planner; no trading execution or custody." },
  rebalance: { category: "rebalancing", signal: "Marketplace-operated deterministic rebalancing planner; no order execution or custody." },
  yield: { category: "yield_optimisation", signal: "Marketplace-operated deterministic yield allocation planner over buyer-provided rates; no deposits or custody." },
  "loan-health": { category: "health_factor_monitoring", signal: "Marketplace-operated deterministic loan health report; a single report, not a monitoring service, no transactions or custody." },
};

export function marketplaceInventoryEntries(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MarketplaceInventoryEntry[] {
  const entries: MarketplaceInventoryEntry[] = [...MARKETPLACE_INVENTORY.entries];
  const known = new Set(entries.map(({ agentId }) => agentId));
  for (const { slug, agentId } of configuredHostedSellerAgentIds(env)) {
    const assignment = HOSTED_SELLER_SIGNALS[slug];
    if (!assignment || known.has(agentId)) continue;
    known.add(agentId);
    entries.push({
      chainId: 56,
      agentId,
      operator: "marketplace",
      categories: [{
        category: assignment.category,
        signal: assignment.signal,
        provenance: "derived:marketplace-inventory",
        verificationStatus: "candidate_unverified",
      }],
    });
  }
  return entries;
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
