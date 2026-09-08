import { marketplaceInventoryEntries } from "../../src/data/inventory/marketplace-inventory.ts";
import {
  CURATED_INVENTORY,
  CURATED_INVENTORY_CATEGORIES,
  type CuratedInventoryCategory,
  type CuratedInventoryManifest,
} from "../src/manifest/curated-inventory.ts";

import { HOSTED_SELLERS } from "../src/manifest/hosted-sellers.ts";

// Every registered marketplace-operated seller joins the manifest through the
// same env names the application reads, so one regeneration covers them all.
const HOSTED_SELLER_ENV = Object.fromEntries(
  HOSTED_SELLERS.filter((seller) => seller.agentId !== null).map((seller) => [
    seller.slug === "grid"
      ? "ERC8183_MAINNET_SELLER_AGENT_ID"
      : `ERC8183_MAINNET_SELLER_${({ rebalance: "REBALANCE", yield: "YIELD", "loan-health": "HEALTH" } as const)[seller.slug]}_AGENT_ID`,
    seller.agentId!,
  ]),
);
const PROVENANCE = "derived:marketplace-inventory" as const;
const VERIFICATION_STATUS = "candidate_unverified" as const;

function compareAgentIds(left: string, right: string): number {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

export function buildCuratedInventory(): CuratedInventoryManifest {
  const sourceEntries = marketplaceInventoryEntries(HOSTED_SELLER_ENV);

  const entries = sourceEntries
    .map((entry) => ({
      chainId: entry.chainId,
      agentId: entry.agentId,
      operator: entry.operator,
      categories: entry.categories
        .map((assignment) => ({
          category: assignment.category,
          signal: assignment.signal,
          provenance: PROVENANCE,
          verificationStatus: VERIFICATION_STATUS,
        }))
        .sort((left, right) => (
          CURATED_INVENTORY_CATEGORIES.indexOf(left.category)
          - CURATED_INVENTORY_CATEGORIES.indexOf(right.category)
        )),
    }))
    .sort((left, right) => compareAgentIds(left.agentId, right.agentId));

  const categories = Object.fromEntries(
    CURATED_INVENTORY_CATEGORIES.map((category) => [
      category,
      {
        agentIds: entries
          .filter((entry) => entry.categories.some((assignment) => assignment.category === category))
          .map(({ agentId }) => agentId)
          .sort(compareAgentIds),
        provenance: PROVENANCE,
        verificationStatus: VERIFICATION_STATUS,
      },
    ]),
  ) as unknown as Record<
    CuratedInventoryCategory,
    CuratedInventoryManifest["categories"][CuratedInventoryCategory]
  >;

  return {
    schemaVersion: 1,
    manifestVersion: 1,
    chainId: 56,
    provenance: PROVENANCE,
    entries,
    categories,
  };
}

export function serializeCuratedInventory(manifest: CuratedInventoryManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function assertCuratedInventoryCurrent(
  committedManifest: CuratedInventoryManifest = CURATED_INVENTORY,
): void {
  const generated = serializeCuratedInventory(buildCuratedInventory());
  const committed = serializeCuratedInventory(committedManifest);

  if (generated !== committed) {
    throw new Error(
      "Curated inventory drift detected. Regenerate src/manifest/curated-inventory.ts from marketplaceInventoryEntries().",
    );
  }
}

if (process.argv[1]?.endsWith("generate-curated-inventory.ts")) {
  assertCuratedInventoryCurrent();
}
