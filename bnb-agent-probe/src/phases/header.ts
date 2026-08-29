import {
  CURATED_INVENTORY,
  CURATED_INVENTORY_CATEGORIES,
  type CuratedInventoryCategory,
} from "../manifest/curated-inventory";
import {
  type D1DatabaseLike,
} from "../db/client";
import { sql } from "drizzle-orm";
import { createDatabase, readProbeTargetsByAgentIds } from "../db/orm";
import { probeTargets, runtimeState } from "../db/schema";

export type HeaderTransport = "a2a" | "erc8183_http";

export interface HeaderCandidateTarget {
  /** Already normalized and accepted by the shared WP2 safe-URL filter. */
  readonly transport: HeaderTransport;
  readonly endpoint: string;
}

export interface HeaderAgent {
  readonly chainId: 56;
  readonly agentId: string;
  readonly registeredAt: number;
  readonly name: string | null;
  readonly metadataUpdatedAt: number | null;
  readonly declaresErc8183: boolean;
  readonly targets: readonly HeaderCandidateTarget[];
}

export interface HeaderStoredTarget {
  readonly chainId: 56;
  readonly agentId: string;
  readonly transport: HeaderTransport;
  readonly endpoint: string;
  readonly name: string | null;
  readonly categoriesJson: string;
  readonly categoryProvenance: "derived:marketplace-inventory" | null;
  readonly declarationState: "current" | "removed" | "metadata_unavailable";
  readonly currentMetadataUpdatedAt: number | null;
  readonly firstSeenAt: number;
}

export interface HeaderTargetWrite extends HeaderStoredTarget {
  readonly lastMetadataCheckedAt: number;
  readonly lastChangedAt: number;
  readonly lastSeenAt: number;
  readonly priority: 1;
}

export interface HeaderSummary {
  readonly phase: "header";
  readonly status: "ok";
  readonly requested: number;
  readonly received: number;
  readonly agentsValidated: number;
  readonly invalidItems: number;
  readonly candidateTargets: number;
  readonly materialWrites: number;
  readonly headerWindowExhausted: boolean;
  readonly requests: 1;
  readonly d1Queries: number;
  readonly wallTimeMs: number;
  readonly finishedAt: number;
}

export interface HeaderCommit {
  readonly targetWrites: readonly HeaderTargetWrite[];
  readonly highWater: string | null;
  readonly summary: HeaderSummary;
  readonly nextSchedulerPhase: "sweep";
  readonly completedQueueScheduledTime?: number;
}

export interface HeaderPersistence {
  /** One bounded query keyed by agentId; implementations must not query per item. */
  loadExistingTargets(agentIds: readonly string[]): Promise<readonly HeaderStoredTarget[]>;
  /** One atomic D1 batch containing every target write and all runtime-state writes. */
  commitHeader(input: HeaderCommit): Promise<void>;
}

export interface HeaderQueryBudget {
  readonly remaining: number;
  readonly used?: number;
}

export interface HeaderDependencies {
  fetchNewestPage(limit: number): Promise<{
    readonly items: readonly unknown[];
    readonly received?: number;
    readonly invalidItems?: number;
  }>;
  parseAgent(value: unknown, index: number): HeaderAgent;
  persistence: HeaderPersistence;
  queryBudget: HeaderQueryBudget;
  now?: () => number;
}

export interface RunHeaderOptions {
  readonly limit: number;
  readonly previousHighWater?: string | null;
  /** Queries needed after HEADER, normally the scheduler lease release. */
  readonly reserveQueriesAfterCommit?: number;
  readonly invocationQueriesAfterCommit?: number;
  readonly startedAtMs?: number;
  readonly completedQueueScheduledTime?: number;
}

export class HeaderQueryBudgetExceededError extends Error {
  constructor(
    readonly remaining: number,
    readonly required: number,
  ) {
    super("HEADER D1 query budget exceeded before writes");
    this.name = "HeaderQueryBudgetExceededError";
  }
}

const MAX_BOUND_AGENT_IDS = 100;
const TARGET_WRITES_PER_QUERY = 7;
const RUNTIME_STATE_WRITES = 1;

export function createD1HeaderPersistence(db: D1DatabaseLike): HeaderPersistence {
  return {
    async loadExistingTargets(agentIds) {
      if (agentIds.length === 0) return [];
      if (agentIds.length > MAX_BOUND_AGENT_IDS) {
        throw new Error(`HEADER target lookup exceeds ${MAX_BOUND_AGENT_IDS} bound parameters`);
      }
      return await readProbeTargetsByAgentIds(
        createDatabase(db), agentIds,
      ) as HeaderStoredTarget[];
    },
    async commitHeader(input) {
      const orm = createDatabase(db);
      const targetStatements = targetWriteChunks(input.targetWrites).map((targets) =>
        orm.insert(probeTargets).values(targets).onConflictDoUpdate({
          target: [probeTargets.chainId, probeTargets.agentId, probeTargets.transport, probeTargets.endpoint],
          set: {
            name: sql.raw("excluded.name"),
            categoriesJson: sql.raw("excluded.categoriesJson"),
            categoryProvenance: sql.raw("excluded.categoryProvenance"),
            declarationState: sql.raw("excluded.declarationState"),
            currentMetadataUpdatedAt: sql.raw("excluded.currentMetadataUpdatedAt"),
            lastMetadataCheckedAt: sql.raw("excluded.lastMetadataCheckedAt"),
            lastChangedAt: sql.raw("excluded.lastChangedAt"),
            lastSeenAt: sql.raw("excluded.lastSeenAt"),
            priority: sql.raw("excluded.priority"),
          },
        }));
      const runtimeStatement = orm.insert(runtimeState).values([
        { key: "header_high_water", textValue: input.highWater, integerValue: null, updatedAt: input.summary.finishedAt },
        { key: "last_header_summary", textValue: JSON.stringify(input.summary), integerValue: null, updatedAt: input.summary.finishedAt },
        { key: "next_scheduler_phase", textValue: input.nextSchedulerPhase, integerValue: null, updatedAt: input.summary.finishedAt },
      ]).onConflictDoUpdate({
        target: runtimeState.key,
        set: {
          textValue: sql.raw("excluded.textValue"),
          integerValue: sql.raw("excluded.integerValue"),
          updatedAt: sql.raw("excluded.updatedAt"),
        },
      });
      const completionStatement = input.completedQueueScheduledTime === undefined
        ? []
        : [orm.insert(runtimeState).values({
            key: "last_queue_scheduled_time", textValue: null,
            integerValue: input.completedQueueScheduledTime, updatedAt: input.summary.finishedAt,
          }).onConflictDoUpdate({
            target: runtimeState.key,
            set: {
              textValue: null,
              integerValue: sql.raw("excluded.integerValue"),
              updatedAt: sql.raw("excluded.updatedAt"),
            },
          })];
      await orm.batch(
        [...targetStatements, runtimeStatement, ...completionStatement] as unknown as Parameters<typeof orm.batch>[0],
      );
    },
  };
}

export async function runHeader(
  dependencies: HeaderDependencies,
  options: RunHeaderOptions,
): Promise<HeaderSummary> {
  assertPositiveInteger(options.limit, "limit");
  const reserveQueriesAfterCommit = options.reserveQueriesAfterCommit ?? 1;
  assertNonNegativeInteger(reserveQueriesAfterCommit, "reserveQueriesAfterCommit");

  const page = await dependencies.fetchNewestPage(options.limit);
  const received = page.received ?? page.items.length;
  const invalidItems = page.invalidItems ?? received - page.items.length;
  if (!Array.isArray(page.items)
    || !Number.isSafeInteger(received)
    || !Number.isSafeInteger(invalidItems)
    || received < page.items.length
    || received > options.limit
    || invalidItems < 0
    || invalidItems !== received - page.items.length) {
    throw new Error("HEADER page contains more items than requested");
  }

  // Validate the complete page before any database access. In particular, a
  // known agent never terminates this loop early.
  const agents = page.items.map((item, index) => {
    const agent = dependencies.parseAgent(item, index);
    validateAgent(agent, index);
    return agent;
  });
  const eligibleAgents = agents.map((agent) => {
    const categories = curatedCategories(agent.agentId);
    const targets = agent.declaresErc8183 || categories.length > 0
      ? agent.targets.slice(0, 2)
      : [];
    return { agent, categories, targets };
  });
  const agentIds = unique(eligibleAgents
    .filter(({ targets }) => targets.length > 0)
    .map(({ agent }) => agent.agentId));
  if (agentIds.length > MAX_BOUND_AGENT_IDS) {
    throw new Error(`HEADER target lookup exceeds ${MAX_BOUND_AGENT_IDS} bound parameters`);
  }

  const existing = agentIds.length === 0
    ? []
    : await dependencies.persistence.loadExistingTargets(agentIds);
  const existingByKey = new Map(existing.map((target) => [targetKey(target), target]));
  const finishedAt = (dependencies.now ?? Date.now)();
  assertNonNegativeInteger(finishedAt, "now");
  const candidateByKey = new Map<string, HeaderTargetWrite>();

  for (const { agent, categories, targets } of eligibleAgents) {
    for (const target of targets) {
      const key = targetKey({ ...agent, ...target });
      if (candidateByKey.has(key)) continue;
      const stored = existingByKey.get(key);
      const candidate: HeaderTargetWrite = {
        chainId: 56,
        agentId: agent.agentId,
        transport: target.transport,
        endpoint: target.endpoint,
        name: agent.name,
        categoriesJson: JSON.stringify(categories),
        categoryProvenance: categories.length > 0
          ? "derived:marketplace-inventory"
          : null,
        declarationState: "current",
        currentMetadataUpdatedAt: agent.metadataUpdatedAt,
        lastMetadataCheckedAt: finishedAt,
        firstSeenAt: stored?.firstSeenAt ?? finishedAt,
        lastChangedAt: finishedAt,
        lastSeenAt: finishedAt,
        priority: 1,
      };
      if (stored === undefined || materiallyChanged(stored, candidate)) {
        candidateByKey.set(key, candidate);
      }
    }
  }

  const targetWrites = [...candidateByKey.values()];
  const previousHighWater = parseHighWater(options.previousHighWater ?? null);
  const pageHighWater = agents.reduce<HighWater | null>((highest, agent) => {
    const current = { registeredAt: agent.registeredAt, agentId: agent.agentId };
    return highest === null || compareHighWater(current, highest) > 0 ? current : highest;
  }, null);
  const highWater = maximumHighWater(previousHighWater, pageHighWater);
  const headerWindowExhausted = previousHighWater !== null
    && received === options.limit
    && (invalidItems > 0 || agents.every((agent) => compareHighWater(agent, previousHighWater) > 0));
  const batchQueries = targetWriteChunks(targetWrites).length
    + RUNTIME_STATE_WRITES
    + (options.completedQueueScheduledTime === undefined ? 0 : 1);
  const requiredQueries = batchQueries + reserveQueriesAfterCommit;

  if (requiredQueries > dependencies.queryBudget.remaining) {
    throw new HeaderQueryBudgetExceededError(dependencies.queryBudget.remaining, requiredQueries);
  }

  const summary: HeaderSummary = {
    phase: "header",
    status: "ok",
    requested: options.limit,
    received,
    agentsValidated: agents.length,
    invalidItems,
    candidateTargets: eligibleAgents.reduce((total, { targets }) => total + targets.length, 0),
    materialWrites: targetWrites.length,
    headerWindowExhausted,
    requests: 1,
    d1Queries: dependencies.queryBudget.used === undefined
      ? (agentIds.length === 0 ? 0 : 1) + batchQueries
      : dependencies.queryBudget.used + batchQueries + (options.invocationQueriesAfterCommit ?? 0),
    wallTimeMs: Math.max(0, finishedAt - (options.startedAtMs ?? finishedAt)),
    finishedAt,
  };

  await dependencies.persistence.commitHeader({
    targetWrites,
    highWater: highWater === null ? null : formatHighWater(highWater),
    summary,
    nextSchedulerPhase: "sweep",
    ...(options.completedQueueScheduledTime === undefined
      ? {}
      : { completedQueueScheduledTime: options.completedQueueScheduledTime }),
  });
  return summary;
}

interface HighWater {
  readonly registeredAt: number;
  readonly agentId: string;
}

function validateAgent(agent: HeaderAgent, index: number): void {
  if (agent.chainId !== 56) throw new Error(`HEADER_SCHEMA:items[${index}].chainId`);
  if (!/^\d+$/.test(agent.agentId)) throw new Error(`HEADER_SCHEMA:items[${index}].agentId`);
  assertNonNegativeInteger(agent.registeredAt, `items[${index}].registeredAt`);
  if (agent.name !== null && typeof agent.name !== "string") {
    throw new Error(`HEADER_SCHEMA:items[${index}].name`);
  }
  if (agent.metadataUpdatedAt !== null) {
    assertNonNegativeInteger(agent.metadataUpdatedAt, `items[${index}].metadataUpdatedAt`);
  }
  if (typeof agent.declaresErc8183 !== "boolean") {
    throw new Error(`HEADER_SCHEMA:items[${index}].declaresErc8183`);
  }
  if (!Array.isArray(agent.targets) || agent.targets.length > 2) {
    throw new Error(`HEADER_SCHEMA:items[${index}].targets`);
  }
  for (const [targetIndex, target] of agent.targets.entries()) {
    if (target.transport !== "a2a" && target.transport !== "erc8183_http") {
      throw new Error(`HEADER_SCHEMA:items[${index}].targets[${targetIndex}].transport`);
    }
    if (typeof target.endpoint !== "string" || target.endpoint.length === 0) {
      throw new Error(`HEADER_SCHEMA:items[${index}].targets[${targetIndex}].endpoint`);
    }
  }
}

function curatedCategories(agentId: string): CuratedInventoryCategory[] {
  const entry = CURATED_INVENTORY.entries.find((candidate) => candidate.agentId === agentId);
  const assigned = new Set(entry?.categories.map(({ category }) => category) ?? []);
  return CURATED_INVENTORY_CATEGORIES.filter((category) => assigned.has(category));
}

function materiallyChanged(stored: HeaderStoredTarget, candidate: HeaderTargetWrite): boolean {
  return stored.name !== candidate.name
    || stored.categoriesJson !== candidate.categoriesJson
    || stored.categoryProvenance !== candidate.categoryProvenance
    || stored.declarationState !== candidate.declarationState
    || stored.currentMetadataUpdatedAt !== candidate.currentMetadataUpdatedAt;
}

function targetKey(target: Pick<HeaderStoredTarget, "chainId" | "agentId" | "transport" | "endpoint">): string {
  return `${target.chainId}\u0000${target.agentId}\u0000${target.transport}\u0000${target.endpoint}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function parseHighWater(value: string | null): HighWater | null {
  if (value === null) return null;
  const separator = value.indexOf(":");
  if (separator < 1) throw new Error("HEADER_STATE:header_high_water");
  const registeredAt = Number(value.slice(0, separator));
  const agentId = value.slice(separator + 1);
  assertNonNegativeInteger(registeredAt, "header_high_water.registeredAt");
  if (!/^\d+$/.test(agentId)) throw new Error("HEADER_STATE:header_high_water.agentId");
  return { registeredAt, agentId };
}

function formatHighWater(value: HighWater): string {
  return `${value.registeredAt}:${value.agentId}`;
}

function maximumHighWater(left: HighWater | null, right: HighWater | null): HighWater | null {
  if (left === null) return right;
  if (right === null) return left;
  return compareHighWater(left, right) >= 0 ? left : right;
}

function compareHighWater(left: HighWater, right: HighWater): number {
  if (left.registeredAt !== right.registeredAt) return left.registeredAt - right.registeredAt;
  const leftId = BigInt(left.agentId);
  const rightId = BigInt(right.agentId);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`HEADER_CONFIG:${label}`);
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`HEADER_CONFIG:${label}`);
}

function targetWriteChunks(targets: readonly HeaderTargetWrite[]): HeaderTargetWrite[][] {
  const chunks: HeaderTargetWrite[][] = [];
  for (let index = 0; index < targets.length; index += TARGET_WRITES_PER_QUERY) {
    chunks.push(targets.slice(index, index + TARGET_WRITES_PER_QUERY));
  }
  return chunks;
}
