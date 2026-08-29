import { env } from "cloudflare:workers";

import type { D1DatabaseLike } from "../../src/db/client";
import { createBudgetedD1Database } from "../../src/db/query-budget";
import { createD1ProbePersistence } from "../../src/phases/probe-d1";

const NOW = 2_000_000_000_000;
const ENDPOINT = "https://bnb-agent-marketplace-ruby.vercel.app/grid";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM probe_observations").run();
  await env.DB.prepare("DELETE FROM probe_targets").run();
  await env.DB.prepare("DELETE FROM runtime_state").run();
  await env.DB.prepare(
    `INSERT INTO probe_targets (
       agentId, chainId, transport, endpoint, name, categoriesJson,
       categoryProvenance, declarationState, currentMetadataUpdatedAt,
       lastMetadataCheckedAt, firstSeenAt, lastChangedAt, lastSeenAt, priority
     ) VALUES
       ('303779', 56, 'a2a', ?, 'Grid', '["grid_trading"]',
        'derived:marketplace-inventory', 'current', ?, ?, ?, ?, ?, 1),
       ('45650', 56, 'a2a', 'https://other.example.com/a2a', 'Other', '[]',
        NULL, 'current', ?, ?, ?, ?, ?, 1)`,
  ).bind(ENDPOINT, NOW - 1_000, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW).run();
});

describe("WP3 typed D1 persistence", () => {
  it("bootstraps the exact allowlisted Grid target without a manual D1 insert", async () => {
    await env.DB.prepare("DELETE FROM probe_targets WHERE agentId = '303779'").run();
    const raw = env.DB as unknown as D1DatabaseLike;
    const { db, budget } = createBudgetedD1Database(raw, 40);
    const persistence = createD1ProbePersistence(db, { queryBudget: budget, nowMs: NOW });

    const selected = await persistence.selectTarget({
      agentAllowlist: ["303779"],
      endpointAllowlist: [ENDPOINT],
      limit: 1,
    });

    expect(selected).toMatchObject({
      agentId: "303779",
      chainId: 56,
      transport: "a2a",
      endpoint: ENDPOINT,
      categoriesJson: '["grid_trading"]',
    });

    await persistence.commit({
      target: selected!,
      reconciliation: { status: "current", metadataUpdatedAt: NOW - 1_000 },
      observation: {
        outcome: "unreachable",
        probeCategory: "grid_trading",
        observedMetadataUpdatedAt: NOW - 1_000,
        errorCode: "SELLER_TIMEOUT",
        durationMs: 5_000,
      },
      nextPriority: 0,
      summary: {
        phase: "probe", status: "ok", processedTargets: 1,
        outcome: "unreachable", requests: 3, wallTimeMs: 5_000,
      },
    });

    expect(await env.DB.prepare(
      `SELECT agentId, chainId, transport, endpoint, name, categoriesJson,
              categoryProvenance, declarationState, currentMetadataUpdatedAt, priority
       FROM probe_targets WHERE agentId = '303779'`,
    ).first()).toEqual({
      agentId: "303779",
      chainId: 56,
      transport: "a2a",
      endpoint: ENDPOINT,
      name: "Grid",
      categoriesJson: '["grid_trading"]',
      categoryProvenance: "derived:marketplace-inventory",
      declarationState: "current",
      currentMetadataUpdatedAt: NOW - 1_000,
      priority: 0,
    });
    expect(await env.DB.prepare(
      "SELECT outcome, errorCode FROM probe_observations WHERE agentId = '303779'",
    ).first()).toEqual({ outcome: "unreachable", errorCode: "SELLER_TIMEOUT" });
    expect(budget.used).toBeLessThanOrEqual(6);
  });

  it("does not bootstrap an arbitrary allowlisted pair", async () => {
    await env.DB.prepare("DELETE FROM probe_targets").run();
    const raw = env.DB as unknown as D1DatabaseLike;
    const { db, budget } = createBudgetedD1Database(raw, 40);
    const persistence = createD1ProbePersistence(db, { queryBudget: budget, nowMs: NOW });

    await expect(persistence.selectTarget({
      agentAllowlist: ["999999"],
      endpointAllowlist: ["https://seller.example/a2a"],
      limit: 1,
    })).resolves.toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM probe_targets").first())
      .toEqual({ count: 0 });
    expect(budget.used).toBe(1);
  });

  it("does not materialize the bootstrap target until trust8004 confirms it is current", async () => {
    await env.DB.prepare("DELETE FROM probe_targets WHERE agentId = '303779'").run();
    const raw = env.DB as unknown as D1DatabaseLike;
    const { db, budget } = createBudgetedD1Database(raw, 40);
    const persistence = createD1ProbePersistence(db, { queryBudget: budget, nowMs: NOW });
    const selected = await persistence.selectTarget({
      agentAllowlist: ["303779"], endpointAllowlist: [ENDPOINT], limit: 1,
    });

    await persistence.commit({
      target: selected!,
      reconciliation: { status: "metadata_unavailable" },
      observation: null,
      nextPriority: 1,
      summary: {
        phase: "probe", status: "ok", processedTargets: 1,
        outcome: "metadata_unavailable", requests: 1, wallTimeMs: 1,
      },
    });

    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM probe_targets WHERE agentId = '303779'",
    ).first()).toEqual({ count: 0 });
    expect(budget.used).toBeLessThanOrEqual(3);
  });

  it.each(["removed", "metadata_unavailable"] as const)(
    "reactivates a pre-existing Grid target from %s after bootstrap reconciliation",
    async (declarationState) => {
      const originalFirstSeenAt = NOW - 86_400_000;
      await env.DB.prepare(
        `UPDATE probe_targets
         SET declarationState = ?, currentMetadataUpdatedAt = NULL,
             lastMetadataCheckedAt = ?, firstSeenAt = ?, lastChangedAt = ?,
             lastSeenAt = ?, priority = 1
         WHERE agentId = '303779'`,
      ).bind(
        declarationState,
        NOW - 20_000,
        originalFirstSeenAt,
        NOW - 20_000,
        NOW - 20_000,
      ).run();
      const raw = env.DB as unknown as D1DatabaseLike;
      const { db, budget } = createBudgetedD1Database(raw, 40);
      const persistence = createD1ProbePersistence(db, { queryBudget: budget, nowMs: NOW });

      const selected = await persistence.selectTarget({
        agentAllowlist: ["303779"], endpointAllowlist: [ENDPOINT], limit: 1,
      });
      expect(selected).toMatchObject({
        agentId: "303779",
        endpoint: ENDPOINT,
        bootstrapSource: "marketplace-inventory",
      });

      await persistence.commit({
        target: selected!,
        reconciliation: { status: "current", metadataUpdatedAt: NOW - 1_000 },
        observation: {
          outcome: "unreachable",
          probeCategory: "grid_trading",
          observedMetadataUpdatedAt: NOW - 1_000,
          errorCode: "SELLER_TIMEOUT",
          durationMs: 5_000,
        },
        nextPriority: 0,
        summary: {
          phase: "probe", status: "ok", processedTargets: 1,
          outcome: "unreachable", requests: 3, wallTimeMs: 5_000,
        },
      });

      expect(await env.DB.prepare(
        `SELECT declarationState, currentMetadataUpdatedAt, lastMetadataCheckedAt,
                firstSeenAt, lastChangedAt, lastSeenAt, priority, categoryProvenance
         FROM probe_targets WHERE agentId = '303779'`,
      ).first()).toEqual({
        declarationState: "current",
        currentMetadataUpdatedAt: NOW - 1_000,
        lastMetadataCheckedAt: NOW,
        firstSeenAt: originalFirstSeenAt,
        lastChangedAt: NOW,
        lastSeenAt: NOW,
        priority: 0,
        categoryProvenance: "derived:marketplace-inventory",
      });
      expect(await env.DB.prepare(
        "SELECT outcome, errorCode FROM probe_observations WHERE agentId = '303779'",
      ).first()).toEqual({ outcome: "unreachable", errorCode: "SELLER_TIMEOUT" });
      expect(await env.DB.prepare(
        "SELECT textValue FROM runtime_state WHERE key = 'next_scheduler_phase'",
      ).first()).toEqual({ textValue: "header" });
      expect(budget.used).toBeLessThanOrEqual(6);
    },
  );

  it("preflights the bootstrap write with the observation in the same Free-budget batch", async () => {
    await env.DB.prepare("DELETE FROM probe_targets WHERE agentId = '303779'").run();
    const raw = env.DB as unknown as D1DatabaseLike;
    const { db, budget } = createBudgetedD1Database(raw, 4);
    const persistence = createD1ProbePersistence(db, { queryBudget: budget, nowMs: NOW });
    const selected = await persistence.selectTarget({
      agentAllowlist: ["303779"], endpointAllowlist: [ENDPOINT], limit: 1,
    });

    await expect(persistence.commit({
      target: selected!,
      reconciliation: { status: "current", metadataUpdatedAt: NOW },
      observation: {
        outcome: "unreachable", probeCategory: "grid_trading",
        observedMetadataUpdatedAt: NOW, errorCode: "SELLER_TIMEOUT", durationMs: 5_000,
      },
      nextPriority: 0,
      summary: {
        phase: "probe", status: "ok", processedTargets: 1,
        outcome: "unreachable", requests: 3, wallTimeMs: 5_000,
      },
    })).rejects.toMatchObject({ name: "ProbeQueryBudgetExceededError", required: 4 });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM probe_targets WHERE agentId = '303779'",
    ).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM probe_observations").first())
      .toEqual({ count: 0 });
  });

  it("selects only the allowlisted target and commits observation plus rotation atomically", async () => {
    const raw = env.DB as unknown as D1DatabaseLike;
    const { db, budget } = createBudgetedD1Database(raw, 40);
    const persistence = createD1ProbePersistence(db, {
      queryBudget: budget,
      nowMs: NOW,
      completedQueueScheduledTime: NOW - 5_000,
    });
    const target = await persistence.selectTarget({
      agentAllowlist: ["303779"],
      endpointAllowlist: [ENDPOINT],
      limit: 1,
    });
    expect(target).toMatchObject({ agentId: "303779", endpoint: ENDPOINT });

    await persistence.commit({
      target: target!,
      reconciliation: { status: "current", metadataUpdatedAt: NOW },
      observation: {
        outcome: "quote_verified",
        probeCategory: "grid_trading",
        observedMetadataUpdatedAt: NOW,
        observedWallet: "0x1111111111111111111111111111111111111111",
        observedWalletSource: "agentWallet",
        observedBlockNumber: "123",
        onchainObservedAt: NOW - 30_000,
        commerce: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6",
        router: "0x51895229E12F9876011789B04f8698af06cCD6DA",
        policy: "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5",
        priceRaw: "1",
        currency: "0xcE24439F2D9C6a2289F741120FE202248B666666",
        decimals: 18,
        signatureMethod: "eip191",
        signer: "0x1111111111111111111111111111111111111111",
        requestHash: `0x${"a".repeat(64)}`,
        negotiationHash: `0x${"b".repeat(64)}`,
        quoteNegotiatedAt: NOW,
        quoteExpiresAt: NOW + 900_000,
        errorCode: null,
        durationMs: 10,
      },
      nextPriority: 0,
      summary: {
        phase: "probe",
        status: "ok",
        processedTargets: 1,
        outcome: "quote_verified",
        requests: 6,
        wallTimeMs: 10,
      },
    });

    const observation = await env.DB.prepare(
      "SELECT outcome, probeCategory, signer, requestHash FROM probe_observations",
    ).first<Record<string, unknown>>();
    expect(observation).toMatchObject({
      outcome: "quote_verified",
      probeCategory: "grid_trading",
      signer: "0x1111111111111111111111111111111111111111",
      requestHash: `0x${"a".repeat(64)}`,
    });
    const targetState = await env.DB.prepare(
      "SELECT priority, declarationState, currentMetadataUpdatedAt FROM probe_targets WHERE agentId='303779'",
    ).first<Record<string, unknown>>();
    expect(targetState).toMatchObject({ priority: 0, declarationState: "current", currentMetadataUpdatedAt: NOW });
    const states = await env.DB.prepare(
      "SELECT key, textValue, integerValue FROM runtime_state ORDER BY key",
    ).all<Record<string, unknown>>();
    expect(states.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "next_scheduler_phase", textValue: "header" }),
      expect.objectContaining({ key: "last_probe_summary" }),
      expect.objectContaining({ key: "last_queue_scheduled_time", integerValue: NOW - 5_000 }),
    ]));
    expect(budget.used).toBeLessThanOrEqual(7);
  });

  it("preflights its batch and leaves no partial observation or rotation", async () => {
    const raw = env.DB as unknown as D1DatabaseLike;
    const { db, budget } = createBudgetedD1Database(raw, 2);
    const persistence = createD1ProbePersistence(db, { queryBudget: budget, nowMs: NOW });
    const target = await persistence.selectTarget({
      agentAllowlist: ["303779"], endpointAllowlist: [ENDPOINT], limit: 1,
    });
    await expect(persistence.commit({
      target: target!,
      reconciliation: { status: "metadata_unavailable" },
      observation: null,
      nextPriority: 1,
      summary: {
        phase: "probe", status: "ok", processedTargets: 1,
        outcome: "metadata_unavailable", requests: 1, wallTimeMs: 1,
      },
    })).rejects.toMatchObject({ name: "ProbeQueryBudgetExceededError" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM probe_observations").first()).toMatchObject({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM runtime_state").first()).toMatchObject({ count: 0 });
  });

  it("does not rewrite an unchanged target inside the hourly refresh window", async () => {
    await env.DB.prepare(
      `UPDATE probe_targets
       SET currentMetadataUpdatedAt = ?, lastMetadataCheckedAt = ?, lastSeenAt = ?, priority = 1
       WHERE agentId = '303779'`,
    ).bind(NOW - 1_000, NOW - 500, NOW - 500).run();
    const raw = env.DB as unknown as D1DatabaseLike;
    const { db, budget } = createBudgetedD1Database(raw, 40);
    const persistence = createD1ProbePersistence(db, { queryBudget: budget, nowMs: NOW });
    const target = await persistence.selectTarget({
      agentAllowlist: ["303779"], endpointAllowlist: [ENDPOINT], limit: 1,
    });

    await persistence.commit({
      target: target!,
      reconciliation: { status: "current", metadataUpdatedAt: NOW - 1_000 },
      observation: null,
      nextPriority: 1,
      summary: {
        phase: "probe", status: "ok", processedTargets: 1,
        outcome: "metadata_unavailable", requests: 1, wallTimeMs: 1,
      },
    });

    expect(await env.DB.prepare(
      "SELECT lastMetadataCheckedAt, lastSeenAt FROM probe_targets WHERE agentId = '303779'",
    ).first()).toEqual({ lastMetadataCheckedAt: NOW - 500, lastSeenAt: NOW - 500 });
    expect(budget.used).toBe(3);
  });
});
