import { env } from "cloudflare:workers";
import type { D1DatabaseLike } from "../../src/db/client";
import { probeTargets } from "../../src/db/schema";
import {
  countTargetsByDeclarationState,
  createDatabase,
  readEffectiveCatalogObservationsForAgents,
  readRuntimeState,
  readRuntimeStates,
  writeRuntimeState,
} from "../../src/db/orm";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM runtime_state").run();
  await env.DB.prepare("DELETE FROM probe_targets").run();
});

function target(agentId: string, declarationState: string) {
  const now = 1_787_900_000_000;
  return {
    agentId,
    chainId: 56,
    transport: "a2a",
    endpoint: `https://agents.example/${agentId}`,
    declarationState,
    lastMetadataCheckedAt: now,
    firstSeenAt: now,
    lastChangedAt: now,
    lastSeenAt: now,
  };
}

describe("drizzle runtime layer", () => {
  it("round-trips runtime state through insert and conflict update", async () => {
    const db = createDatabase(env.DB as unknown as D1DatabaseLike);

    await writeRuntimeState(db, {
      key: "sweep_offset",
      textValue: null,
      integerValue: 4_000,
      updatedAt: 1_787_900_000_000,
    });
    await writeRuntimeState(db, {
      key: "sweep_offset",
      textValue: null,
      integerValue: 6_000,
      updatedAt: 1_787_900_060_000,
    });

    const row = await readRuntimeState(db, "sweep_offset");
    expect(row).toEqual({
      key: "sweep_offset",
      textValue: null,
      integerValue: 6_000,
      updatedAt: 1_787_900_060_000,
    });
    expect(await readRuntimeState(db, "missing_key")).toBeNull();
  });

  it("reads only the requested runtime state keys", async () => {
    const db = createDatabase(env.DB as unknown as D1DatabaseLike);
    for (const [key, integerValue] of [["sweep_offset", 1], ["sweep_round", 2], ["last_funnel_snapshot", 3]] as const) {
      await writeRuntimeState(db, { key, textValue: null, integerValue, updatedAt: 1_787_900_000_000 });
    }

    const rows = await readRuntimeStates(db, ["sweep_offset", "sweep_round"]);
    expect(rows.map(({ key }) => key).sort()).toEqual(["sweep_offset", "sweep_round"]);
    expect(await readRuntimeStates(db, [])).toEqual([]);
  });

  it("counts probe targets by declaration state with schema-derived queries", async () => {
    const db = createDatabase(env.DB as unknown as D1DatabaseLike);
    await db.insert(probeTargets).values([
      target("1", "current"),
      target("2", "current"),
      target("3", "removed"),
    ]);

    expect(await countTargetsByDeclarationState(db)).toEqual({ current: 2, removed: 1 });
  });

  it("keeps the schema CHECK constraints enforced through the ORM path", async () => {
    const db = createDatabase(env.DB as unknown as D1DatabaseLike);

    await expect(
      db.insert(probeTargets).values({ ...target("9", "current"), chainId: 97 }),
    ).rejects.toThrow();
    await expect(
      db.insert(probeTargets).values({ ...target("9", "walletless"), }),
    ).rejects.toThrow();
  });

  it("rejects invalid runtime state input before touching D1", async () => {
    const db = createDatabase(env.DB as unknown as D1DatabaseLike);

    await expect(readRuntimeState(db, "  ")).rejects.toThrow("must not be empty");
    await expect(
      writeRuntimeState(db, { key: "sweep_offset", textValue: null, integerValue: 0.5, updatedAt: 1 }),
    ).rejects.toThrow("safe integer");
    await expect(
      writeRuntimeState(db, { key: "sweep_offset", textValue: null, integerValue: null, updatedAt: -1 }),
    ).rejects.toThrow("non-negative");
  });

  it("rejects catalog observation pages that would exceed the bounded query envelope", async () => {
    const db = createDatabase(env.DB as unknown as D1DatabaseLike);
    await expect(readEffectiveCatalogObservationsForAgents(
      db,
      Array.from({ length: 61 }, (_, index) => `agent-${index}`),
      ["endpoint"],
    )).rejects.toThrow("at most 60 agents");
    await expect(readEffectiveCatalogObservationsForAgents(
      db,
      ["agent"],
      Array.from({ length: 1_201 }, (_, index) => `endpoint-${index}`),
    )).rejects.toThrow("at most 1200 endpoints");
  });
});
