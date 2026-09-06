import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { clearCatalogFixtures } from "./catalog-fixtures";
import { recordCompatibility } from "../../src/catalog/compatibility";
import { createDatabase } from "../../src/db/orm";
import type { D1DatabaseLike } from "../../src/db/client";
beforeEach(clearCatalogFixtures);
it("records detector provenance without manufacturing quote success", async () => {
  const target = { agentKey: "eip155:56:123", endpointKey: "a".repeat(64), transport: "a2a" };
  await recordCompatibility(createDatabase(env.DB as unknown as D1DatabaseLike), target, 1800000000000, {
    schemaHash: "b".repeat(64), provenance: { profile: "bnb-sdk-v1", source: "a2a-declaration", detectorVersion: 2 },
  });
  const row = await env.DB.prepare("SELECT * FROM catalog_seller_capabilities WHERE agentKey=?").bind(target.agentKey).first();
  expect(row).toMatchObject({ state: "discovered", compatibilityState: "compatible", detectorVersion: 2, negotiationProfile: "bnb-sdk-v1", schemaSource: "a2a-declaration", lastSuccessAt: null });
});
