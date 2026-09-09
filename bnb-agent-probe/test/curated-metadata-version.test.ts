import { describe, expect, it } from "vitest";

import { CURATED_INVENTORY } from "../src/manifest/curated-inventory.ts";
import { catalogMetadataVersion, curatedInventoryFingerprint } from "../src/trust8004/resource-normalization.ts";
import type { CatalogAgent } from "../src/trust8004/types.ts";

function agent(agentId: string, chainId: 56 | 97 = 56): CatalogAgent {
  return {
    chainId,
    agentId,
    owner: "0x96a91427bf3dc47b2bbae4bb3fd86f34e1b06bff",
    metadataUri: "data:application/json;base64,e30=",
    blockNumber: "123",
    name: "same metadata",
    description: null,
    imageUrl: null,
    registeredAt: 1_788_000_000_000,
    metadataUpdatedAt: 1_788_000_000_000,
    metadataAvailable: true,
    declarations: { a2a: true, erc8183: false },
    declaredEndpoints: [],
    indexEndpoints: [],
  };
}

describe("curated inventory in the catalog metadata version", () => {
  it("fingerprints every curated entry and nothing else", () => {
    expect(curatedInventoryFingerprint(agent("341563"))).toEqual({ operator: "marketplace", categories: ["rebalancing"] });
    expect(curatedInventoryFingerprint(agent("45650"))).toEqual({ operator: "third_party", categories: ["rebalancing"] });
    expect(curatedInventoryFingerprint(agent("999999"))).toBeNull();
    expect(curatedInventoryFingerprint(agent("341563", 97))).toBeNull();
    expect(CURATED_INVENTORY.entries.every((entry) => curatedInventoryFingerprint(agent(entry.agentId)) !== null)).toBe(true);
  });

  it("changes the version when the manifest assigns the agent, so a manifest change re-ingests it", async () => {
    const outside = await catalogMetadataVersion(agent("999999"));
    // Agents outside the manifest keep sharing the historical version string.
    expect(await catalogMetadataVersion(agent("999998"))).toBe(outside);
    expect(await catalogMetadataVersion(agent("341563"))).not.toBe(outside);
    expect(await catalogMetadataVersion(agent("341563"))).not.toBe(await catalogMetadataVersion(agent("341564")));
    expect(await catalogMetadataVersion(agent("341563", 97))).toBe(await catalogMetadataVersion(agent("999999", 97)));
  });
});
