import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { D1DatabaseLike } from "../../src/db/client";
import { CURATED_INVENTORY } from "../../src/manifest/curated-inventory";
import {
  CURATED_RECONCILE_QUERY_RESERVE,
  CURATED_RECONCILE_STATE_KEY,
  curatedInventoryVersion,
  reconcileCuratedInventory,
} from "../../src/phases/curated-reconcile";
import type { CatalogAgent } from "../../src/trust8004/types";
import { clearCatalogFixtures } from "./catalog-fixtures";

const NOW = 1_788_000_000_000;
const IDS = CURATED_INVENTORY.entries.map(({ agentId }) => agentId);

function agent(agentId: string): CatalogAgent {
  return {
    chainId: 56,
    agentId,
    owner: `0x${agentId.padStart(40, "0")}`,
    metadataUri: `ipfs://metadata/${agentId}`,
    blockNumber: String(1_000 + Number(agentId)),
    name: `Agent ${agentId}`,
    description: null,
    imageUrl: null,
    registeredAt: NOW,
    metadataUpdatedAt: NOW,
    metadataAvailable: true,
    declarations: { a2a: true, erc8183: false },
    declaredEndpoints: [],
    indexEndpoints: [{
      protocol: "a2a",
      endpoint: `https://agent-${agentId}.example.com/a2a`,
      rawProtocol: "A2A",
      source: "services",
      sourceIndex: 0,
    }],
  };
}

async function state() {
  return env.DB.prepare(`SELECT textValue, integerValue FROM runtime_state WHERE key = '${CURATED_RECONCILE_STATE_KEY}'`).first();
}

beforeEach(async () => {
  await clearCatalogFixtures();
  await env.DB.prepare("DELETE FROM runtime_state").run();
});

describe("curated inventory reconcile", () => {
  it("re-discovers the manifest in batches, once per manifest version", async () => {
    const getAgent = vi.fn(async (agentId: string) => agent(agentId));
    const version = await curatedInventoryVersion();

    const first = await reconcileCuratedInventory({ db: env.DB as unknown as D1DatabaseLike, nowMs: NOW, maxAgents: 3, remainingQueries: 40, getAgent });
    expect(first).toMatchObject({ version, from: 0, to: 3, fetched: IDS.slice(0, 3), failed: [], complete: false });
    expect(first?.discovery?.tasksQueued).toBe(3);
    expect(await state()).toEqual({ textValue: version, integerValue: 3 });

    const second = await reconcileCuratedInventory({ db: env.DB as unknown as D1DatabaseLike, nowMs: NOW + 1, maxAgents: 10, remainingQueries: 40, getAgent });
    expect(second).toMatchObject({ from: 3, to: IDS.length, fetched: IDS.slice(3), complete: true });
    expect(getAgent).toHaveBeenCalledTimes(IDS.length);
    // The rediscovered marketplace-operated seller carries its curated facts.
    expect(await env.DB.prepare("SELECT categoriesJson, marketplaceConfigured, priority FROM catalog_agents WHERE agentId = '341563'").first())
      .toEqual({ categoriesJson: '["rebalancing"]', marketplaceConfigured: 1, priority: 100 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM catalog_ingest_tasks WHERE status = 'pending'").first()).toEqual({ total: IDS.length });

    // Same manifest version: nothing left to do and no upstream request.
    expect(await reconcileCuratedInventory({ db: env.DB as unknown as D1DatabaseLike, nowMs: NOW + 2, maxAgents: 10, remainingQueries: 40, getAgent })).toBeNull();
    expect(getAgent).toHaveBeenCalledTimes(IDS.length);

    // A different stored version restarts from the beginning.
    await env.DB.prepare(`UPDATE runtime_state SET textValue = 'stale' WHERE key = '${CURATED_RECONCILE_STATE_KEY}'`).run();
    expect(await reconcileCuratedInventory({ db: env.DB as unknown as D1DatabaseLike, nowMs: NOW + 3, maxAgents: 2, remainingQueries: 40, getAgent }))
      .toMatchObject({ from: 0, to: 2 });
  });

  it("skips agents trust8004 cannot serve and still advances, and stays idle without query budget", async () => {
    class Missing extends Error {}
    const getAgent = vi.fn(async (agentId: string) => {
      if (agentId === IDS[1]) throw new Missing("not indexed");
      return agent(agentId);
    });
    expect(await reconcileCuratedInventory({ db: env.DB as unknown as D1DatabaseLike, nowMs: NOW, maxAgents: 2, remainingQueries: CURATED_RECONCILE_QUERY_RESERVE - 1, getAgent })).toBeNull();
    expect(getAgent).not.toHaveBeenCalled();
    expect(await state()).toBeNull();

    const summary = await reconcileCuratedInventory({ db: env.DB as unknown as D1DatabaseLike, nowMs: NOW, maxAgents: 2, remainingQueries: CURATED_RECONCILE_QUERY_RESERVE, getAgent });
    expect(summary).toMatchObject({ from: 0, to: 2, fetched: [IDS[0]], failed: [{ agentId: IDS[1], errorCode: "Missing" }] });
    expect(summary?.discovery?.tasksQueued).toBe(1);
    expect(await state()).toMatchObject({ integerValue: 2 });
  });
});
