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
}

export function createBudgetedD1Database(
  database: D1DatabaseLike,
  queryLimit: number,
): BudgetedD1Database {
  const budget = new D1QueryBudget(queryLimit);
  const rawStatements = new WeakMap<object, D1PreparedStatementLike>();

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
        return raw.all<Row>();
      },
      async run<Meta>() {
        budget.reserve(1);
        return raw.run<Meta>();
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
      return database.batch<Meta>(raw);
    },
  };

  return { db, budget };
}
