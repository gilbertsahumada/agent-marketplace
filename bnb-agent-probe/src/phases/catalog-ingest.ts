import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import {
  catalogAgentAdmission,
  catalogDirectedTracking,
  catalogAgentEndpoints,
  catalogAgents,
  catalogEndpoints,
  catalogIngestTasks,
  runtimeState,
} from "../db/schema";
import { CURATED_INVENTORY } from "../manifest/curated-inventory";
import {
  catalogMetadataVersion,
  normalizeCatalogResource,
  type NormalizedCatalogResource,
} from "../trust8004/resource-normalization";
import type { CatalogAgent } from "../trust8004/types";
import { CatalogHttpError } from "../trust8004/client";

// D1 currently enforces a much smaller bound-variable ceiling than desktop
// SQLite. Conflict-update clauses also consume parameters, so chunks stay
// deliberately below 100 variables per statement.
const AGENT_CHUNK = 2;
const TASK_CHUNK = 3;
const ENDPOINT_CHUNK = 2;
const RELATION_CHUNK = 5;
const LEASE_MS = 30_000;
const LAST_SEEN_REFRESH_MS = 60 * 60_000;

type DiscoverySource = "header" | "sweep" | "directed" | "reconciliation";

export function catalogIngestTaskLimitForBudget(input: {
  readonly remainingQueries: number;
  readonly maxDeclarations: number;
  readonly requestedTasks: number;
  readonly reserveQueries: number;
}): number {
  const queryCeilingPerTask = 6
    + Math.ceil(input.maxDeclarations / ENDPOINT_CHUNK)
    + Math.ceil(input.maxDeclarations / RELATION_CHUNK);
  const usable = Math.max(0, input.remainingQueries - input.reserveQueries);
  return Math.min(input.requestedTasks, Math.floor(usable / queryCeilingPerTask));
}

export interface CatalogDiscoverySummary {
  readonly agentsSeen: number;
  readonly identitiesWritten: number;
  readonly tasksQueued: number;
  readonly cursor: number | null;
  readonly d1Queries: number;
  readonly d1RowsWritten: number;
}

export interface CatalogIngestSummary {
  readonly status: "idle" | "completed" | "partial" | "retiring" | "failed";
  readonly agentKey: string | null;
  readonly declarationsProcessed: number;
  readonly declarationsTotal: number;
  readonly declarationsRetired: number;
  readonly d1Queries: number;
  readonly externalRequests: number;
  readonly errorCode: string | null;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

function agentPriority(agentId: string, resources: readonly NormalizedCatalogResource[]): number {
  const curated = CURATED_INVENTORY.entries.find((entry) => entry.agentId === agentId);
  if (curated) return curated.operator === "marketplace" ? 100 : 90;
  if (resources.some(({ validationProtocol, eligibility }) => validationProtocol === "erc8183_http" && eligibility === "eligible")) return 80;
  if (resources.some(({ validationProtocol, eligibility }) => validationProtocol === "mcp" && eligibility === "eligible")) return 60;
  if (resources.some(({ validationProtocol, eligibility }) => validationProtocol === "a2a" && eligibility === "eligible")) return 40;
  return 20;
}

function categories(agentId: string): string[] {
  return CURATED_INVENTORY.entries.find((entry) => entry.agentId === agentId)
    ?.categories.map(({ category }) => category) ?? [];
}

async function preparedAgent(agent: CatalogAgent) {
  const resources = await Promise.all((agent.indexEndpoints ?? []).map(normalizeCatalogResource));
  const uniqueResources = [...new Map(resources.map((resource) => [resource.endpointKey, resource])).values()];
  const metadataVersion = await catalogMetadataVersion(agent);
  return { agent, resources: uniqueResources, metadataVersion, priority: agentPriority(agent.agentId, uniqueResources) };
}

export async function enqueueCatalogDiscoveryPage(
  dbBinding: D1DatabaseLike,
  agents: readonly CatalogAgent[],
  input: {
    readonly nowMs: number;
    readonly source: DiscoverySource;
    readonly cursor?: number;
    readonly cursorKey?: "catalog_sweep_offset";
    /** Monotonic trust8004 high-water marker committed with the page/worklist. */
    readonly headerHighWater?: string;
  },
): Promise<CatalogDiscoverySummary> {
  const uniqueAgents = [...new Map(agents.map((agent) => [agent.agentId, agent])).values()];
  const prepared = await Promise.all(uniqueAgents.map(preparedAgent));
  const db = createDatabase(dbBinding);
  const agentKeys = prepared.map(({ agent }) => `eip155:56:${agent.agentId}`);
  const [existingAgents, existingTasks] = agentKeys.length === 0 ? [[], []] : await Promise.all([
    db.select({
      agentKey: catalogAgents.agentKey,
      metadataVersion: catalogAgents.metadataVersion,
      firstSeenAt: catalogAgents.firstSeenAt,
      lastSeenAt: catalogAgents.lastSeenAt,
    }).from(catalogAgents).where(inArray(catalogAgents.agentKey, agentKeys)),
    db.select().from(catalogIngestTasks).where(inArray(catalogIngestTasks.agentKey, agentKeys)),
  ]);
  const agentsByKey = new Map(existingAgents.map((row) => [row.agentKey, row]));
  const tasksByKey = new Map(existingTasks.map((row) => [row.agentKey, row]));
  const agentRows = prepared.flatMap(({ agent, metadataVersion, priority }) => {
    const agentKey = `eip155:56:${agent.agentId}`;
    const existing = agentsByKey.get(agentKey);
    if (existing?.metadataVersion === metadataVersion
      && input.nowMs - existing.lastSeenAt < LAST_SEEN_REFRESH_MS) return [];
    return [{
      agentKey,
      agentId: agent.agentId,
      chainId: 56,
      owner: agent.owner,
      metadataUri: agent.metadataUri,
      blockNumber: agent.blockNumber,
      name: agent.name,
      description: agent.description,
      imageUrl: agent.imageUrl,
      categoriesJson: JSON.stringify(categories(agent.agentId)),
      marketplaceConfigured: 0,
      metadataState: agent.metadataAvailable ? "ok" : "other",
      indexState: "current",
      registeredAt: agent.registeredAt,
      firstSeenAt: existing?.firstSeenAt ?? input.nowMs,
      lastSeenAt: input.nowMs,
      priority,
      metadataVersion,
      metadataObservedAt: agent.metadataUpdatedAt ?? input.nowMs,
      policyVersion: 2,
    }];
  });
  const taskRows = prepared.flatMap(({ agent, resources, metadataVersion, priority }) => {
    if (!agent.metadataAvailable) return [];
    const agentKey = `eip155:56:${agent.agentId}`;
    const existing = tasksByKey.get(agentKey);
    if (existing?.metadataVersion === metadataVersion) return [];
    return [{
      agentKey,
      metadataVersion,
      nextDeclarationIndex: 0,
      declarationCount: resources.length,
      status: resources.length === 0 ? "retiring" : "pending",
      requestedBy: input.source,
      priority,
      generationStartedAt: input.nowMs,
      upstreamObservedAt: agent.metadataUpdatedAt,
      updatedAt: input.nowMs,
      attemptCount: 0,
      retryAt: 0,
      errorCode: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    }];
  });
  const statements = [
    ...chunks(agentRows, AGENT_CHUNK).map((rows) => db.insert(catalogAgents).values(rows).onConflictDoUpdate({
      target: catalogAgents.agentKey,
      set: {
        owner: sql.raw("excluded.owner"), metadataUri: sql.raw("excluded.metadataUri"),
        blockNumber: sql.raw("excluded.blockNumber"),
        name: sql.raw("excluded.name"), description: sql.raw("excluded.description"),
        imageUrl: sql.raw("excluded.imageUrl"), categoriesJson: sql.raw("excluded.categoriesJson"),
        metadataState: sql.raw("excluded.metadataState"), indexState: "current",
        registeredAt: sql.raw("excluded.registeredAt"), lastSeenAt: sql.raw("excluded.lastSeenAt"),
        priority: sql.raw("excluded.priority"), metadataVersion: sql.raw("excluded.metadataVersion"),
        metadataObservedAt: sql.raw("excluded.metadataObservedAt"), policyVersion: 2,
      },
    })),
    ...chunks(taskRows, TASK_CHUNK).map((rows) => db.insert(catalogIngestTasks).values(rows)
      .onConflictDoUpdate({
        target: catalogIngestTasks.agentKey,
        set: {
          metadataVersion: sql.raw("excluded.metadataVersion"), nextDeclarationIndex: 0,
          declarationCount: sql.raw("excluded.declarationCount"), status: sql.raw("excluded.status"),
          requestedBy: sql.raw("excluded.requestedBy"), priority: sql.raw("excluded.priority"),
          generationStartedAt: sql.raw("excluded.generationStartedAt"),
          upstreamObservedAt: sql.raw("excluded.upstreamObservedAt"), updatedAt: sql.raw("excluded.updatedAt"),
          attemptCount: 0, retryAt: 0, errorCode: null, leaseOwner: null, leaseExpiresAt: null,
        },
      })),
    ...(input.cursor === undefined || input.cursorKey === undefined ? [] : [
      db.insert(runtimeState).values({
        key: input.cursorKey,
        textValue: null,
        integerValue: input.cursor,
        updatedAt: input.nowMs,
      }).onConflictDoUpdate({
        target: runtimeState.key,
        set: { textValue: null, integerValue: input.cursor, updatedAt: input.nowMs },
      }),
    ]),
    ...(input.headerHighWater === undefined ? [] : [
      db.insert(runtimeState).values({
        key: "header_high_water",
        textValue: input.headerHighWater,
        integerValue: null,
        updatedAt: input.nowMs,
      }).onConflictDoUpdate({
        target: runtimeState.key,
        set: { textValue: input.headerHighWater, integerValue: null, updatedAt: input.nowMs },
      }),
    ]),
  ];
  if (statements.length > 0) await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  return {
    agentsSeen: uniqueAgents.length,
    identitiesWritten: agentRows.length,
    tasksQueued: taskRows.length,
    cursor: input.cursor ?? null,
    d1Queries: (agentKeys.length === 0 ? 0 : 2) + statements.length,
    d1RowsWritten: agentRows.length + taskRows.length
      + (input.cursor === undefined ? 0 : 1)
      + (input.headerHighWater === undefined ? 0 : 1),
  };
}

function safeError(error: unknown): string {
  if (error instanceof CatalogHttpError && error.status === 404) return "TRUST8004_NOT_INDEXED";
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(name) ? name.toUpperCase() : "CATALOG_INGEST_FETCH_FAILED";
}

export async function processNextCatalogIngestTask(
  dbBinding: D1DatabaseLike,
  input: {
    readonly nowMs: number;
    readonly maxDeclarations: number;
    readonly fetchAgent: (agentId: string) => Promise<CatalogAgent>;
    readonly leaseOwner?: string;
  },
): Promise<CatalogIngestSummary> {
  if (!Number.isSafeInteger(input.maxDeclarations) || input.maxDeclarations < 1 || input.maxDeclarations > 24) {
    throw new Error("CATALOG_INGEST_LIMIT");
  }
  const db = createDatabase(dbBinding);
  const candidates = await db.select().from(catalogIngestTasks).where(and(
    inArray(catalogIngestTasks.status, ["pending", "retiring", "failed"]),
    lte(catalogIngestTasks.retryAt, input.nowMs),
    or(isNull(catalogIngestTasks.leaseOwner), lte(catalogIngestTasks.leaseExpiresAt, input.nowMs)),
  )).orderBy(desc(catalogIngestTasks.priority), asc(catalogIngestTasks.updatedAt), catalogIngestTasks.agentKey).limit(1);
  const task = candidates[0];
  if (!task) return {
    status: "idle", agentKey: null, declarationsProcessed: 0, declarationsTotal: 0,
    declarationsRetired: 0, d1Queries: 1, externalRequests: 0, errorCode: null,
  };
  const leaseOwner = input.leaseOwner ?? crypto.randomUUID();
  const claimed = await db.update(catalogIngestTasks).set({
    leaseOwner,
    leaseExpiresAt: input.nowMs + LEASE_MS,
    attemptCount: sql`${catalogIngestTasks.attemptCount} + 1`,
    status: task.status === "failed" ? "pending" : task.status,
  }).where(and(
    eq(catalogIngestTasks.agentKey, task.agentKey),
    eq(catalogIngestTasks.metadataVersion, task.metadataVersion),
    or(isNull(catalogIngestTasks.leaseOwner), lte(catalogIngestTasks.leaseExpiresAt, input.nowMs)),
  )).returning();
  const active = claimed[0];
  if (!active) return {
    status: "idle", agentKey: null, declarationsProcessed: 0, declarationsTotal: 0,
    declarationsRetired: 0, d1Queries: 2, externalRequests: 0, errorCode: null,
  };

  if (active.status === "retiring") {
    const old = await db.select({ endpointKey: catalogAgentEndpoints.endpointKey })
      .from(catalogAgentEndpoints).where(and(
        eq(catalogAgentEndpoints.agentKey, active.agentKey),
        eq(catalogAgentEndpoints.declarationState, "current"),
        or(isNull(catalogAgentEndpoints.metadataVersion), ne(catalogAgentEndpoints.metadataVersion, active.metadataVersion)),
      )).orderBy(catalogAgentEndpoints.endpointKey).limit(input.maxDeclarations);
    const complete = old.length < input.maxDeclarations;
    await db.batch([
      ...(old.length === 0 ? [] : [db.update(catalogAgentEndpoints).set({ declarationState: "removed" })
        .where(and(
          eq(catalogAgentEndpoints.agentKey, active.agentKey),
          inArray(catalogAgentEndpoints.endpointKey, old.map(({ endpointKey }) => endpointKey)),
        ))]),
      db.update(catalogIngestTasks).set({
        status: complete ? "completed" : "retiring",
        updatedAt: input.nowMs,
        errorCode: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      }).where(and(
        eq(catalogIngestTasks.agentKey, active.agentKey),
        eq(catalogIngestTasks.metadataVersion, active.metadataVersion),
        eq(catalogIngestTasks.leaseOwner, leaseOwner),
      )),
      ...(complete ? [db.update(catalogDirectedTracking).set({
        status: "listed", listedAt: input.nowMs, updatedAt: input.nowMs, errorCode: null,
      }).where(eq(catalogDirectedTracking.agentKey, active.agentKey))] : []),
    ] as unknown as Parameters<typeof db.batch>[0]);
    return {
      status: complete ? "completed" : "retiring",
      agentKey: active.agentKey,
      declarationsProcessed: active.nextDeclarationIndex,
      declarationsTotal: active.declarationCount,
      declarationsRetired: old.length,
      d1Queries: 4 + (old.length === 0 ? 0 : 1) + (complete ? 1 : 0),
      externalRequests: 0,
      errorCode: null,
    };
  }

  const agentId = active.agentKey.split(":").at(-1)!;
  let agent: CatalogAgent;
  try {
    agent = await input.fetchAgent(agentId);
  } catch (error) {
    const errorCode = safeError(error);
    await db.update(catalogIngestTasks).set({
      status: "failed",
      retryAt: input.nowMs + (active.requestedBy === "directed"
        ? Math.min(5 * 60_000, 10_000 * (2 ** Math.min(5, Math.max(0, active.attemptCount - 1))))
        : Math.min(24 * 60 * 60_000, 60 * 60_000 * Math.max(1, active.attemptCount))),
      updatedAt: input.nowMs,
      errorCode,
      leaseOwner: null,
      leaseExpiresAt: null,
    }).where(and(
      eq(catalogIngestTasks.agentKey, active.agentKey),
      eq(catalogIngestTasks.leaseOwner, leaseOwner),
    ));
    if (active.requestedBy === "directed") {
      await db.update(catalogDirectedTracking).set({ errorCode, updatedAt: input.nowMs })
        .where(eq(catalogDirectedTracking.agentKey, active.agentKey));
    }
    return {
      status: "failed", agentKey: active.agentKey, declarationsProcessed: 0,
      declarationsTotal: active.declarationCount, declarationsRetired: 0,
      d1Queries: active.requestedBy === "directed" ? 4 : 3, externalRequests: 1, errorCode,
    };
  }
  const current = await preparedAgent(agent);
  const generationChanged = current.metadataVersion !== active.metadataVersion;
  const start = generationChanged ? 0 : active.nextDeclarationIndex;
  const selected = current.resources.slice(start, start + input.maxDeclarations);
  const next = start + selected.length;
  const declarationsComplete = next >= current.resources.length;
  const originKeys = [...new Set(selected
    .map(({ originKey }) => originKey)
    .filter((value): value is string => value !== null))];
  const existingOrigins = originKeys.length === 0 ? [] : await db.select({
    originKey: catalogEndpoints.originKey,
    protocol: catalogEndpoints.validationProtocol,
    representativeAgentKey: catalogEndpoints.representativeAgentKey,
  }).from(catalogEndpoints).where(inArray(catalogEndpoints.originKey, originKeys))
    .orderBy(desc(catalogEndpoints.representativeAgentKey));
  const existingByKey = new Map<string, string>();
  for (const entry of existingOrigins) {
    if (!entry.originKey || !entry.protocol || !entry.representativeAgentKey) continue;
    const key = `${entry.originKey}:${entry.protocol}`;
    if (!existingByKey.has(key)) existingByKey.set(key, entry.representativeAgentKey);
  }
  const endpointRows = selected.map((resource) => ({
    ...resource,
    representativeAgentKey: resource.eligibility === "eligible" && resource.originKey && resource.validationProtocol
      ? (() => {
        const existingRepresentative = existingByKey.get(`${resource.originKey}:${resource.validationProtocol}`);
        return existingRepresentative === undefined || existingRepresentative === active.agentKey
          ? existingRepresentative ?? active.agentKey
          : null;
      })()
      : null,
    nextProbeAt: resource.eligibility === "eligible" ? input.nowMs : null,
  }));
  const relationRows = selected.map((resource) => ({
    agentKey: active.agentKey,
    endpointKey: resource.endpointKey,
    declarationState: "current",
    firstSeenAt: input.nowMs,
    lastSeenAt: input.nowMs,
    priority: current.priority,
    rawServiceLabel: resource.rawServiceLabel,
    rawSource: resource.rawSource,
    rawSourceIndex: resource.rawSourceIndex,
    metadataVersion: current.metadataVersion,
  }));
  const commerce = current.resources.find((resource) => resource.eligibility === "eligible"
    && resource.validationProtocol === "erc8183_http")
    ?? (CURATED_INVENTORY.entries.find((entry) => entry.agentId === agentId)?.operator === "marketplace"
      ? current.resources.find((resource) => resource.eligibility === "eligible" && resource.validationProtocol === "a2a")
      : undefined);
  const admissionStatements = !declarationsComplete ? [] : commerce ? [db.insert(catalogAgentAdmission).values({
    agentKey: active.agentKey,
    state: "candidate",
    commerceTransport: commerce.validationProtocol as "a2a" | "erc8183_http",
    endpointKey: commerce.endpointKey,
    chainId: 56,
    provider: null,
    validatedAt: null,
    configurationVersion: `metadata:${current.metadataVersion}`,
    reasonCode: "QUOTE_VERIFICATION_REQUIRED",
  }).onConflictDoUpdate({
    target: catalogAgentAdmission.agentKey,
    set: {
      state: sql`CASE WHEN ${catalogAgentAdmission.state} = 'admitted'
        AND ${catalogAgentAdmission.endpointKey} = excluded.endpointKey THEN 'admitted' ELSE 'candidate' END`,
      commerceTransport: sql.raw("excluded.commerceTransport"), endpointKey: sql.raw("excluded.endpointKey"),
      provider: sql`CASE WHEN ${catalogAgentAdmission.state} = 'admitted'
        AND ${catalogAgentAdmission.endpointKey} = excluded.endpointKey THEN ${catalogAgentAdmission.provider} ELSE NULL END`,
      validatedAt: sql`CASE WHEN ${catalogAgentAdmission.state} = 'admitted'
        AND ${catalogAgentAdmission.endpointKey} = excluded.endpointKey THEN ${catalogAgentAdmission.validatedAt} ELSE NULL END`,
      configurationVersion: sql.raw("excluded.configurationVersion"),
      reasonCode: sql`CASE WHEN ${catalogAgentAdmission.state} = 'admitted'
        AND ${catalogAgentAdmission.endpointKey} = excluded.endpointKey THEN NULL ELSE 'QUOTE_VERIFICATION_REQUIRED' END`,
    },
  })] : [db.update(catalogAgentAdmission).set({
    state: "suspended",
    commerceTransport: null,
    endpointKey: null,
    provider: null,
    validatedAt: null,
    configurationVersion: `metadata:${current.metadataVersion}`,
    reasonCode: "NO_COMMERCE_ENDPOINT",
  }).where(eq(catalogAgentAdmission.agentKey, active.agentKey))];
  const statements = [
    db.insert(catalogAgents).values({
      agentKey: active.agentKey,
      agentId,
      chainId: 56,
      owner: agent.owner,
      metadataUri: agent.metadataUri,
      blockNumber: agent.blockNumber,
      name: agent.name,
      description: agent.description,
      imageUrl: agent.imageUrl,
      categoriesJson: JSON.stringify(categories(agentId)),
      marketplaceConfigured: 0,
      metadataState: agent.metadataAvailable ? "ok" : "other",
      indexState: "current",
      registeredAt: agent.registeredAt,
      firstSeenAt: input.nowMs,
      lastSeenAt: input.nowMs,
      priority: current.priority,
      metadataVersion: current.metadataVersion,
      metadataObservedAt: agent.metadataUpdatedAt ?? input.nowMs,
      policyVersion: 2,
    }).onConflictDoUpdate({
      target: catalogAgents.agentKey,
      set: {
        owner: agent.owner, metadataUri: agent.metadataUri, blockNumber: agent.blockNumber,
        name: agent.name, description: agent.description, imageUrl: agent.imageUrl,
        categoriesJson: JSON.stringify(categories(agentId)), metadataState: agent.metadataAvailable ? "ok" : "other",
        indexState: "current", registeredAt: agent.registeredAt, lastSeenAt: input.nowMs,
        priority: current.priority, metadataVersion: current.metadataVersion,
        metadataObservedAt: agent.metadataUpdatedAt ?? input.nowMs, policyVersion: 2,
      },
    }),
    ...chunks(endpointRows, ENDPOINT_CHUNK).map((rows) => db.insert(catalogEndpoints).values(rows)
      .onConflictDoUpdate({
        target: catalogEndpoints.endpointKey,
        set: {
          protocol: sql.raw("excluded.protocol"), endpoint: sql.raw("excluded.endpoint"),
          originKey: sql.raw("excluded.originKey"), safety: sql.raw("excluded.safety"),
          safetyReason: sql.raw("excluded.safetyReason"), declaredProtocol: sql.raw("excluded.declaredProtocol"),
          role: sql.raw("excluded.role"), validationProtocol: sql.raw("excluded.validationProtocol"),
          externalKind: sql.raw("excluded.externalKind"), eligibility: sql.raw("excluded.eligibility"),
          representativeAgentKey: sql`COALESCE(${catalogEndpoints.representativeAgentKey}, excluded.representativeAgentKey)`,
          nextProbeAt: sql`CASE WHEN excluded.eligibility = 'eligible'
            THEN MIN(COALESCE(${catalogEndpoints.nextProbeAt}, excluded.nextProbeAt), excluded.nextProbeAt) ELSE NULL END`,
        },
      })),
    ...chunks(relationRows, RELATION_CHUNK).map((rows) => db.insert(catalogAgentEndpoints).values(rows)
      .onConflictDoUpdate({
        target: [catalogAgentEndpoints.agentKey, catalogAgentEndpoints.endpointKey],
        set: {
          declarationState: "current", lastSeenAt: input.nowMs, priority: current.priority,
          rawServiceLabel: sql.raw("excluded.rawServiceLabel"), rawSource: sql.raw("excluded.rawSource"),
          rawSourceIndex: sql.raw("excluded.rawSourceIndex"), metadataVersion: current.metadataVersion,
        },
      })),
    ...admissionStatements,
    db.update(catalogIngestTasks).set({
      metadataVersion: current.metadataVersion,
      nextDeclarationIndex: next,
      declarationCount: current.resources.length,
      status: declarationsComplete ? "retiring" : "pending",
      generationStartedAt: generationChanged ? input.nowMs : active.generationStartedAt,
      upstreamObservedAt: agent.metadataUpdatedAt,
      updatedAt: input.nowMs,
      retryAt: 0,
      errorCode: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    }).where(and(
      eq(catalogIngestTasks.agentKey, active.agentKey),
      eq(catalogIngestTasks.leaseOwner, leaseOwner),
    )),
  ];
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  return {
    status: declarationsComplete ? "retiring" : "partial",
    agentKey: active.agentKey,
    declarationsProcessed: selected.length,
    declarationsTotal: current.resources.length,
    declarationsRetired: 0,
    d1Queries: 3 + statements.length,
    externalRequests: 1,
    errorCode: null,
  };
}
