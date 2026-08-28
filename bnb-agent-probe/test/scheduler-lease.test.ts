import { describe, expect, it } from "vitest";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/db/client";
import {
  acquireSchedulerLease,
  releaseSchedulerLease,
} from "../src/lib/scheduler-lease";

interface LeaseRow {
  textValue: string | null;
  integerValue: number;
  updatedAt: number;
}

class AtomicLeaseDatabase implements D1DatabaseLike {
  lease: LeaseRow | null = null;
  readonly queries: string[] = [];

  prepare(query: string): D1PreparedStatementLike {
    this.queries.push(query);
    return new LeaseStatement(this, query);
  }

  async batch<Meta = unknown>(
    _statements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1ResultLike<Meta>[]> {
    throw new Error("not implemented by lease fake");
  }
}

class LeaseStatement implements D1PreparedStatementLike {
  private values: readonly unknown[] = [];

  constructor(
    private readonly db: AtomicLeaseDatabase,
    private readonly query: string,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<Row = Record<string, unknown>>(): Promise<Row | null> {
    if (this.query.includes("INSERT INTO runtime_state")) {
      const [runId, expiresAt, updatedAt, now] = this.values as [string, number, number, number];
      if (this.db.lease === null || this.db.lease.integerValue <= now) {
        this.db.lease = { textValue: runId, integerValue: expiresAt, updatedAt };
        return { key: "scheduler_lease" } as Row;
      }
      return null;
    }

    if (this.query.includes("UPDATE runtime_state")) {
      const [expiresAt, updatedAt, runId] = this.values as [number, number, string];
      if (this.db.lease?.textValue !== runId) return null;
      this.db.lease = { textValue: null, integerValue: expiresAt, updatedAt };
      return { key: "scheduler_lease" } as Row;
    }

    throw new Error(`Unexpected query: ${this.query}`);
  }

  async all<Row = Record<string, unknown>>(): Promise<D1ResultLike<unknown, Row>> {
    return { success: true, meta: {}, results: [] };
  }

  async run<Meta = unknown>(): Promise<D1ResultLike<Meta>> {
    throw new Error("not implemented by lease fake");
  }
}

describe("scheduler lease", () => {
  it("uses one conditional upsert with RETURNING", async () => {
    const db = new AtomicLeaseDatabase();

    await expect(acquireSchedulerLease(db, {
      runId: "run-a",
      nowMs: 1_000,
      expiresAtMs: 10_000,
    })).resolves.toBe(true);

    const query = db.queries[0] ?? "";
    expect(query).toMatch(/INSERT INTO runtime_state/);
    expect(query).toMatch(/ON CONFLICT\(key\) DO UPDATE/);
    expect(query).toMatch(/WHERE runtime_state\.integerValue <= \?/);
    expect(query).toMatch(/RETURNING key/);
  });

  it("allows exactly one winner for concurrent acquisitions", async () => {
    const db = new AtomicLeaseDatabase();

    const results = await Promise.all([
      acquireSchedulerLease(db, { runId: "run-a", nowMs: 1_000, expiresAtMs: 10_000 }),
      acquireSchedulerLease(db, { runId: "run-b", nowMs: 1_000, expiresAtMs: 10_000 }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(db.lease?.textValue).toBe(results[0] ? "run-a" : "run-b");
  });

  it("allows takeover at expiry but not before it", async () => {
    const db = new AtomicLeaseDatabase();
    await acquireSchedulerLease(db, { runId: "run-a", nowMs: 1_000, expiresAtMs: 2_000 });

    await expect(acquireSchedulerLease(db, {
      runId: "run-b",
      nowMs: 1_999,
      expiresAtMs: 3_000,
    })).resolves.toBe(false);
    await expect(acquireSchedulerLease(db, {
      runId: "run-b",
      nowMs: 2_000,
      expiresAtMs: 3_000,
    })).resolves.toBe(true);
  });

  it("only releases a lease owned by the supplied runId", async () => {
    const db = new AtomicLeaseDatabase();
    await acquireSchedulerLease(db, { runId: "run-a", nowMs: 1_000, expiresAtMs: 10_000 });

    await expect(releaseSchedulerLease(db, "run-b", 1_500)).resolves.toBe(false);
    expect(db.lease?.textValue).toBe("run-a");
    await expect(releaseSchedulerLease(db, "run-a", 1_500)).resolves.toBe(true);
    expect(db.lease).toEqual({ textValue: null, integerValue: 1_500, updatedAt: 1_500 });
  });

  it("rejects invalid lease windows before accessing D1", async () => {
    const db = new AtomicLeaseDatabase();

    await expect(acquireSchedulerLease(db, {
      runId: "run-a",
      nowMs: 1_000,
      expiresAtMs: 1_000,
    })).rejects.toThrow("expiresAtMs must be later than nowMs");
    expect(db.queries).toEqual([]);
  });
});
