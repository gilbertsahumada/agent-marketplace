import type { CommerceIndexChainId } from "./commerce-index";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase, readNewestCommerceJobMissingPaymentToken } from "../db/orm";
import type { D1Database, QueueProducer } from "../types";

export interface CommerceTokenBackfillSummary {
  readonly enqueued: Array<{ chainId: CommerceIndexChainId; fromJobId: number; toJobId: number }>;
}

/**
 * Enqueue at most one newest-first repair batch per readable chain. The
 * partial D1 index only contains rows still missing a token, so this query
 * becomes cheaper as the backlog drains and turns into a no-op when complete.
 */
export async function enqueueCommerceTokenBackfill(
  db: D1Database,
  queue: QueueProducer,
  chains: readonly CommerceIndexChainId[],
  batchSize: number,
  enqueuedAt: number,
): Promise<CommerceTokenBackfillSummary> {
  const enqueued: CommerceTokenBackfillSummary["enqueued"][number][] = [];
  const database = createDatabase(db as unknown as D1DatabaseLike);
  for (const chainId of chains) {
    const newestJobId = await readNewestCommerceJobMissingPaymentToken(database, chainId);
    if (newestJobId === null || !Number.isSafeInteger(newestJobId) || newestJobId < 0) continue;
    const toJobId = newestJobId;
    const fromJobId = Math.max(0, toJobId - batchSize + 1);
    await queue.send({ schemaVersion: 2, kind: "index_jobs", chainId, fromJobId, toJobId, enqueuedAt });
    enqueued.push({ chainId, fromJobId, toJobId });
  }
  return { enqueued };
}
