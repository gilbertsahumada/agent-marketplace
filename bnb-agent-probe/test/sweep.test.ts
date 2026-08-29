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

interface RecordedStatement {
  query: string;
  values: readonly unknown[];
}

class SweepDatabase implements D1DatabaseLike {
  state = new Map<string, number>([["sweep_offset", 0], ["sweep_round", 0]]);
  targets: Array<Record<string, unknown>> = [];
  batches: RecordedStatement[][] = [];
  failBatch = false;
  liveRows: string[] = [];
  candidateReadSizes: number[] = [];

  prepare(query: string): D1PreparedStatementLike {
    let values: readonly unknown[] = [];
    const database = this;
    const normalized = query.replaceAll('"', "").toLowerCase();
    return {
      bind(...nextValues) {
        values = nextValues;
        return this;
      },
      async first<Row>() {
        return null as Row | null;
      },
      async all<Row>(): Promise<D1ResultLike<unknown, Row>> {
        if (normalized.includes("from runtime_state")) {
          return {
            success: true,
            meta: {},
            results: [...database.state].map(([key, integerValue]) => ({
              key,
              textValue: null,
              integerValue,
              updatedAt: 0,
            })) as Row[],
          };
        }
        if (normalized.includes("with live_agent_ids")) {
          const offset = Number(values.at(-1));
          const limit = Number(values.at(-2));
          const curated = values.slice(0, -2).map(String);
          const ids = [...new Set([...database.liveRows, ...curated])]
            .sort((left, right) => left.length - right.length || left.localeCompare(right));
          return {
            success: true,
            meta: {},
            results: ids.slice(offset, offset + limit).map((agentId) => ({ agentId })) as Row[],
          };
        }
        if (normalized.includes("from probe_targets")) {
          database.candidateReadSizes.push(values.length);
          const ids = new Set(values.slice(1).map(String));
          return {
            success: true,
            meta: {},
            results: database.targets.filter((target) => ids.has(String(target.agentId))) as Row[],
          };
        }
        throw new Error(`Unexpected read: ${query}`);
      },
      async run<Meta>(): Promise<D1ResultLike<Meta>> {
        throw new Error("SWEEP writes must use batch");
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
  }

  async batch<Meta>(
    statements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1ResultLike<Meta>[]> {
    const recorded = statements as unknown as RecordedStatement[];
    void recorded;
    if (this.failBatch) throw new Error("simulated atomic batch failure");
    // Statements are opaque by contract, so tests wrap prepare below to record them.
    return statements.map(() => ({ success: true, meta: {} as Meta }));
  }
}

function recordingDatabase(database: SweepDatabase): SweepDatabase {
  const prepare = database.prepare.bind(database);
  database.prepare = (query: string) => {
    let values: readonly unknown[] = [];
    const statement = prepare(query);
    const wrapped: D1PreparedStatementLike & RecordedStatement = {
      query,
      get values() {
        return values;
      },
      bind(...nextValues) {
        values = nextValues;
        statement.bind(...nextValues);
        return wrapped;
      },
      first: statement.first.bind(statement),
      all: statement.all.bind(statement),
      run: statement.run.bind(statement),
      raw: statement.raw!.bind(statement),
    };
    return wrapped;
  };
  database.batch = async <Meta>(statements: readonly D1PreparedStatementLike[]) => {
    const batch = statements as Array<D1PreparedStatementLike & RecordedStatement>;
    database.batches.push(batch.map(({ query, values }) => ({ query, values })));
    if (database.failBatch) throw new Error("simulated atomic batch failure");
    return statements.map(() => ({ success: true, meta: {} as Meta }));
  };
  return database;
}

const target = (overrides: Record<string, unknown> = {}) => ({
  agentId: "16",
  chainId: 56,
  transport: "erc8183_http",
  endpoint: "https://seller.example/erc8183",
  name: "Seller",
  categoriesJson: "[]",
  categoryProvenance: null,
  declarationState: "current",
  currentMetadataUpdatedAt: 100,
  lastMetadataCheckedAt: 1_000,
  firstSeenAt: 1_000,
  lastChangedAt: 1_000,
  lastSeenAt: 1_000,
  priority: 0,
  ...overrides,
});

const okResult = (overrides: Partial<Extract<SweepAgentResult, { status: "ok" }>> = {}) => ({
  status: "ok" as const,
  agentId: "16",
  name: "Seller",
  metadataUpdatedAt: 100,
  targets: [{
    transport: "erc8183_http" as const,
    endpoint: "https://seller.example/erc8183",
    categoriesJson: "[]",
    categoryProvenance: null,
  }],
  ...overrides,
});

function dependencies(results: readonly SweepAgentResult[], complete = false) {
  return {
    listLiveAgentPage: async ({ offset }: { offset: number; limit: number }) => ({
      agentIds: ["16"],
      nextOffset: offset + 1,
      complete,
    }),
    fetchAgents: async () => results,
  };
}

describe("WP2 SWEEP", () => {
  it("builds a numerically ordered live page from current ERC-8183 and curated IDs", async () => {
    const db = new SweepDatabase();
    db.liveRows = ["100", "2", "30"];
    const readPage = createD1LiveAgentPageReader(db, ["9", "2"]);

    await expect(readPage({ offset: 1, limit: 2 })).resolves.toEqual({
      agentIds: ["9", "30"],
      nextOffset: 3,
      complete: false,
    });
  });

  it("writes target changes and the non-final cursor in one batch", async () => {
    const db = recordingDatabase(new SweepDatabase());
    db.targets = [target()];

    const summary = await runSweepPhase(
      { db, limit: 25, nowMs: 2_000, queryBudget: { remaining: 20 }, requestBudget: { remaining: 25 } },
      dependencies([okResult({ name: "Renamed" })]),
    );

    expect(summary).toMatchObject({
      changedTargets: 1,
      nextOffset: 1,
      complete: false,
      d1Queries: 7,
      batchQueries: 4,
    });
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]).toHaveLength(4);
    expect(db.batches[0]?.map((statement) => statement.query)).toEqual([
      expect.stringContaining('insert into "probe_targets"'),
      expect.stringContaining('insert into "runtime_state"'),
      expect.stringContaining('insert into "runtime_state"'),
      expect.stringContaining('insert into "runtime_state"'),
    ]);
    expect(db.batches[0]?.at(-1)?.values).toContain("probe");
  });

  it("keeps an absent declared endpoint visible as removed", async () => {
    const db = recordingDatabase(new SweepDatabase());
    db.targets = [target()];

    const summary = await runSweepPhase(
      { db, limit: 25, nowMs: 2_000, queryBudget: { remaining: 20 }, requestBudget: { remaining: 25 } },
      dependencies([okResult({ targets: [] })]),
    );

    expect(summary.removedTargets).toBe(1);
    expect(db.batches[0]?.[0]?.query).toContain('update "probe_targets"');
    expect(db.batches[0]?.[0]?.values[0]).toBe("removed");
    expect(db.batches[0]?.[0]?.query.toLowerCase()).not.toContain("delete");
  });

  it("does not perform a material target write on an identical rerun", async () => {
    const db = recordingDatabase(new SweepDatabase());
    db.targets = [target()];

    const summary = await runSweepPhase(
      { db, limit: 25, nowMs: 2_000, queryBudget: { remaining: 20 }, requestBudget: { remaining: 25 } },
      dependencies([okResult()]),
    );

    expect(summary.changedTargets).toBe(0);
    expect(summary.removedTargets).toBe(0);
    expect(db.batches[0]).toHaveLength(3);
    expect(db.batches[0]?.every((statement) => !statement.query.includes("probe_targets"))).toBe(true);
  });

  it("fails before writes when the full batch exceeds the remaining D1 budget", async () => {
    const db = recordingDatabase(new SweepDatabase());

    await expect(runSweepPhase(
      { db, limit: 25, nowMs: 2_000, queryBudget: { remaining: 3 }, requestBudget: { remaining: 25 } },
      dependencies([okResult()]),
    )).rejects.toThrow("requires 4 D1 queries");

    expect(db.batches).toHaveLength(0);
  });

  it("fails before the first detail fetch when the trust8004 request budget is insufficient", async () => {
    const db = recordingDatabase(new SweepDatabase());
    let fetchCalls = 0;

    await expect(runSweepPhase(
      { db, limit: 25, nowMs: 2_000, queryBudget: { remaining: 20 }, requestBudget: { remaining: 1 } },
      {
        listLiveAgentPage: async () => ({
          agentIds: ["16", "17"],
          nextOffset: 2,
          complete: false,
        }),
        fetchAgents: async () => {
          fetchCalls += 1;
          return [];
        },
      },
    )).rejects.toThrow("requires 2 trust8004 requests");

    expect(fetchCalls).toBe(0);
    expect(db.batches).toHaveLength(0);
  });

  it("chunks candidate reads so no D1 query binds more than 100 agent IDs", async () => {
    const db = recordingDatabase(new SweepDatabase());
    const agentIds = Array.from({ length: 205 }, (_, index) => String(index + 1));
    const results = agentIds.map((agentId) => okResult({ agentId, targets: [] }));

    await runSweepPhase(
      { db, limit: 2_000, nowMs: 2_000, queryBudget: { remaining: 20 }, requestBudget: { remaining: 2_000 } },
      {
        listLiveAgentPage: async () => ({ agentIds, nextOffset: 205, complete: false }),
        fetchAgents: async () => results,
      },
    );

    expect(db.candidateReadSizes).toEqual([100, 100, 8]);
  });

  it("does not advance the cursor when fetch coverage is incomplete or batch fails", async () => {
    const incompleteDb = recordingDatabase(new SweepDatabase());
    await expect(runSweepPhase(
      { db: incompleteDb, limit: 25, nowMs: 2_000, queryBudget: { remaining: 20 }, requestBudget: { remaining: 25 } },
      dependencies([]),
    )).rejects.toThrow("response is incomplete");
    expect(incompleteDb.batches).toHaveLength(0);

    const failedDb = recordingDatabase(new SweepDatabase());
    failedDb.failBatch = true;
    await expect(runSweepPhase(
      { db: failedDb, limit: 25, nowMs: 2_000, queryBudget: { remaining: 20 }, requestBudget: { remaining: 25 } },
      dependencies([okResult({ name: "Renamed" })]),
    )).rejects.toThrow("simulated atomic batch failure");
    expect(failedDb.state.get("sweep_offset")).toBe(0);
  });

  it("resets offset, increments round and schedules probe at the end", async () => {
    const db = recordingDatabase(new SweepDatabase());
    db.state.set("sweep_offset", 25);
    db.state.set("sweep_round", 4);

    const summary = await runSweepPhase(
      { db, limit: 25, nowMs: 2_000, queryBudget: { remaining: 20 }, requestBudget: { remaining: 25 } },
      dependencies([okResult()], true),
    );

    expect(summary).toMatchObject({ nextOffset: 0, sweepRound: 5, complete: true });
    expect(db.batches[0]).toHaveLength(5);
    expect(db.batches[0]?.some((statement) => statement.values.includes("sweep_round"))).toBe(true);
    expect(db.batches[0]?.at(-1)?.values).toContain("probe");
  });

  it("preserves endpoints as metadata_unavailable instead of treating temporary absence as removal", async () => {
    const db = recordingDatabase(new SweepDatabase());
    db.targets = [target()];

    const summary = await runSweepPhase(
      { db, limit: 25, nowMs: 2_000, queryBudget: { remaining: 20 }, requestBudget: { remaining: 25 } },
      dependencies([{ status: "metadata_unavailable", agentId: "16" }]),
    );

    expect(summary).toMatchObject({ metadataUnavailableTargets: 1, removedTargets: 0 });
    expect(db.batches[0]?.[0]?.query).toContain('update "probe_targets"');
    expect(db.batches[0]?.[0]?.values[0]).toBe("metadata_unavailable");
  });
});
