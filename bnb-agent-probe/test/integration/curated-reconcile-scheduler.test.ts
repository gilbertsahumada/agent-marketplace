import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../src/config";
import { CURATED_INVENTORY } from "../../src/manifest/curated-inventory";
import { CURATED_RECONCILE_STATE_KEY } from "../../src/phases/curated-reconcile";
import { createWp2ScheduledRunner } from "../../src/scheduled";
import type { Env } from "../../src/types";
import { clearCatalogFixtures } from "./catalog-fixtures";

const IDS = CURATED_INVENTORY.entries.map(({ agentId }) => agentId);

function catalogAgent(agentId: string) {
  return {
    chainId: 56,
    agentId,
    name: `Curated ${agentId}`,
    registeredAt: 10_000,
    metadataUpdatedAt: 9_000,
    metadataReasonCode: "ok",
    services: [{ name: "A2A", endpoint: `https://agent-${agentId}.example.com/a2a` }],
    endpoints: [],
  };
}

beforeEach(async () => {
  await clearCatalogFixtures();
  await env.DB.prepare("DELETE FROM runtime_state").run();
});

describe("curated reconcile inside the header phase", () => {
  it("fetches the curated agents from trust8004 and queues their re-ingest only when enabled", async () => {
    const fetchCatalog = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/agents")) {
        return Response.json({ items: [], total: 0, limit: Number(url.searchParams.get("limit")), offset: 0 });
      }
      const match = /\/agents\/56:(\d+)$/.exec(url.pathname);
      if (match) return Response.json(catalogAgent(match[1]!));
      return new Response(null, { status: 404 });
    });
    let clock = 20_000;
    const runner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => `curated-${clock}`,
      fetch: fetchCatalog as typeof fetch,
    });
    const config = loadConfig({
      CLOUDFLARE_WORKERS_PLAN: "paid",
      KILL_SWITCH: "0",
      PRODUCER_KILL_SWITCH: "0",
      CATALOG_V2_WRITES_ENABLED: "1",
      CATALOG_DISCOVERY_PAGE_SIZE: "15",
      CATALOG_INGEST_TASKS_PER_RUN: "1",
      CATALOG_DECLARATIONS_PER_TASK: "1",
    });
    const context = createExecutionContext();

    // Flag off: the header phase never asks trust8004 for a curated agent.
    await runner({ scheduledTime: 20_000, cron: "* * * * *" }, env, context, config);
    expect(fetchCatalog.mock.calls.some(([url]) => /\/agents\/56:\d+$/.test(String(url)))).toBe(false);
    expect(await env.DB.prepare(`SELECT key FROM runtime_state WHERE key = '${CURATED_RECONCILE_STATE_KEY}'`).first()).toBeNull();

    // Flag on: four curated agents per header run, progress kept in runtime_state.
    const enabled = { ...env, CATALOG_CURATED_RECONCILE_ENABLED: "1" } as unknown as Env;
    await env.DB.prepare("UPDATE runtime_state SET textValue = 'header' WHERE key = 'next_scheduler_phase'").run();
    await runner({ scheduledTime: 25_000, cron: "* * * * *" }, enabled, context, config);
    const detailCalls = fetchCatalog.mock.calls.map(([url]) => String(url)).filter((url) => /\/agents\/56:\d+$/.test(url));
    const detailIds = detailCalls.map((url) => url.slice(url.lastIndexOf(":") + 1));
    // Four reconcile fetches, then the ingest task of the first one runs in the same phase.
    expect(detailIds).toEqual([...IDS.slice(0, 4), IDS[0]]);
    expect(JSON.parse(await runtimeText("last_header_summary") ?? "{}")).toMatchObject({
      phase: "header",
      status: "ok",
      curatedReconcile: { from: 0, to: 4, fetched: IDS.slice(0, 4), failed: [], complete: false },
    });
    // 45650 is in the first batch; the marketplace-operated sellers follow in the next header run.
    expect(await env.DB.prepare("SELECT categoriesJson, marketplaceConfigured, priority FROM catalog_agents WHERE agentId = '45650'").first())
      .toEqual({ categoriesJson: '["rebalancing"]', marketplaceConfigured: 0, priority: 90 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM catalog_ingest_tasks").first()).toEqual({ total: 4 });
  });
});

async function runtimeText(key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT textValue FROM runtime_state WHERE key = ?").bind(key).first<{ textValue: string | null }>();
  return row?.textValue ?? null;
}
