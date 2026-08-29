import { describe, expect, it } from "vitest";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/db/client";
import {
  createD1LiveAgentPageReader,
  runSweepPhase,
  type SweepAgentResult,
} from "../src/phases/sweep";

type DeclarationState = "current" | "removed" | "metadata_unavailable";

interface StoredTarget {
  agentId: string;
  chainId?: number;
  transport: "a2a" | "erc8183_http";
  endpoint: string;
  name: string | null;
  categoriesJson: string;
  categoryProvenance: "derived:marketplace-inventory" | null;
  declarationState: DeclarationState;
  currentMetadataUpdatedAt: number | null;
  lastMetadataCheckedAt: number;
  firstSeenAt: number;
  lastChangedAt: number;
  lastSeenAt: number;
  priority: number;
}

interface MemoryStatement extends D1PreparedStatementLike {
  readonly query: string;
  readonly values: readonly unknown[];
}

/**
 * Minimal stateful D1 double for the SQL emitted by SWEEP. Unlike the older
 * recorder-only test double, batch updates affect the following invocation's
 * live-set query, which is the behavior needed to expose cursor drift.
 */
class StatefulSweepDatabase implements D1DatabaseLike {
  readonly runtime = new Map<string, number>([["sweep_offset", 0], ["sweep_round", 0]]);

  constructor(readonly targets: StoredTarget[]) {}

  prepare(query: string): D1PreparedStatementLike {
    const database = this;
    let values: readonly unknown[] = [];
    const normalized = query.replaceAll('"', "").toLowerCase();
    const statement: MemoryStatement = {
      query,
      get values() {
        return values;
      },
      bind(...nextValues) {
        values = nextValues;
        return statement;
      },
      async first<Row>() {
        return null as Row | null;
      },
      async all<Row>(): Promise<D1ResultLike<unknown, Row>> {
        if (normalized.includes("from runtime_state")) {
          return ok([...database.runtime].map(([key, integerValue]) => ({
            key, textValue: null, integerValue, updatedAt: 0,
          })) as Row[]);
        }

        if (normalized.includes("with live_agent_ids")) {
          const offset = Number(values.at(-1));
          const requested = Number(values.at(-2));
          const curated = values.slice(0, -2).map(String);
          const filtersMutableTargets = query.includes("transport = 'erc8183_http'")
            || query.includes("declarationState = 'current'");
          const eligible = database.targets
            .filter((target) => !filtersMutableTargets
              || (target.transport === "erc8183_http" && target.declarationState === "current"))
            .map((target) => target.agentId);
          const agentIds = [...new Set([...eligible, ...curated])]
            .sort((left, right) => left.length - right.length || left.localeCompare(right))
            .slice(offset, offset + requested);
          return ok(agentIds.map((agentId) => ({ agentId })) as Row[]);
        }

        if (normalized.includes("from probe_targets")) {
          const requestedIds = new Set(values.slice(1).map(String));
          return ok(database.targets.filter((target) => requestedIds.has(target.agentId)) as Row[]);
        }

        throw new Error(`Unexpected D1 read: ${query}`);
      },
      async run<Meta>(): Promise<D1ResultLike<Meta>> {
        throw new Error("SWEEP writes must remain batched");
      },
      async raw<Row extends unknown[]>(options?: { columnNames?: boolean }): Promise<Row[]> {
        const result = await this.all<Record<string, unknown>>();
        const rows = result.results ?? [];
        const output = rows.map((row) => normalized.includes("from probe_targets")
          ? [
              row.agentId, row.chainId ?? 56, row.transport, row.endpoint, row.name,
              row.categoriesJson, row.categoryProvenance, row.declarationState,
              row.currentMetadataUpdatedAt, row.lastMetadataCheckedAt, row.firstSeenAt,
              row.lastChangedAt, row.lastSeenAt, row.priority,
            ]
          : Object.values(row)) as Row[];
        if (options?.columnNames && rows[0]) output.unshift(Object.keys(rows[0]) as Row);
        return output;
      },
    };
    return statement;
  }

  async batch<Meta>(
    statements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1ResultLike<Meta>[]> {
    for (const opaque of statements) {
      const statement = opaque as MemoryStatement;
      const normalized = statement.query.replaceAll('"', "").toLowerCase();
      if (normalized.startsWith("update probe_targets") && statement.values[0] === "removed") {
        this.setDeclarationState(statement, "removed");
      } else if (normalized.startsWith("update probe_targets") && statement.values[0] === "metadata_unavailable") {
        this.setDeclarationState(statement, "metadata_unavailable");
      } else if (
        normalized.startsWith("insert into runtime_state")
        && typeof statement.values[2] === "number"
      ) {
        this.runtime.set(String(statement.values[0]), statement.values[2]);
      }
    }
    return statements.map(() => ({ success: true, meta: {} as Meta }));
  }

  private setDeclarationState(statement: MemoryStatement, state: DeclarationState): void {
    const agentId = String(statement.values[4]);
    const targets = this.targets.filter((candidate) => candidate.agentId === agentId
      && (state !== "metadata_unavailable" || candidate.declarationState === "current")
      && (state !== "removed" || candidate.declarationState !== "removed"));
    if (targets.length === 0) throw new Error("The batch updated an unknown target");
    for (const target of targets) target.declarationState = state;
  }
}

function ok<Row>(results: readonly Row[]): D1ResultLike<unknown, Row> {
  return { success: true, meta: {}, results };
}

function storedTarget(
  agentId: string,
  transport: StoredTarget["transport"] = "erc8183_http",
  declarationState: DeclarationState = "current",
): StoredTarget {
  return {
    agentId,
    transport,
    endpoint: `https://seller-${agentId}.example/${transport}`,
    name: `Seller ${agentId}`,
    categoriesJson: "[]",
    categoryProvenance: null,
    declarationState,
    currentMetadataUpdatedAt: 100,
    lastMetadataCheckedAt: 1_000,
    firstSeenAt: 1_000,
    lastChangedAt: 1_000,
    lastSeenAt: 1_000,
    priority: 0,
  };
}

function noTargets(agentIds: readonly string[]): readonly SweepAgentResult[] {
  return agentIds.map((agentId) => ({
    status: "ok",
    agentId,
    name: `Seller ${agentId}`,
    metadataUpdatedAt: 101,
    targets: [],
  }));
}

describe("WP2 review regressions: stable SWEEP live set", () => {
  it("does not skip IDs when the preceding page changes current targets to removed", async () => {
    const db = new StatefulSweepDatabase([
      storedTarget("1"),
      storedTarget("2"),
      storedTarget("3"),
    ]);
    const listLiveAgentPage = createD1LiveAgentPageReader(db, []);
    const fetchedAcrossRuns: string[] = [];

    for (let invocation = 0; invocation < 2; invocation += 1) {
      await runSweepPhase(
        {
          db,
          limit: 2,
          nowMs: 2_000 + invocation,
          queryBudget: { remaining: 30 },
          requestBudget: { remaining: 2 },
        },
        {
          listLiveAgentPage,
          fetchAgents: async ({ agentIds }) => {
            fetchedAcrossRuns.push(...agentIds);
            return noTargets(agentIds);
          },
        },
      );
    }

    expect(fetchedAcrossRuns).toEqual(["1", "2", "3"]);
  });

  it("keeps the current A2A target of an ERC-8183-eligible agent in the live set", async () => {
    const db = new StatefulSweepDatabase([
      storedTarget("7", "erc8183_http", "removed"),
      storedTarget("7", "a2a", "current"),
    ]);
    const listLiveAgentPage = createD1LiveAgentPageReader(db, []);

    await expect(listLiveAgentPage({ offset: 0, limit: 25 })).resolves.toMatchObject({
      agentIds: ["7"],
    });
  });
});
