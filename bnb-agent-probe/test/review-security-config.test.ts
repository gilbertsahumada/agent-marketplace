import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/db/client";
import {
  createD1HeaderPersistence,
  runHeader,
  type HeaderAgent,
  type HeaderCommit,
  type HeaderPersistence,
} from "../src/phases/header";
import { Trust8004CatalogClient } from "../src/trust8004/client";
import { isSyntacticallyPublicHttpsUrl } from "../src/trust8004/safe-url";

describe("review: syntactically public IPv6 policy", () => {
  it.each([
    "https://[::ffff:127.0.0.1]/path",
    "https://[64:ff9b::c000:201]/path",
    "https://[64:ff9b:1::1]/path",
    "https://[100::1]/path",
    "https://[2001::1]/path",
    "https://[2001:db8::1]/path",
    "https://[2002::1]/path",
    "https://[fe80::1]/path",
    "https://[ff00::1]/path",
  ])("rejects reserved or transition prefix %s", (url) => {
    expect(isSyntacticallyPublicHttpsUrl(url)).toBe(false);
  });

  it.each([
    "https://[2001:4860:4860::8888]/path",
    "https://[2606:4700:4700::1111]/path",
  ])("continues to accept public control %s", (url) => {
    expect(isSyntacticallyPublicHttpsUrl(url)).toBe(true);
  });
});

describe("review: catalog client error hygiene", () => {
  it("does not copy an invalid JSON body fragment into the thrown Error", async () => {
    const secretBodyFragment = "DO_NOT_LEAK_CATALOG_BODY_7b9d";
    const client = new Trust8004CatalogClient({
      baseUrl: "https://catalog.example.com",
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
      fetch: async () => new Response(`{\"items\":${secretBodyFragment}}`, {
        headers: { "content-type": "application/json" },
      }),
    });

    const error = await client.listHeader(1).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("invalid JSON");
    expect((error as Error).message).not.toContain(secretBodyFragment);
    expect((error as Error).message).not.toContain("DO_NOT_LEA");
  });
});

describe("review: non-zero executable phase budgets", () => {
  it.each([
    ["HEADER_LIMIT", { HEADER_LIMIT: "0" }],
    ["SWEEP_LIMIT", { SWEEP_LIMIT: "0" }],
    ["TRUST8004_REQUESTS_PER_RUN", { TRUST8004_REQUESTS_PER_RUN: "0" }],
    ["EXTERNAL_SUBREQUESTS_PER_RUN", { EXTERNAL_SUBREQUESTS_PER_RUN: "0" }],
  ] as const)("rejects zero for %s", (field, overrides) => {
    expect(() => loadConfig(overrides)).toThrow(new RegExp(`^${field}:`));
  });

  it("rejects a D1 budget that cannot cover the minimum Queue SWEEP and cleanup", () => {
    expect(() => loadConfig({ D1_QUERIES_PER_RUN: "12" }))
      .toThrow(/^D1_QUERIES_PER_RUN:/);
    expect(loadConfig({ D1_QUERIES_PER_RUN: "13" }).d1QueriesPerRun).toBe(13);
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
    return { success: true, meta: {}, results: [] };
  }

  async run<Meta>(): Promise<D1ResultLike<Meta>> {
    throw new Error("adapter must use batch");
  }
}

class RecordingDatabase implements D1DatabaseLike {
  readonly batches: RecordingStatement[][] = [];

  prepare(query: string): D1PreparedStatementLike {
    return new RecordingStatement(this, query);
  }

  async batch<Meta>(
    statements: readonly D1PreparedStatementLike[],
  ): Promise<readonly D1ResultLike<Meta>[]> {
    this.batches.push(statements as RecordingStatement[]);
    return statements.map(() => ({ success: true, meta: {} as Meta }));
  }
}

describe("review: HEADER D1 bind-size ceiling", () => {
  it("keeps every bind below 2,000,000 bytes for 50 agents with two near-max strings", async () => {
    const database = new RecordingDatabase();
    const longName = "n".repeat(16_380);
    const items: HeaderAgent[] = Array.from({ length: 50 }, (_, index) => ({
      chainId: 56,
      agentId: String(index + 1),
      registeredAt: 10_000 + index,
      name: longName,
      metadataUpdatedAt: 9_000 + index,
      declaresErc8183: true,
      targets: [
        {
          transport: "erc8183_http",
          endpoint: `https://seller-${index}.example.com/${"a".repeat(16_300)}`,
        },
        {
          transport: "a2a",
          endpoint: `https://seller-${index}.example.com/${"b".repeat(16_300)}`,
        },
      ],
    }));

    await runHeader({
      fetchNewestPage: async () => ({ items }),
      parseAgent: (value) => value as HeaderAgent,
      persistence: createD1HeaderPersistence(database),
      queryBudget: { remaining: 39 },
      now: () => 20_000,
    }, { limit: 50 });

    const boundStrings = database.batches
      .flatMap((batch) => batch)
      .flatMap((statement) => statement.values)
      .filter((value): value is string => typeof value === "string");
    expect(boundStrings.length).toBeGreaterThan(0);
    expect(Math.max(...boundStrings.map((value) => new TextEncoder().encode(value).byteLength)))
      .toBeLessThanOrEqual(2_000_000);
  });
});

describe("review: partially invalid HEADER window", () => {
  it("processes 24 valid agents and preserves progress when item 25 has no registeredAt", async () => {
    const validAgents: HeaderAgent[] = Array.from({ length: 24 }, (_, index) => ({
      chainId: 56,
      agentId: String(index + 1),
      registeredAt: 1_000 + index,
      name: `Seller ${index + 1}`,
      metadataUpdatedAt: 900 + index,
      declaresErc8183: true,
      targets: [],
    }));
    const malformedAgent = {
      ...validAgents[0]!,
      agentId: "25",
      registeredAt: null,
    };
    const catalogItems = [...validAgents, malformedAgent];
    const eligibleItems = catalogItems.filter(
      (item): item is HeaderAgent => item.registeredAt !== null,
    );
    const parsedIds: string[] = [];
    let committed: HeaderCommit | undefined;
    const persistence: HeaderPersistence = {
      async loadExistingTargets(agentIds) {
        expect(agentIds).toEqual(validAgents.map(({ agentId }) => agentId));
        return [];
      },
      async commitHeader(input) {
        committed = input;
      },
    };

    const summary = await runHeader({
      fetchNewestPage: async () => ({
        items: eligibleItems,
        received: catalogItems.length,
        invalidItems: catalogItems.length - eligibleItems.length,
      }),
      parseAgent(value) {
        const parsed = value as HeaderAgent;
        parsedIds.push(parsed.agentId);
        return parsed;
      },
      persistence,
      queryBudget: { remaining: 39 },
      now: () => 2_000,
    }, {
      limit: 25,
      previousHighWater: "999:0",
    });

    expect(parsedIds).toEqual(validAgents.map(({ agentId }) => agentId));
    expect(summary).toMatchObject({
      received: 25,
      agentsValidated: 24,
      invalidItems: 1,
      headerWindowExhausted: true,
    });
    expect(committed?.highWater).toBe("1023:24");
  });
});
