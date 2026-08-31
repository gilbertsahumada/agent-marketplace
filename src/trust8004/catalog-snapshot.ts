import { createHash } from "node:crypto";
import {
  normalizeCatalogAgent,
  type CatalogAgentIndexRecord,
  type CatalogAgentInput,
} from "./catalog-normalization.ts";
import { canonicalJson } from "./funnel-snapshot.ts";

export const CATALOG_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export interface CatalogSnapshotPage {
  items: CatalogAgentInput[];
  total: number;
  offset: number;
  limit: number;
}

export interface CatalogSnapshotCheckpoint {
  schemaVersion: typeof CATALOG_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  chainId: 56;
  pageSize: number;
  expectedTotal: number | null;
  nextOffset: number;
  pages: number;
  registeredAgentIds: string[];
  candidates: CatalogAgentIndexRecord[];
}

export interface CatalogSnapshotV2 {
  schemaVersion: typeof CATALOG_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  chainId: 56;
  source: {
    provider: "trust8004";
    listPath: "/api/app/agents";
    ordering: "registered:asc";
  };
  registeredAgentIds: string[];
  candidates: CatalogAgentIndexRecord[];
  stats: {
    registered: number;
    candidates: number;
    declarations: number;
    safeDeclarations: number;
    unsafeDeclarations: number;
    sharedOrigins: number;
  };
  scan: {
    pageSize: number;
    pages: number;
    nextOffset: number;
    complete: true;
  };
  sourceSha256: string;
}

export interface RunCatalogSnapshotOptions {
  pageSize?: number;
  generatedAt?: string;
  resume?: CatalogSnapshotCheckpoint;
  fetchPage: (offset: number, limit: number) => Promise<CatalogSnapshotPage>;
  onCheckpoint?: (checkpoint: CatalogSnapshotCheckpoint) => void | Promise<void>;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`CATALOG_CONFIG:${field}`);
  return value;
}

function validateResume(resume: CatalogSnapshotCheckpoint, pageSize: number): void {
  if (resume.schemaVersion !== CATALOG_SNAPSHOT_SCHEMA_VERSION
    || resume.chainId !== 56
    || resume.pageSize !== pageSize
    || resume.nextOffset !== resume.registeredAgentIds.length
    || resume.pages < 0) {
    throw new Error("CATALOG_CHECKPOINT_INVALID");
  }
}

export function computeCatalogSnapshotSha256(snapshot: CatalogSnapshotV2): string {
  const value: Record<string, unknown> = { ...snapshot };
  delete value.sourceSha256;
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export async function runCatalogSnapshot(
  options: RunCatalogSnapshotOptions,
): Promise<CatalogSnapshotV2> {
  const pageSize = positiveInteger(options.pageSize ?? 2_000, "pageSize");
  const generatedAt = options.resume?.generatedAt ?? options.generatedAt ?? new Date().toISOString();
  if (options.resume) validateResume(options.resume, pageSize);

  const registeredAgentIds = [...(options.resume?.registeredAgentIds ?? [])];
  const candidates = [...(options.resume?.candidates ?? [])];
  const seenIds = new Set(registeredAgentIds);
  let expectedTotal = options.resume?.expectedTotal ?? null;
  let nextOffset = options.resume?.nextOffset ?? 0;
  let pages = options.resume?.pages ?? 0;

  while (expectedTotal === null || nextOffset < expectedTotal) {
    const page = await options.fetchPage(nextOffset, pageSize);
    if (page.offset !== nextOffset) throw new Error("CATALOG_PAGE_OFFSET_MISMATCH");
    if (!Number.isSafeInteger(page.total) || page.total < 0) throw new Error("CATALOG_TOTAL_INVALID");
    if (expectedTotal !== null && page.total < expectedTotal) throw new Error("CATALOG_TOTAL_REGRESSION");
    expectedTotal = Math.max(expectedTotal ?? 0, page.total);

    for (const item of page.items) {
      const normalized = normalizeCatalogAgent(item);
      if (seenIds.has(normalized.agentId)) {
        throw new Error(`CATALOG_DUPLICATE_AGENT_ID:${normalized.agentId}`);
      }
      seenIds.add(normalized.agentId);
      registeredAgentIds.push(normalized.agentId);
      if (normalized.candidate) candidates.push(normalized);
    }
    pages += 1;
    nextOffset += page.items.length;
    await options.onCheckpoint?.({
      schemaVersion: CATALOG_SNAPSHOT_SCHEMA_VERSION,
      generatedAt,
      chainId: 56,
      pageSize,
      expectedTotal,
      nextOffset,
      pages,
      registeredAgentIds: [...registeredAgentIds],
      candidates: [...candidates],
    });
    if (page.items.length === 0) break;
  }

  if (expectedTotal === null || registeredAgentIds.length !== expectedTotal) {
    throw new Error(`CATALOG_INCOMPLETE:${registeredAgentIds.length}/${expectedTotal ?? "unknown"}`);
  }
  candidates.sort((left, right) => BigInt(left.agentId) < BigInt(right.agentId) ? -1 : 1);
  const declarationCount = candidates.reduce((sum, item) => sum + item.declarations.length, 0);
  const safeDeclarationCount = candidates.reduce(
    (sum, item) => sum + item.declarations.filter((entry) => entry.safety === "safe").length,
    0,
  );
  const originCounts = new Map<string, number>();
  for (const candidate of candidates) {
    for (const item of candidate.declarations) {
      if (item.originKey) originCounts.set(item.originKey, (originCounts.get(item.originKey) ?? 0) + 1);
    }
  }

  const snapshot: CatalogSnapshotV2 = {
    schemaVersion: CATALOG_SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    chainId: 56,
    source: {
      provider: "trust8004",
      listPath: "/api/app/agents",
      ordering: "registered:asc",
    },
    registeredAgentIds,
    candidates,
    stats: {
      registered: registeredAgentIds.length,
      candidates: candidates.length,
      declarations: declarationCount,
      safeDeclarations: safeDeclarationCount,
      unsafeDeclarations: declarationCount - safeDeclarationCount,
      sharedOrigins: [...originCounts.values()].filter((count) => count > 1).length,
    },
    scan: { pageSize, pages, nextOffset, complete: true },
    sourceSha256: "",
  };
  snapshot.sourceSha256 = computeCatalogSnapshotSha256(snapshot);
  return snapshot;
}
