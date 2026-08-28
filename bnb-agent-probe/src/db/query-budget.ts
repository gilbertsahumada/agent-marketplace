import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "./client";

export class D1QueryBudgetExceededError extends Error {
  constructor(
    readonly limit: number,
    readonly used: number,
    readonly requested: number,
  ) {
    super("D1 query budget exceeded before database access");
    this.name = "D1QueryBudgetExceededError";
  }
}

export class D1QueryBudget {
  private consumed = 0;

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("D1 query budget limit must be a positive safe integer");
    }
  }

  get used(): number {
    return this.consumed;
  }

  get remaining(): number {
    return this.limit - this.consumed;
  }

  reserve(queries: number): void {
    if (!Number.isSafeInteger(queries) || queries < 1) {
      throw new Error("D1 query reservation must be a positive safe integer");
    }
    if (queries > this.remaining) {
      throw new D1QueryBudgetExceededError(this.limit, this.used, queries);
    }
    this.consumed += queries;
  }
}

export interface BudgetedD1Database {
  db: D1DatabaseLike;
  budget: D1QueryBudget;
  usage: {
    readonly rowsRead: number;
    readonly rowsWritten: number;
  };
}

export function createBudgetedD1Database(
  database: D1DatabaseLike,
  queryLimit: number,
): BudgetedD1Database {
  const budget = new D1QueryBudget(queryLimit);
  const usage = { rowsRead: 0, rowsWritten: 0 };
  const rawStatements = new WeakMap<object, D1PreparedStatementLike>();

  const recordUsage = (meta: unknown): void => {
    if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return;
    const source = meta as Record<string, unknown>;
    usage.rowsRead += rowCount(source.rows_read);
    usage.rowsWritten += rowCount(source.rows_written);
  };

  const wrap = (raw: D1PreparedStatementLike): D1PreparedStatementLike => {
    const statement: D1PreparedStatementLike = {
      bind(...values) {
        return wrap(raw.bind(...values));
      },
      async first<Row>() {
        budget.reserve(1);
        return raw.first<Row>();
      },
      async all<Row>(): Promise<D1ResultLike<unknown, Row>> {
        budget.reserve(1);
        const result = await raw.all<Row>();
        recordUsage(result.meta);
        return result;
      },
      async run<Meta>() {
        budget.reserve(1);
        const result = await raw.run<Meta>();
        recordUsage(result.meta);
        return result;
      },
    };
    rawStatements.set(statement, raw);
    return statement;
  };

  const db: D1DatabaseLike = {
    prepare(query) {
      return wrap(database.prepare(query));
    },
    async batch<Meta>(statements: readonly D1PreparedStatementLike[]) {
      const raw = statements.map((statement) => {
        const unwrapped = rawStatements.get(statement);
        if (unwrapped === undefined) {
          throw new Error("D1 batch statement was not prepared by this budgeted database");
        }
        return unwrapped;
      });
      if (raw.length === 0) return [];
      budget.reserve(raw.length);
      const results = await database.batch<Meta>(raw);
      for (const result of results) recordUsage(result.meta);
      return results;
    },
  };

  return { db, budget, usage };
}

function rowCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
