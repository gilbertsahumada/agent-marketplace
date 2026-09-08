import { describe, expect, it } from "vitest";

import {
  CURATED_INVENTORY,
  CURATED_INVENTORY_CATEGORIES,
} from "../src/manifest/curated-inventory.ts";
import {
  assertCuratedInventoryCurrent,
  buildCuratedInventory,
  serializeCuratedInventory,
} from "../scripts/generate-curated-inventory.ts";

const EXPECTED_AGENT_IDS = ["43129", "45381", "45422", "45650", "303779", "341563", "341564", "341565"];

describe("WP1 curated inventory", () => {
  it("keeps the curated candidates and the four marketplace-operated sellers", () => {
    expect(CURATED_INVENTORY.entries.map(({ agentId }) => agentId)).toEqual(EXPECTED_AGENT_IDS);
    expect(new Set(CURATED_INVENTORY.entries.map(({ agentId }) => agentId)).size).toBe(EXPECTED_AGENT_IDS.length);
  });

  it("keeps all four marketplace categories first-class", () => {
    expect(Object.keys(CURATED_INVENTORY.categories)).toEqual(CURATED_INVENTORY_CATEGORIES);
    expect(CURATED_INVENTORY.categories.grid_trading.agentIds).toEqual(["303779"]);

    for (const category of CURATED_INVENTORY_CATEGORIES) {
      expect(CURATED_INVENTORY.categories[category].agentIds.length).toBeGreaterThan(0);
    }
  });

  it("marks every category assignment as derived and unverified", () => {
    const assignments = CURATED_INVENTORY.entries.flatMap(({ categories }) => categories);
    expect(assignments.length).toBe(9);

    for (const assignment of assignments) {
      expect(assignment.provenance).toBe("derived:marketplace-inventory");
      expect(assignment.verificationStatus).toBe("candidate_unverified");
    }
  });

  it("matches a deterministic regeneration from marketplaceInventoryEntries", () => {
    const regenerated = buildCuratedInventory();

    expect(regenerated).toEqual(CURATED_INVENTORY);
    expect(serializeCuratedInventory(regenerated)).toBe(serializeCuratedInventory(CURATED_INVENTORY));
    expect(() => assertCuratedInventoryCurrent()).not.toThrow();
  });

  it("detects committed manifest drift", () => {
    const staleManifest = {
      ...CURATED_INVENTORY,
      entries: CURATED_INVENTORY.entries.slice(1),
    };

    expect(() => assertCuratedInventoryCurrent(staleManifest)).toThrow("Curated inventory drift detected");
  });
});
