import type { D1DatabaseLike } from "../db/client";
import { createDatabase, readRuntimeStates, writeRuntimeState } from "../db/orm";
import { CURATED_INVENTORY } from "../manifest/curated-inventory";
import { sha256 } from "../trust8004/resource-normalization";
import type { CatalogAgent } from "../trust8004/types";
import { enqueueCatalogDiscoveryPage, type CatalogDiscoverySummary } from "./catalog-ingest";

/**
 * Re-discovers the curated inventory once per manifest version. The header
 * phase only sees the newest agents and the sweep needs weeks to page through
 * the whole trust8004 catalogue, so without this step a manifest change (a new
 * marketplace-operated seller, a category assignment) never reaches agents
 * that were indexed before the deploy. Progress is stored in runtime_state so
 * a large manifest is spread over several runs and a redeploy with the same
 * manifest costs one D1 read per header run.
 */
export const CURATED_RECONCILE_STATE_KEY = "curated_inventory_reconcile";
/** State read, discovery upserts (agents, tasks, identities) and the state write. */
export const CURATED_RECONCILE_QUERY_RESERVE = 8;

export interface CuratedReconcileSummary {
  readonly version: string;
  readonly from: number;
  readonly to: number;
  readonly fetched: readonly string[];
  readonly failed: ReadonlyArray<{ agentId: string; errorCode: string }>;
  readonly discovery: CatalogDiscoverySummary | null;
  readonly complete: boolean;
}

export async function curatedInventoryVersion(): Promise<string> {
  return sha256(JSON.stringify(CURATED_INVENTORY.entries.map((entry) => [
    entry.agentId,
    entry.operator,
    entry.categories.map(({ category }) => category),
  ])));
}

export async function reconcileCuratedInventory(input: {
  db: D1DatabaseLike;
  nowMs: number;
  maxAgents: number;
  remainingQueries: number;
  getAgent: (agentId: string) => Promise<CatalogAgent>;
}): Promise<CuratedReconcileSummary | null> {
  if (input.maxAgents <= 0 || input.remainingQueries < CURATED_RECONCILE_QUERY_RESERVE) return null;
  const version = await curatedInventoryVersion();
  const db = createDatabase(input.db);
  const [state] = await readRuntimeStates(db, [CURATED_RECONCILE_STATE_KEY]);
  const from = state?.textValue === version ? (state.integerValue ?? 0) : 0;
  const entries = CURATED_INVENTORY.entries;
  if (from >= entries.length) return null;

  const batch = entries.slice(from, from + input.maxAgents);
  const fetched: CatalogAgent[] = [];
  const failed: Array<{ agentId: string; errorCode: string }> = [];
  for (const entry of batch) {
    try {
      fetched.push(await input.getAgent(entry.agentId));
    } catch (error) {
      failed.push({ agentId: entry.agentId, errorCode: error instanceof Error ? error.constructor.name : "unknown" });
    }
  }
  const discovery = fetched.length === 0
    ? null
    : await enqueueCatalogDiscoveryPage(input.db, fetched, { nowMs: input.nowMs, source: "directed" });
  const to = from + batch.length;
  await writeRuntimeState(db, { key: CURATED_RECONCILE_STATE_KEY, textValue: version, integerValue: to, updatedAt: input.nowMs });
  return { version, from, to, fetched: fetched.map(({ agentId }) => agentId), failed, discovery, complete: to >= entries.length };
}
