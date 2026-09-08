export const CURATED_INVENTORY_CATEGORIES = [
  "rebalancing",
  "grid_trading",
  "yield_optimisation",
  "health_factor_monitoring",
] as const;

export type CuratedInventoryCategory = (typeof CURATED_INVENTORY_CATEGORIES)[number];

export interface CuratedCategoryAssignment {
  category: CuratedInventoryCategory;
  signal: string;
  provenance: "derived:marketplace-inventory";
  verificationStatus: "candidate_unverified";
}

export interface CuratedInventoryEntry {
  chainId: 56;
  agentId: string;
  operator: "third_party" | "marketplace";
  categories: readonly CuratedCategoryAssignment[];
}

export interface CuratedInventoryManifest {
  schemaVersion: 1;
  manifestVersion: 1;
  chainId: 56;
  provenance: "derived:marketplace-inventory";
  entries: readonly CuratedInventoryEntry[];
  categories: Readonly<Record<CuratedInventoryCategory, {
    agentIds: readonly string[];
    provenance: "derived:marketplace-inventory";
    verificationStatus: "candidate_unverified";
  }>>;
}

/**
 * Generated from marketplaceInventoryEntries() by
 * scripts/generate-curated-inventory.ts. This module intentionally has no
 * imports so the Worker cannot pull application or server-only code into its
 * runtime bundle.
 */
export const CURATED_INVENTORY: CuratedInventoryManifest = {
  "schemaVersion": 1,
  "manifestVersion": 1,
  "chainId": 56,
  "provenance": "derived:marketplace-inventory",
  "entries": [
    {
      "chainId": 56,
      "agentId": "43129",
      "operator": "third_party",
      "categories": [
        {
          "category": "yield_optimisation",
          "signal": "Curated Venus supply-yield candidate.",
          "provenance": "derived:marketplace-inventory",
          "verificationStatus": "candidate_unverified"
        },
        {
          "category": "health_factor_monitoring",
          "signal": "Curated Venus account-liquidity and collateral candidate.",
          "provenance": "derived:marketplace-inventory",
          "verificationStatus": "candidate_unverified"
        }
      ]
    },
    {
      "chainId": 56,
      "agentId": "45381",
      "operator": "third_party",
      "categories": [
        {
          "category": "health_factor_monitoring",
          "signal": "Curated Aave health-factor and collateral-monitoring candidate.",
          "provenance": "derived:marketplace-inventory",
          "verificationStatus": "candidate_unverified"
        }
      ]
    },
    {
      "chainId": 56,
      "agentId": "45422",
      "operator": "third_party",
      "categories": [
        {
          "category": "yield_optimisation",
          "signal": "Curated Beefy vault and yield candidate.",
          "provenance": "derived:marketplace-inventory",
          "verificationStatus": "candidate_unverified"
        }
      ]
    },
    {
      "chainId": 56,
      "agentId": "45650",
      "operator": "third_party",
      "categories": [
        {
          "category": "rebalancing",
          "signal": "Curated V3 liquidity range and rebalancing candidate.",
          "provenance": "derived:marketplace-inventory",
          "verificationStatus": "candidate_unverified"
        }
      ]
    },
    {
      "chainId": 56,
      "agentId": "303779",
      "operator": "marketplace",
      "categories": [
        {
          "category": "grid_trading",
          "signal": "Marketplace-operated deterministic Grid planner; no trading execution or custody.",
          "provenance": "derived:marketplace-inventory",
          "verificationStatus": "candidate_unverified"
        }
      ]
    },
    {
      "chainId": 56,
      "agentId": "341563",
      "operator": "marketplace",
      "categories": [
        {
          "category": "rebalancing",
          "signal": "Marketplace-operated deterministic rebalancing planner; no order execution or custody.",
          "provenance": "derived:marketplace-inventory",
          "verificationStatus": "candidate_unverified"
        }
      ]
    },
    {
      "chainId": 56,
      "agentId": "341564",
      "operator": "marketplace",
      "categories": [
        {
          "category": "yield_optimisation",
          "signal": "Marketplace-operated deterministic yield allocation planner over buyer-provided rates; no deposits or custody.",
          "provenance": "derived:marketplace-inventory",
          "verificationStatus": "candidate_unverified"
        }
      ]
    },
    {
      "chainId": 56,
      "agentId": "341565",
      "operator": "marketplace",
      "categories": [
        {
          "category": "health_factor_monitoring",
          "signal": "Marketplace-operated deterministic loan health report; a single report, not a monitoring service, no transactions or custody.",
          "provenance": "derived:marketplace-inventory",
          "verificationStatus": "candidate_unverified"
        }
      ]
    }
  ],
  "categories": {
    "rebalancing": {
      "agentIds": [
        "45650",
        "341563"
      ],
      "provenance": "derived:marketplace-inventory",
      "verificationStatus": "candidate_unverified"
    },
    "grid_trading": {
      "agentIds": [
        "303779"
      ],
      "provenance": "derived:marketplace-inventory",
      "verificationStatus": "candidate_unverified"
    },
    "yield_optimisation": {
      "agentIds": [
        "43129",
        "45422",
        "341564"
      ],
      "provenance": "derived:marketplace-inventory",
      "verificationStatus": "candidate_unverified"
    },
    "health_factor_monitoring": {
      "agentIds": [
        "43129",
        "45381",
        "341565"
      ],
      "provenance": "derived:marketplace-inventory",
      "verificationStatus": "candidate_unverified"
    }
  }
};
