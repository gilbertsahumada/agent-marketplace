import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/db/client";
import { healthResponse } from "../src/routes/health";
import { createWp2ScheduledRunner } from "../src/scheduled";
import type { D1Database, Env } from "../src/types";

type RuntimeRow = {
  key: string;
  textValue: string | null;
  integerValue: number | null;
  updatedAt: number;
};

class MemoryStatement implements D1PreparedStatementLike {
  private values: readonly unknown[] = [];

  constructor(
    readonly database: MemoryDatabase,
    readonly query: string,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<Row>(): Promise<Row | null> {
    if (this.query.includes("VALUES ('scheduler_lease'")) {
      const [runId, expiresAt, nowMs] = this.values;
      const lease = this.database.state.get("scheduler_lease");
      if (lease !== undefined && (lease.integerValue ?? 0) > Number(nowMs)) return null;
      this.database.seed("scheduler_lease", String(runId), Number(expiresAt), Number(nowMs));
      return { key: "scheduler_lease" } as Row;
    }

    if (this.query.includes("WHERE key = 'scheduler_lease' AND textValue = ?")) {
      const [nowMs, updatedAt, runId] = this.values;
      const lease = this.database.state.get("scheduler_lease");
      if (lease?.textValue !== runId) return null;
      this.database.seed("scheduler_lease", null, Number(nowMs), Number(updatedAt));
      return { key: "scheduler_lease" } as Row;
    }

    return null;
  }

  async all<Row>(): Promise<D1ResultLike<unknown, Row>> {
    if (this.query.includes("FROM runtime_state")) {
      const requested = new Set(this.values.filter((value): value is string => typeof value === "string"));
      const rows = [...this.database.state.values()].filter((row) => (
        requested.size === 0 || requested.has(row.key)
      ));
      return { success: true, meta: {}, results: rows as Row[] };
    }
    if (this.query.includes("FROM probe_targets")) {
      return { success: true, meta: {}, results: [] };
    }
    return { success: true, meta: {}, results: [] };
  }

  async run<Meta>(): Promise<D1ResultLike<Meta>> {
    this.database.applyRuntimeMutation(this.query, this.values);
    return { success: true, meta: {} as Meta };
  }
}

class MemoryDatabase implements D1DatabaseLike {
  readonly state = new Map<string, RuntimeRow>();

  prepare(query: string): D1PreparedStatementLike {
    return new MemoryStatement(this, query);
  }

  async batch<Meta>(
    statements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1ResultLike<Meta>[]> {
    return Promise.all(statements.map((statement) => statement.run<Meta>()));
  }

  seed(key: string, textValue: string | null, integerValue: number | null, updatedAt: number): void {
    this.state.set(key, { key, textValue, integerValue, updatedAt });
  }

  applyRuntimeMutation(query: string, values: readonly unknown[]): void {
    if (!query.includes("INSERT INTO runtime_state")) return;
    const literalKey = query.match(/VALUES \('([^']+)'/)?.[1];
    const key = literalKey ?? (typeof values[0] === "string" ? values[0] : undefined);
    if (key === undefined) return;
    const offset = literalKey === undefined ? 1 : 0;
    const textValue = values[offset] === null || typeof values[offset] === "string"
      ? values[offset] as string | null
      : null;
    const integerCandidate = values[offset + 1];
    const integerValue = typeof integerCandidate === "number" ? integerCandidate : null;
    const updatedAtCandidate = values.at(-1);
    const updatedAt = typeof updatedAtCandidate === "number" ? updatedAtCandidate : 0;
    this.seed(key, textValue, integerValue, updatedAt);
  }
}

const config = loadConfig({ KILL_SWITCH: "0" });
const context = {
  waitUntil() {},
  passThroughOnException() {},
};

function asEnv(database: MemoryDatabase): Env {
  return { DB: database as unknown as D1Database };
}

async function readHealth(database: MemoryDatabase, nowMs = 20_000): Promise<Record<string, unknown>> {
  const response = await healthResponse(database as unknown as D1Database, config, nowMs);
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

describe("WP2 review: failure visibility and health metrics", () => {
  it.each([
    { phase: "header" as const, summaryKey: "last_header_summary", offset: 0 },
    { phase: "sweep" as const, summaryKey: "last_sweep_summary", offset: 17 },
  ])("persists a sanitized $phase failure, degrades health, and does not advance", async ({
    phase,
    summaryKey,
    offset,
  }) => {
    const database = new MemoryDatabase();
    database.seed("next_scheduler_phase", phase, null, 9_000);
    database.seed("sweep_offset", null, offset, 9_000);
    database.seed("header_high_water", "1000:9", null, 9_000);
    let clock = 10_000;
    const runner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "review-run",
      executePhase: async ({ phase: selectedPhase }) => {
        expect(selectedPhase).toBe(phase);
        throw new Error("UPSTREAM_PAYLOAD https://private.example/token?secret=raw-body");
      },
    });

    await runner(
      { scheduledTime: 10_000, cron: "*/5 * * * *" },
      asEnv(database),
      context,
      config,
    ).catch(() => undefined);

    const persisted = database.state.get(summaryKey)?.textValue;
    expect(persisted, `${phase} must persist a failure summary`).toBeTypeOf("string");
    expect(JSON.parse(persisted ?? "{}")).toMatchObject({
      phase,
      status: expect.stringMatching(/^(?:degraded|error)$/),
      errorCode: expect.stringMatching(/^[A-Z0-9_]{1,64}$/),
      d1Queries: expect.any(Number),
      wallTimeMs: expect.any(Number),
    });
    expect(persisted).not.toContain("private.example");
    expect(persisted).not.toContain("raw-body");
    expect(database.state.get("next_scheduler_phase")?.textValue).toBe(phase);
    expect(database.state.get("sweep_offset")?.integerValue).toBe(offset);
    expect(database.state.get("header_high_water")?.textValue).toBe("1000:9");

    const health = await readHealth(database);
    const serialized = JSON.stringify(health);
    expect(health).toMatchObject({
      status: "degraded",
      nextPhase: phase,
      sweepOffset: offset,
      lastPhase: {
        phase,
        status: expect.stringMatching(/^(?:degraded|error)$/),
        errorCode: expect.stringMatching(/^[A-Z0-9_]{1,64}$/),
      },
    });
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("raw-body");
  });

  it("exposes the latest HEADER phase with invocation totals and window exhaustion", async () => {
    const database = new MemoryDatabase();
    database.seed("last_header_summary", JSON.stringify({
      phase: "header",
      status: "ok",
      requests: 1,
      d1Queries: 9,
      wallTimeMs: 37,
      headerWindowExhausted: true,
      rawPayload: "must-not-be-public",
    }), null, 12_000);

    const health = await readHealth(database);

    expect(health.lastPhase).toEqual({
      phase: "header",
      status: "ok",
      requests: 1,
      d1Queries: 9,
      wallTimeMs: 37,
      headerWindowExhausted: true,
    });
    expect(JSON.stringify(health)).not.toContain("must-not-be-public");
  });

  it("exposes the latest SWEEP metrics and persisted cursor without arbitrary fields", async () => {
    const database = new MemoryDatabase();
    database.seed("sweep_offset", null, 12, 13_000);
    database.seed("sweep_round", null, 2, 13_000);
    database.seed("last_sweep_summary", JSON.stringify({
      phase: "sweep",
      status: "ok",
      requests: 4,
      d1Queries: 13,
      wallTimeMs: 41,
      previousOffset: 8,
      nextOffset: 12,
      sweepRound: 2,
      complete: false,
      processedAgents: 4,
      changedTargets: 2,
      removedTargets: 1,
      metadataUnavailableTargets: 1,
      rawPayload: "must-not-be-public",
    }), null, 13_000);

    const health = await readHealth(database);

    expect(health).toMatchObject({
      status: "ok",
      sweepOffset: 12,
      sweepRound: 2,
      lastPhase: {
        phase: "sweep",
        status: "ok",
        requests: 4,
        d1Queries: 13,
        wallTimeMs: 41,
        previousOffset: 8,
        nextOffset: 12,
        sweepRound: 2,
        complete: false,
        processedAgents: 4,
        changedTargets: 2,
        removedTargets: 1,
        metadataUnavailableTargets: 1,
      },
    });
    expect(JSON.stringify(health)).not.toContain("must-not-be-public");
  });
});
