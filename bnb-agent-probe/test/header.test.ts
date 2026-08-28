import { describe, expect, it, vi } from "vitest";
import {
  HeaderQueryBudgetExceededError,
  createD1HeaderPersistence,
  runHeader,
  type HeaderAgent,
  type HeaderCommit,
  type HeaderPersistence,
  type HeaderStoredTarget,
} from "../src/phases/header";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/db/client";

class MemoryHeaderPersistence implements HeaderPersistence {
  readonly stored = new Map<string, HeaderStoredTarget>();
  readonly loads: string[][] = [];
  readonly commits: HeaderCommit[] = [];
  failCommit = false;

  async loadExistingTargets(agentIds: readonly string[]): Promise<readonly HeaderStoredTarget[]> {
    this.loads.push([...agentIds]);
    return [...this.stored.values()].filter((target) => agentIds.includes(target.agentId));
  }

  async commitHeader(input: HeaderCommit): Promise<void> {
    if (this.failCommit) throw new Error("D1 batch failed");
    this.commits.push(input);
    for (const target of input.targetWrites) this.stored.set(key(target), target);
  }
}

function key(target: Pick<HeaderStoredTarget, "chainId" | "agentId" | "transport" | "endpoint">): string {
  return `${target.chainId}:${target.agentId}:${target.transport}:${target.endpoint}`;
}

function agent(overrides: Partial<HeaderAgent> = {}): HeaderAgent {
  return {
    chainId: 56,
    agentId: "900",
    registeredAt: 1_000,
    name: "Seller",
    metadataUpdatedAt: 900,
    declaresErc8183: true,
    targets: [{ transport: "erc8183_http", endpoint: "https://seller.example/quote" }],
    ...overrides,
  };
}

function setup<T extends HeaderPersistence = MemoryHeaderPersistence>(
  items: readonly unknown[],
  persistence = new MemoryHeaderPersistence() as unknown as T,
) {
  const parsed: string[] = [];
  const fetchNewestPage = vi.fn(async () => ({ items }));
  return {
    persistence,
    parsed,
    fetchNewestPage,
    dependencies: {
      fetchNewestPage,
      parseAgent(value: unknown, index: number) {
        parsed.push(`${index}:${String((value as HeaderAgent).agentId)}`);
        return value as HeaderAgent;
      },
      persistence,
      queryBudget: { remaining: 39 },
      now: () => 2_000,
    },
  };
}

describe("WP2 HEADER", () => {
  it("requests one newest page and processes every item after a known target", async () => {
    const persistence = new MemoryHeaderPersistence();
    const known = agent({ agentId: "1", registeredAt: 100 });
    persistence.stored.set(key({ ...known.targets[0]!, ...known }), {
      ...known.targets[0]!,
      chainId: 56,
      agentId: "1",
      name: "Seller",
      categoriesJson: "[]",
      categoryProvenance: null,
      declarationState: "current",
      currentMetadataUpdatedAt: 900,
      firstSeenAt: 100,
    });
    const fixture = setup([
      known,
      agent({ agentId: "2", registeredAt: 101 }),
      agent({ agentId: "3", registeredAt: 102 }),
    ], persistence);

    const summary = await runHeader(fixture.dependencies, { limit: 25 });

    expect(fixture.fetchNewestPage).toHaveBeenCalledOnce();
    expect(fixture.fetchNewestPage).toHaveBeenCalledWith(25);
    expect(fixture.parsed).toEqual(["0:1", "1:2", "2:3"]);
    expect(persistence.loads).toEqual([["1", "2", "3"]]);
    expect(summary.materialWrites).toBe(2);
    expect(persistence.commits[0]?.highWater).toBe("102:3");
  });

  it("uses agentId as the deterministic high-water tie breaker", async () => {
    const fixture = setup([
      agent({ agentId: "9", registeredAt: 100, targets: [] }),
      agent({ agentId: "10", registeredAt: 100, targets: [] }),
    ]);

    await runHeader(fixture.dependencies, { limit: 2, previousHighWater: "99:999" });

    expect(fixture.persistence.commits[0]?.highWater).toBe("100:10");
    expect(fixture.persistence.commits[0]?.summary.headerWindowExhausted).toBe(true);
  });

  it("preserves a previous high-water newer than the page", async () => {
    const fixture = setup([agent({ agentId: "1", registeredAt: 100, targets: [] })]);

    await runHeader(fixture.dependencies, { limit: 25, previousHighWater: "200:1" });

    expect(fixture.persistence.commits[0]?.highWater).toBe("200:1");
    expect(fixture.persistence.commits[0]?.summary.headerWindowExhausted).toBe(false);
  });

  it("assigns curated categories in canonical order and priority one", async () => {
    const fixture = setup([agent({
      agentId: "43129",
      targets: [
        { transport: "erc8183_http", endpoint: "https://seller.example/quote" },
        { transport: "a2a", endpoint: "https://seller.example/a2a" },
      ],
    })]);

    await runHeader(fixture.dependencies, { limit: 25 });

    expect(fixture.persistence.commits[0]?.targetWrites).toHaveLength(2);
    expect(fixture.persistence.commits[0]?.targetWrites[0]).toMatchObject({
      categoriesJson: JSON.stringify(["yield_optimisation", "health_factor_monitoring"]),
      categoryProvenance: "derived:marketplace-inventory",
      declarationState: "current",
      priority: 1,
    });
  });

  it("excludes a non-curated A2A-only agent from the Free live set", async () => {
    const fixture = setup([agent({
      declaresErc8183: false,
      targets: [{ transport: "a2a", endpoint: "https://seller.example/a2a" }],
    })]);

    const summary = await runHeader(fixture.dependencies, { limit: 25 });

    expect(summary.candidateTargets).toBe(0);
    expect(summary.materialWrites).toBe(0);
  });

  it("deduplicates targets and caps each agent at two", async () => {
    const fixture = setup([agent({
      targets: [
        { transport: "a2a", endpoint: "https://seller.example/a" },
        { transport: "a2a", endpoint: "https://seller.example/a" },
      ],
    })]);

    const summary = await runHeader(fixture.dependencies, { limit: 25 });

    expect(summary.materialWrites).toBe(1);
    expect(fixture.persistence.commits[0]?.targetWrites).toHaveLength(1);
  });

  it("performs zero material writes on an identical second execution", async () => {
    const fixture = setup([agent()]);

    const first = await runHeader(fixture.dependencies, { limit: 25 });
    const previousHighWater = fixture.persistence.commits[0]?.highWater ?? null;
    const second = await runHeader(fixture.dependencies, {
      limit: 25,
      previousHighWater,
    });

    expect(first.materialWrites).toBe(1);
    expect(second.materialWrites).toBe(0);
    expect(fixture.persistence.commits[1]?.targetWrites).toEqual([]);
    expect(fixture.persistence.loads).toHaveLength(2);
  });

  it("validates the whole page before performing the bounded read", async () => {
    const fixture = setup([
      agent({ agentId: "1" }),
      agent({ agentId: "invalid" }),
    ]);

    await expect(runHeader(fixture.dependencies, { limit: 25 })).rejects.toThrow(
      "HEADER_SCHEMA:items[1].agentId",
    );
    expect(fixture.parsed).toEqual(["0:1", "1:invalid"]);
    expect(fixture.persistence.loads).toEqual([]);
    expect(fixture.persistence.commits).toEqual([]);
  });

  it("rejects an oversized target lookup before database access", async () => {
    const items = Array.from({ length: 101 }, (_, index) => agent({
      agentId: String(index + 1),
      targets: [],
    }));
    const fixture = setup(items);

    await expect(runHeader(fixture.dependencies, { limit: 101 })).rejects.toThrow(
      "exceeds 100 bound parameters",
    );
    expect(fixture.persistence.loads).toEqual([]);
  });

  it("preflights all material and runtime writes while preserving release capacity", async () => {
    const fixture = setup([agent()]);
    fixture.dependencies.queryBudget.remaining = 4;

    await expect(runHeader(fixture.dependencies, { limit: 25 })).rejects.toEqual(
      new HeaderQueryBudgetExceededError(4, 5),
    );
    expect(fixture.persistence.commits).toEqual([]);
  });

  it("commits targets, summary, high-water and next phase atomically", async () => {
    const fixture = setup([agent()]);

    const summary = await runHeader(fixture.dependencies, { limit: 25 });
    const commit = fixture.persistence.commits[0];

    expect(commit).toMatchObject({
      highWater: "1000:900",
      nextSchedulerPhase: "sweep",
      summary,
    });
    expect(summary.d1Queries).toBe(5);
  });

  it("does not expose logical progress when the atomic batch fails", async () => {
    const fixture = setup([agent()]);
    fixture.persistence.failCommit = true;

    await expect(runHeader(fixture.dependencies, { limit: 25 })).rejects.toThrow("D1 batch failed");

    expect(fixture.persistence.commits).toEqual([]);
    expect(fixture.persistence.stored.size).toBe(0);
  });

  it("does not spend a target lookup query for an empty page", async () => {
    const fixture = setup([]);

    const summary = await runHeader(fixture.dependencies, { limit: 25 });

    expect(fixture.persistence.loads).toEqual([]);
    expect(summary.d1Queries).toBe(3);
    expect(fixture.persistence.commits[0]?.highWater).toBeNull();
  });
});

class RecordingStatement implements D1PreparedStatementLike {
  values: readonly unknown[] = [];

  constructor(
    readonly database: RecordingDatabase,
    readonly query: string,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<Row>(): Promise<Row | null> {
    return null;
  }

  async all<Row>(): Promise<D1ResultLike<unknown, Row>> {
    this.database.allCalls.push(this);
    return {
      success: this.database.selectSuccess,
      meta: {},
      results: this.database.selectRows as readonly Row[],
    };
  }

  async run<Meta>(): Promise<D1ResultLike<Meta>> {
    throw new Error("adapter must use batch");
  }
}

class RecordingDatabase implements D1DatabaseLike {
  readonly prepared: RecordingStatement[] = [];
  readonly allCalls: RecordingStatement[] = [];
  readonly batches: Array<readonly RecordingStatement[]> = [];
  selectSuccess = true;
  selectRows: readonly HeaderStoredTarget[] = [];
  batchFailureIndex: number | null = null;

  prepare(query: string): D1PreparedStatementLike {
    const statement = new RecordingStatement(this, query);
    this.prepared.push(statement);
    return statement;
  }

  async batch<Meta>(statements: readonly D1PreparedStatementLike[]): Promise<readonly D1ResultLike<Meta>[]> {
    const recorded = statements as readonly RecordingStatement[];
    this.batches.push(recorded);
    return recorded.map((_, index) => ({
      success: index !== this.batchFailureIndex,
      meta: {} as Meta,
    }));
  }
}

describe("D1 HEADER persistence adapter", () => {
  it("loads all existing targets with exactly one bounded IN query", async () => {
    const db = new RecordingDatabase();
    const persistence = createD1HeaderPersistence(db);

    await persistence.loadExistingTargets(["10", "20", "30"]);

    expect(db.allCalls).toHaveLength(1);
    expect(db.allCalls[0]?.query).toContain("agentId IN (?, ?, ?)");
    expect(db.allCalls[0]?.values).toEqual(["10", "20", "30"]);
  });

  it("rejects failed SELECT results", async () => {
    const db = new RecordingDatabase();
    db.selectSuccess = false;

    await expect(createD1HeaderPersistence(db).loadExistingTargets(["10"]))
      .rejects.toThrow("existing-target query failed");
  });

  it("writes targets and all runtime progress in one checked batch", async () => {
    const db = new RecordingDatabase();
    const persistence = createD1HeaderPersistence(db);
    const fixture = setup([agent()], persistence);

    await runHeader(fixture.dependencies, { limit: 25 });

    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]).toHaveLength(4);
    expect(db.batches[0]?.[0]?.query).toContain("INSERT INTO probe_targets");
    expect(db.batches[0]?.slice(1).map((statement) => statement.values[0])).toEqual([
      "header_high_water",
      "last_header_summary",
      "next_scheduler_phase",
    ]);
    expect(db.batches[0]?.[3]?.values[1]).toBe("sweep");
  });

  it("fits 25 agents with two changed targets each comfortably below 40 queries", async () => {
    const db = new RecordingDatabase();
    const persistence = createD1HeaderPersistence(db);
    const items = Array.from({ length: 25 }, (_, index) => agent({
      agentId: String(index + 1),
      registeredAt: 1_000 + index,
      targets: [
        { transport: "a2a", endpoint: `https://seller-${index}.example/a2a` },
        { transport: "erc8183_http", endpoint: `https://seller-${index}.example/quote` },
      ],
    }));
    const fixture = setup(items, persistence);

    const summary = await runHeader(fixture.dependencies, { limit: 25 });

    expect(summary.materialWrites).toBe(50);
    expect(summary.d1Queries).toBe(5);
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]).toHaveLength(4);
    const serializedTargets = db.batches[0]?.[0]?.values[0];
    expect(typeof serializedTargets).toBe("string");
    expect(JSON.parse(String(serializedTargets))).toHaveLength(50);
    expect(db.batches[0]?.[0]?.query).toContain("FROM json_each(?)");
  });

  it("rejects any unsuccessful batch statement", async () => {
    const db = new RecordingDatabase();
    db.batchFailureIndex = 2;
    const persistence = createD1HeaderPersistence(db);
    const fixture = setup([agent()], persistence);

    await expect(runHeader(fixture.dependencies, { limit: 25 }))
      .rejects.toThrow("D1 batch did not complete successfully");
  });
});
