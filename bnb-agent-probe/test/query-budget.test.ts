import { describe, expect, it } from "vitest";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/db/client";
import {
  createBudgetedD1Database,
  D1QueryBudgetExceededError,
} from "../src/db/query-budget";

class CountingDatabase implements D1DatabaseLike {
  executedQueries = 0;
  batchCalls = 0;

  prepare(_query: string): D1PreparedStatementLike {
    const database = this;
    return {
      bind() {
        return this;
      },
      async first<Row>() {
        database.executedQueries += 1;
        return { value: 1 } as Row;
      },
      async all<Row>() {
        database.executedQueries += 1;
        return { success: true, meta: {}, results: [] as Row[] };
      },
      async run<Meta>() {
        database.executedQueries += 1;
        return { success: true, meta: {} as Meta };
      },
    };
  }

  async batch<Meta>(
    statements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1ResultLike<Meta>[]> {
    this.batchCalls += 1;
    this.executedQueries += statements.length;
    return statements.map(() => ({ success: true, meta: {} as Meta }));
  }
}

describe("D1 per-invocation query budget", () => {
  it("allows exactly the configured number of individual queries", async () => {
    const raw = new CountingDatabase();
    const { db, budget } = createBudgetedD1Database(raw, 40);

    for (let index = 0; index < 40; index += 1) {
      await db.prepare("SELECT 1").first();
    }

    expect(budget.used).toBe(40);
    expect(budget.remaining).toBe(0);
    expect(raw.executedQueries).toBe(40);
  });

  it("rejects query 41 before accessing D1", async () => {
    const raw = new CountingDatabase();
    const { db } = createBudgetedD1Database(raw, 40);

    for (let index = 0; index < 40; index += 1) {
      await db.prepare("SELECT 1").first();
    }

    await expect(db.prepare("SELECT 1").first()).rejects.toBeInstanceOf(
      D1QueryBudgetExceededError,
    );
    expect(raw.executedQueries).toBe(40);
  });

  it("counts every statement in a batch and rejects it atomically before D1", async () => {
    const raw = new CountingDatabase();
    const { db, budget } = createBudgetedD1Database(raw, 40);
    await db.prepare("SELECT 1").first();
    const oversizedBatch = Array.from({ length: 40 }, () => db.prepare("INSERT"));

    await expect(db.batch(oversizedBatch)).rejects.toBeInstanceOf(
      D1QueryBudgetExceededError,
    );
    expect(budget.used).toBe(1);
    expect(raw.batchCalls).toBe(0);
    expect(raw.executedQueries).toBe(1);
  });

  it("rejects statements prepared outside the budgeted database", async () => {
    const raw = new CountingDatabase();
    const { db } = createBudgetedD1Database(raw, 40);

    await expect(db.batch([raw.prepare("INSERT")])).rejects.toThrow(
      "not prepared by this budgeted database",
    );
    expect(raw.batchCalls).toBe(0);
  });
});
