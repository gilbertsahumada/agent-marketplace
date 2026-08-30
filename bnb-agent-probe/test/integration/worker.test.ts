import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import worker, { createWorker } from "../../src/index";
import { loadConfig } from "../../src/config";
import type { D1DatabaseLike } from "../../src/db/client";
import {
  createBudgetedD1Database,
  D1QueryBudgetExceededError,
} from "../../src/db/query-budget";
import { acquireSchedulerLease } from "../../src/lib/scheduler-lease";
import { recordDailyBudget } from "../../src/db/daily-budget";
import { healthResponse } from "../../src/routes/health";
import { createWp2ScheduledRunner, runWp2Scheduled } from "../../src/scheduled";
import type { Env } from "../../src/types";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM catalog_observations").run();
  await env.DB.prepare("DELETE FROM catalog_agent_endpoints").run();
  await env.DB.prepare("DELETE FROM catalog_endpoints").run();
  await env.DB.prepare("DELETE FROM catalog_agents").run();
  await env.DB.prepare("DELETE FROM runtime_state").run();
  await env.DB.prepare("DELETE FROM probe_observations").run();
  await env.DB.prepare("DELETE FROM probe_targets").run();
});

function catalogObservationBody(overrides: Record<string, unknown> = {}) {
  const now = 1_788_000_000_000;
  return {
    schemaVersion: 1,
    source: "browser_reported",
    agentId: "45422",
    endpointKey: "a".repeat(64),
    protocol: "mcp",
    outcome: "protocol_valid",
    observedAt: now,
    expiresAt: now + 15 * 60_000,
    httpStatus: 200,
    errorCode: null,
    durationMs: 125,
    details: { capabilityCount: 4, method: "POST", cors: true },
    ...overrides,
  };
}

function queueMessage(body: unknown, attempts = 1) {
  const scheduledTime = (body as { scheduledTime?: unknown }).scheduledTime;
  return {
    id: `worker-test-${String(scheduledTime)}`,
    timestamp: new Date(),
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function buyerRefreshBody(overrides: Record<string, unknown> = {}) {
  const now = 1_788_000_000_000;
  return {
    schemaVersion: 1,
    source: "buyer_refresh",
    agentId: "303779",
    chainId: 56,
    transport: "a2a",
    endpoint: "https://bnb-agent-marketplace-ruby.vercel.app/grid",
    probeCategory: "grid_trading",
    probedAt: now,
    durationMs: 125,
    observedWallet: "0x1111111111111111111111111111111111111111",
    commerce: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6",
    router: "0x51895229E12F9876011789B04f8698af06cCD6DA",
    policy: "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5",
    priceRaw: "1000",
    currency: "0xcE24439F2D9C6a2289F741120FE202248B666666",
    decimals: 18,
    signer: "0x1111111111111111111111111111111111111111",
    requestHash: `0x${"a".repeat(64)}`,
    negotiationHash: `0x${"b".repeat(64)}`,
    quoteNegotiatedAt: now - 1_000,
    quoteExpiresAt: now + 899_000,
    ...overrides,
  };
}

describe("WP1 in the Workers runtime", () => {
  it("filters normalized catalog candidates using platform evidence, never browser claims", async () => {
    const now = 1_788_000_000_000;
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, metadataState, indexState, firstSeenAt, lastSeenAt, priority
    ) VALUES
      ('eip155:56:1', '1', 56, 'Agent one', 'ok', 'current', ?, ?, 60),
      ('eip155:56:2', '2', 56, 'Agent two', 'ok', 'current', ?, ?, 40)`).bind(now, now, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey, nextProbeAt, consecutiveFailures
    ) VALUES
      (?, 'a2a', 'https://one.example/a2a', 'origin-one', 'safe', 'eip155:56:1', 0, 0),
      (?, 'mcp', 'https://two.example/mcp', 'origin-two', 'safe', 'eip155:56:2', 0, 0)`).bind(
      "a".repeat(64), "b".repeat(64),
    ).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority
    ) VALUES
      ('eip155:56:1', ?, 'current', ?, ?, 60),
      ('eip155:56:2', ?, 'current', ?, ?, 40)`).bind(
      "a".repeat(64), now, now, "b".repeat(64), now, now,
    ).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt, durationMs, detailsJson
    ) VALUES
      ('eip155:56:1', ?, 'a2a', 'worker_probe', 'protocol_valid', ?, ?, 20, '{}'),
      ('eip155:56:2', ?, 'mcp', 'browser_reported', 'protocol_valid', ?, ?, 30, '{}')`).bind(
      "a".repeat(64), now, now + 900_000,
      "b".repeat(64), now, now + 900_000,
    ).run();
    const app = createWorker({ now: () => now });
    const context = createExecutionContext();

    const a2a = await app.fetch(new Request("https://worker.test/catalog-agents?status=a2a"), env, context);
    expect(a2a.status).toBe(200);
    expect(await a2a.json()).toMatchObject({ total: 1, items: [{ agentId: "1" }] });

    const pending = await app.fetch(new Request("https://worker.test/catalog-agents?status=pending"), env, context);
    expect(await pending.json()).toMatchObject({
      total: 1,
      items: [{ agentId: "2", observations: [{ source: "browser_reported" }] }],
    });
  });

  it("persists authenticated catalog evidence and exposes its provenance per agent", async () => {
    const now = 1_788_000_000_000;
    const privateEnv = { ...env, BUYER_OBSERVATION_SECRET: "catalog-secret" } as unknown as Env;
    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/__internal/catalog-observation", {
        method: "POST",
        headers: { authorization: "Bearer catalog-secret", "content-type": "application/json" },
        body: JSON.stringify(catalogObservationBody()),
      }),
      privateEnv,
      createExecutionContext(),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "recorded", id: expect.any(Number) });

    const publicResponse = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/catalog-agent?agentId=45422"),
      privateEnv,
      createExecutionContext(),
    );
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=60");
    expect(await publicResponse.json()).toMatchObject({
      schemaVersion: 1,
      chainId: 56,
      agentId: "45422",
      platformAttemptCount: 0,
      declarations: [],
      observations: [{
        source: "browser_reported",
        outcome: "protocol_valid",
        protocol: "mcp",
        details: { capabilityCount: 4, method: "POST", cors: true },
      }],
    });
  });

  it("rejects untrusted or non-closed catalog observation payloads before D1", async () => {
    const now = 1_788_000_000_000;
    const privateEnv = { ...env, BUYER_OBSERVATION_SECRET: "catalog-secret" } as unknown as Env;
    const post = (body: unknown, authorization = "Bearer catalog-secret") => createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/__internal/catalog-observation", {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      privateEnv,
      createExecutionContext(),
    );

    expect((await post(catalogObservationBody(), "Bearer wrong")).status).toBe(401);
    expect((await post(catalogObservationBody({ source: "worker_probe" }))).status).toBe(400);
    expect((await post(catalogObservationBody({ endpointKey: "raw-url" }))).status).toBe(400);
    expect((await post({ ...catalogObservationBody(), authorization: "secret" })).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_observations").first())
      .toMatchObject({ count: 0 });
  });

  it("accepts an authenticated sanitized buyer refresh and persists it idempotently", async () => {
    const now = 1_788_000_000_000;
    const privateEnv = { ...env, BUYER_OBSERVATION_SECRET: "buyer-observation-test-secret" } as unknown as Env;
    await env.DB.prepare(
      `INSERT INTO probe_targets (
        agentId, chainId, transport, endpoint, name, categoriesJson,
        categoryProvenance, declarationState, currentMetadataUpdatedAt,
        lastMetadataCheckedAt, firstSeenAt, lastChangedAt, lastSeenAt, priority
      ) VALUES (?, 56, 'a2a', ?, 'Grid', '["grid_trading"]',
        'derived:marketplace-inventory', 'current', ?, ?, ?, ?, ?, 1)`,
    ).bind(
      "303779", "https://bnb-agent-marketplace-ruby.vercel.app/grid",
      now - 10_000, now - 5_000, now - 20_000, now - 10_000, now - 5_000,
    ).run();
    const request = () => new Request("https://buyer-refresh-worker.test/__internal/on-demand-observation", {
      method: "POST",
      headers: {
        authorization: "Bearer buyer-observation-test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(buyerRefreshBody()),
    });

    const cachedBefore = await createWorker({ now: () => now - 100 }).fetch(
      new Request("https://buyer-refresh-worker.test/observations"), privateEnv, createExecutionContext(),
    );
    expect((await cachedBefore.json() as { generatedAt: number }).generatedAt).toBe(now - 100);

    const first = await createWorker({ now: () => now }).fetch(request(), privateEnv, createExecutionContext());
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ status: "synced" });

    const recached = await createWorker({ now: () => now + 1 }).fetch(
      new Request("https://buyer-refresh-worker.test/observations"), privateEnv, createExecutionContext(),
    );
    expect((await recached.json() as { generatedAt: number }).generatedAt).toBe(now + 1);

    const second = await createWorker({ now: () => now + 2 }).fetch(request(), privateEnv, createExecutionContext());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "duplicate" });
    const rows = await env.DB.prepare(
      "SELECT * FROM probe_observations WHERE negotiationHash = ?",
    ).bind(`0x${"b".repeat(64)}`).all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results?.[0]).toMatchObject({
      agentId: "303779",
      chainId: 56,
      endpoint: "https://bnb-agent-marketplace-ruby.vercel.app/grid",
      probeCategory: "grid_trading",
      outcome: "quote_verified",
      observedMetadataUpdatedAt: now - 10_000,
      observedWalletSource: "agentWallet",
      signatureMethod: null,
      source: "buyer_refresh",
    });
    expect(JSON.stringify(rows.results)).not.toContain("provider_sig");
    expect(JSON.stringify(rows.results)).not.toContain("envelope");
    const refreshed = await createWorker({ now: () => now + 3 }).fetch(
      new Request("https://buyer-refresh-worker.test/observations"), privateEnv, createExecutionContext(),
    );
    expect((await refreshed.json() as { generatedAt: number }).generatedAt).toBe(now + 3);
  });

  it("deduplicates concurrent buyer refreshes atomically", async () => {
    const now = 1_788_000_000_000;
    const privateEnv = { ...env, BUYER_OBSERVATION_SECRET: "buyer-observation-test-secret" } as unknown as Env;
    await env.DB.prepare(
      `INSERT INTO probe_targets (
        agentId, chainId, transport, endpoint, categoriesJson, declarationState,
        currentMetadataUpdatedAt, lastMetadataCheckedAt, firstSeenAt,
        lastChangedAt, lastSeenAt, priority
      ) VALUES ('303779', 56, 'a2a', ?, '[]', 'current', ?, ?, ?, ?, ?, 1)`,
    ).bind(
      "https://bnb-agent-marketplace-ruby.vercel.app/grid",
      now - 10_000, now, now - 20_000, now - 10_000, now,
    ).run();
    const post = () => createWorker({ now: () => now }).fetch(
      new Request("https://concurrent-refresh-worker.test/__internal/on-demand-observation", {
        method: "POST",
        headers: { authorization: "Bearer buyer-observation-test-secret", "content-type": "application/json" },
        body: JSON.stringify(buyerRefreshBody()),
      }),
      privateEnv,
      createExecutionContext(),
    );

    const responses = await Promise.all([post(), post()]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual(
      expect.arrayContaining([{ status: "synced" }, { status: "duplicate" }]),
    );
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM probe_observations WHERE negotiationHash = ?",
    ).bind(`0x${"b".repeat(64)}`).first()).toMatchObject({ count: 1 });
  });

  it("fails buyer refresh safely when the exact target is absent or no longer current", async () => {
    const now = 1_788_000_000_000;
    const privateEnv = { ...env, BUYER_OBSERVATION_SECRET: "buyer-observation-test-secret" } as unknown as Env;
    const post = () => createWorker({ now: () => now }).fetch(
      new Request("https://missing-target-worker.test/__internal/on-demand-observation", {
        method: "POST",
        headers: { authorization: "Bearer buyer-observation-test-secret", "content-type": "application/json" },
        body: JSON.stringify(buyerRefreshBody()),
      }),
      privateEnv,
      createExecutionContext(),
    );

    expect((await post()).status).toBe(409);
    await env.DB.prepare(
      `INSERT INTO probe_targets (
        agentId, chainId, transport, endpoint, categoriesJson, declarationState,
        lastMetadataCheckedAt, firstSeenAt, lastChangedAt, lastSeenAt, priority
      ) VALUES ('303779', 56, 'a2a', ?, '[]', 'removed', ?, ?, ?, ?, 0)`,
    ).bind("https://bnb-agent-marketplace-ruby.vercel.app/grid", now, now, now, now).run();
    expect((await post()).status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM probe_observations").first()).toMatchObject({ count: 0 });
  });

  it("rejects unauthorized, non-allowlisted and non-closed buyer refresh payloads", async () => {
    const now = 1_788_000_000_000;
    const privateEnv = {
      ...env,
      BUYER_OBSERVATION_SECRET: "buyer-observation-test-secret",
      SHARED_SECRET: "different-admin-secret",
    } as unknown as Env;
    const post = (body: unknown, authorization = "Bearer buyer-observation-test-secret") => createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/__internal/on-demand-observation", {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      privateEnv,
      createExecutionContext(),
    );

    expect((await post(buyerRefreshBody(), "Bearer wrong")).status).toBe(401);
    expect((await post(buyerRefreshBody(), "Bearer different-admin-secret")).status).toBe(401);
    expect((await post(buyerRefreshBody({ chainId: 97 }))).status).toBe(400);
    expect((await post(buyerRefreshBody({ agentId: "42" }))).status).toBe(403);
    expect((await post(buyerRefreshBody({ endpoint: "https://attacker.example/grid" }))).status).toBe(403);
    expect((await post({ ...buyerRefreshBody(), provider_sig: "secret" })).status).toBe(400);
    expect((await post({ ...buyerRefreshBody(), padding: "x".repeat(8_192) })).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM probe_observations").first()).toMatchObject({ count: 0 });
  });

  it.each([
    ["non-HTTPS endpoint", { endpoint: "http://bnb-agent-marketplace-ruby.vercel.app/grid" }],
    ["zero price", { priceRaw: "0" }],
    ["stale negotiation", { quoteNegotiatedAt: 1_788_000_000_000 - 300_001 }],
    ["future negotiation", { quoteNegotiatedAt: 1_788_000_000_000 + 300_001 }],
    ["expired quote", { quoteExpiresAt: 1_788_000_000_000 }],
    ["excessive TTL", {
      quoteNegotiatedAt: 1_788_000_000_000 - 1_000,
      quoteExpiresAt: 1_788_000_000_000 + 899_001,
    }],
    ["contradictory signer", { signer: "0x9999999999999999999999999999999999999999" }],
    ["unapproved commerce", { commerce: "0x2222222222222222222222222222222222222222" }],
    ["unapproved router", { router: "0x3333333333333333333333333333333333333333" }],
    ["unapproved policy", { policy: "0x4444444444444444444444444444444444444444" }],
    ["unapproved currency", { currency: "0x5555555555555555555555555555555555555555" }],
    ["wrong token decimals", { decimals: 6 }],
  ])("rejects a buyer refresh with %s before querying its target", async (_name, overrides) => {
    const now = 1_788_000_000_000;
    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://invalid-refresh-worker.test/__internal/on-demand-observation", {
        method: "POST",
        headers: { authorization: "Bearer buyer-observation-test-secret", "content-type": "application/json" },
        body: JSON.stringify(buyerRefreshBody(overrides)),
      }),
      { ...env, BUYER_OBSERVATION_SECRET: "buyer-observation-test-secret" } as unknown as Env,
      createExecutionContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("serves the WP4 observations contract without leaking signatures", async () => {
    const now = 1_788_000_000_000;
    await env.DB.batch!([
      env.DB.prepare(
        `INSERT INTO probe_targets (
          agentId, chainId, transport, endpoint, name, categoriesJson,
          categoryProvenance, declarationState, currentMetadataUpdatedAt,
          lastMetadataCheckedAt, firstSeenAt, lastChangedAt, lastSeenAt, priority
        ) VALUES (?, 56, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "303779", "a2a", "https://agent.example/grid", "Grid",
        '["grid_trading","rebalancing"]', "derived:marketplace-inventory",
        "current", now - 1_000, now - 900, now - 10_000, now - 1_000, now - 900, 1,
      ),
      env.DB.prepare(
        `INSERT INTO probe_targets (
          agentId, chainId, transport, endpoint, name, categoriesJson,
          declarationState, lastMetadataCheckedAt, firstSeenAt,
          lastChangedAt, lastSeenAt, priority
        ) VALUES ('42', 56, 'erc8183_http', 'https://agent.example/removed',
          'Removed', '[]', 'removed', ?, ?, ?, ?, 0)`,
      ).bind(now - 800, now - 20_000, now - 800, now - 800),
      env.DB.prepare(
        `INSERT INTO probe_observations (
          agentId, chainId, transport, endpoint, probedAt, probeCategory,
          outcome, observedMetadataUpdatedAt, observedWallet,
          observedWalletSource, observedBlockNumber, onchainObservedAt,
          commerce, router, policy, priceRaw, currency, decimals,
          signatureMethod, signer, requestHash, negotiationHash,
          quoteNegotiatedAt, quoteExpiresAt, durationMs
        ) VALUES ('303779', 56, 'a2a', 'https://agent.example/grid', ?,
          'grid_trading', 'quote_verified', ?, ?, 'agentWallet', '100', ?,
          '0x0000000000000000000000000000000000000001',
          '0x0000000000000000000000000000000000000002',
          '0x0000000000000000000000000000000000000003',
          '1000', '0x0000000000000000000000000000000000000004', 18,
          'eip191', '0x0000000000000000000000000000000000000005',
          '0xrequest', '0xnegotiation', ?, ?, 25)`,
      ).bind(now - 4_000, now - 5_000, "0x0000000000000000000000000000000000000006", now - 4_000, now - 5_000, now + 56_000),
      env.DB.prepare(
        `INSERT INTO probe_observations (
          agentId, chainId, transport, endpoint, probedAt, probeCategory,
          outcome, observedMetadataUpdatedAt, errorCode, durationMs
        ) VALUES ('303779', 56, 'a2a', 'https://agent.example/grid', ?,
          'rebalancing', 'unreachable', ?, 'SELLER_TIMEOUT', 5000)`,
      ).bind(now - 2_000, now - 3_000),
      env.DB.prepare(
        `INSERT INTO probe_observations (
          agentId, chainId, transport, endpoint, probedAt, probeCategory,
          outcome, observedMetadataUpdatedAt, errorCode, durationMs
        ) VALUES ('303779', 56, 'a2a', 'https://agent.example/grid', ?,
          'grid_trading', 'unreachable', ?, 'LATE_BACKFILL', 10)`,
      ).bind(now - 8_000, now - 9_000),
      env.DB.prepare(
        `INSERT INTO scheduler_attempts (
          messageId, scheduledTime, attempt, phase, outcome, startedAt,
          finishedAt, upstreamRequests, d1Queries,
          rowsReadObservedBeforeLedger, rowsWrittenObservedBeforeLedger
        ) VALUES ('tick-1', ?, 1, 'probe', 'completed', ?, ?, 1, 12, 4, 1)`,
      ).bind(now - 1_500, now - 1_400, now - 1_000),
    ]);

    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/observations"),
      env,
      createExecutionContext(),
    );
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=60, must-revalidate");
    expect(body).toMatchObject({
      schemaVersion: 1,
      generatedAt: now,
      funnel: { registeredTotal: 309897, blockNumber: "118441354" },
      monitoring: {
        lastSchedulerAttemptAt: now - 1_000,
        lastSchedulerPhase: "probe",
        lastSchedulerOutcome: "completed",
        producerEnabled: false,
        consumerEnabled: false,
        cronIntervalMinutes: 5,
      },
    });
    expect(body.targets).toHaveLength(1);
    expect(body.targets.find((target: any) => target.agentId === "303779")).toMatchObject({
      agentId: "303779",
      declarationState: "current",
      attemptCount: 3,
      firstProbedAt: now - 8_000,
      lastProbedAt: now - 2_000,
      latest: {
        probeCategory: "rebalancing",
        outcome: "unreachable",
        durationMs: 5000,
        errorCode: "SELLER_TIMEOUT",
      },
      latestByCategory: {
        grid_trading: { outcome: "quote_verified" },
        rebalancing: { outcome: "unreachable" },
      },
      lastQuoteVerifiedAt: now - 4_000,
      lastQuoteVerifiedAtByCategory: { grid_trading: now - 4_000 },
    });
    expect(JSON.stringify(body)).not.toContain("0x0000000000000000000000000000000000000005");
    expect(JSON.stringify(body)).not.toContain("signer");

    const cached = await createWorker({ now: () => now + 1_000 }).fetch(
      new Request("https://worker.test/observations"),
      env,
      createExecutionContext(),
    );
    expect((await cached.json() as { generatedAt: number }).generatedAt).toBe(now);

    const otherScope = await createWorker({ now: () => now + 2_000 }).fetch(
      new Request("https://worker.test/observations"),
      {
        ...env,
        PROBE_AGENT_ALLOWLIST: "42",
        PROBE_ENDPOINT_ALLOWLIST: "https://agent.example.com/removed",
      } as unknown as Env,
      createExecutionContext(),
    );
    const otherBody = await otherScope.json() as { targets: Array<{ agentId: string }> };
    expect(otherBody.targets.map(({ agentId }) => agentId)).toEqual(["42"]);
  });

  it("rejects cache-busting query parameters on the public observations route", async () => {
    const response = await createWorker({ now: () => 1_788_000_000_000 }).fetch(
      new Request("https://worker.test/observations?nonce=1"),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed instead of scanning the global feed when wildcard egress is approved", async () => {
    const response = await createWorker({ now: () => 1_788_000_000_000 }).fetch(
      new Request("https://wildcard-worker.test/observations"),
      {
        ...env,
        PROBE_AGENT_ALLOWLIST: "*",
        PROBE_ENDPOINT_ALLOWLIST: "*",
        PROBE_GENERAL_EGRESS_APPROVED: "1",
      } as unknown as Env,
      createExecutionContext(),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves sanitized health from a migrated local D1", async () => {
    const response = await worker.fetch(
      new Request("https://worker.test/health"),
      env,
      createExecutionContext(),
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      plan: "free",
      schedulerMode: "single_phase",
      killSwitch: true,
      d1: { available: true },
    });
    expect(JSON.stringify(body)).not.toContain("SHARED_SECRET");
    expect(JSON.stringify(body)).not.toContain("runId");
  });

  it("has exactly the five WP1 application tables", async () => {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN (
         'probe_targets', 'probe_observations', 'funnel_snapshots',
         'hire_events', 'runtime_state'
       )
       ORDER BY name`,
    ).all<{ name: string }>();

    expect((result.results ?? []).map(({ name }) => name)).toEqual([
      "funnel_snapshots",
      "hire_events",
      "probe_observations",
      "probe_targets",
      "runtime_state",
    ]);
  });

  it("seeds the reviewed WP0 funnel snapshot", async () => {
    const snapshot = await env.DB.prepare(
      `SELECT registeredTotal, sourceSha256, blockNumber
       FROM funnel_snapshots`,
    ).first<{ registeredTotal: number; sourceSha256: string; blockNumber: string }>();

    expect(snapshot).toEqual({
      registeredTotal: 309897,
      sourceSha256: "a8149173eeb70fb19a38610e98e4e11ecbce7ccadcfc2c0e6e25fa14a075fe69",
      blockNumber: "118441354",
    });
  });

  it("allows one winner for concurrent lease acquisitions against real D1", async () => {
    const db = env.DB as unknown as D1DatabaseLike;
    const winners = await Promise.all([
      acquireSchedulerLease(db, { runId: "run-a", nowMs: 1_000, expiresAtMs: 10_000 }),
      acquireSchedulerLease(db, { runId: "run-b", nowMs: 1_000, expiresAtMs: 10_000 }),
    ]);

    expect(winners.filter(Boolean)).toHaveLength(1);
  });

  it("does no scheduled D1 work while the kill switch is active", async () => {
    await worker.scheduled(
      { scheduledTime: Date.now(), cron: "*/5 * * * *" },
      env,
      createExecutionContext(),
    );
    const state = await env.DB.prepare("SELECT COUNT(*) AS count FROM runtime_state")
      .first<{ count: number }>();

    expect(state?.count).toBe(0);
  });

  it("enforces the Free D1 query budget inside the Workers runtime", async () => {
    const raw = env.DB as unknown as D1DatabaseLike;
    const { db, budget } = createBudgetedD1Database(raw, 40);

    for (let index = 0; index < 40; index += 1) {
      await db.prepare("SELECT 1").first();
    }

    await expect(db.prepare("SELECT 1").first()).rejects.toBeInstanceOf(
      D1QueryBudgetExceededError,
    );
    expect(budget.used).toBe(40);
  });

  it("atomically records metered usage under the invocation start UTC date", async () => {
    const database = env.DB as unknown as D1DatabaseLike;
    await Promise.all([
      recordDailyBudget(database, {
        startedAtMs: Date.parse("2026-08-28T23:59:59.000Z"),
        finishedAtMs: Date.parse("2026-08-29T00:00:01.000Z"),
        outcome: "completed",
        upstreamRequests: 4,
        d1Queries: 11,
        rowsReadObservedBeforeLedger: 9,
        rowsWrittenObservedBeforeLedger: 5,
      }),
      recordDailyBudget(database, {
        startedAtMs: Date.parse("2026-08-28T12:00:00.000Z"),
        finishedAtMs: Date.parse("2026-08-28T12:00:01.000Z"),
        outcome: "failed",
        upstreamRequests: 1,
        d1Queries: 7,
        rowsReadObservedBeforeLedger: 3,
        rowsWrittenObservedBeforeLedger: 1,
      }),
    ]);

    const row = await env.DB.prepare(
      "SELECT textValue FROM runtime_state WHERE key = 'daily_budget_20260828'",
    ).first<{ textValue: string }>();
    expect(JSON.parse(row?.textValue ?? "{}")).toEqual({
      schemaVersion: 1,
      utcDate: "2026-08-28",
      measurementScope: "worker_metered_before_daily_ledger",
      updatedAt: Date.parse("2026-08-29T00:00:01.000Z"),
      invocations: 2,
      completed: 1,
      failed: 1,
      duplicate: 0,
      locked: 0,
      upstreamRequests: 5,
      d1Queries: 18,
      rowsReadObservedBeforeLedger: 12,
      rowsWrittenObservedBeforeLedger: 6,
    });
  });

  it("uses the runtime fetch binding for a real HEADER invocation", async () => {
    await runWp2Scheduled(
      { scheduledTime: 10_000, cron: "*/5 * * * *" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    );

    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");
    expect(JSON.parse(await runtimeText("last_header_summary") ?? "{}")).toMatchObject({
      phase: "header",
      status: "ok",
      received: 0,
      d1Queries: 5,
    });
  });

  it("runs one Queue phase and deduplicates its scheduled tick in real D1", async () => {
    await env.DB.prepare(
      "INSERT INTO runtime_state (key, textValue, updatedAt) VALUES ('next_scheduler_phase', 'probe', 9000)",
    ).run();
    const activeEnv = { ...env, KILL_SWITCH: "0" } as unknown as Env;
    const firstAck = vi.fn();
    const tick = { schemaVersion: 1, scheduledTime: Date.now() };

    await worker.queue(
      { messages: [{ ...queueMessage(tick), ack: firstAck }] },
      activeEnv,
      createExecutionContext(),
    );

    expect(firstAck).toHaveBeenCalledOnce();
    expect(await runtimeText("next_scheduler_phase")).toBe("header");
    expect(JSON.parse(await runtimeText("last_probe_summary") ?? "{}")).toMatchObject({
      phase: "probe",
      status: "ok",
      outcome: "metadata_unavailable",
      d1Queries: 8,
    });
    const firstSummary = await runtimeText("last_probe_summary");
    const duplicateAck = vi.fn();

    await worker.queue(
      { messages: [{ ...queueMessage(tick, 2), ack: duplicateAck }] },
      activeEnv,
      createExecutionContext(),
    );

    expect(duplicateAck).toHaveBeenCalledOnce();
    expect(await runtimeText("last_probe_summary")).toBe(firstSummary);
  });

  it("retries a failed Queue tick once and deduplicates it only after atomic success", async () => {
    let fetchCalls = 0;
    const runner = createWp2ScheduledRunner({
      now: (() => {
        let clock = 20_000;
        return () => clock++;
      })(),
      randomUUID: () => "queue-retry-run",
      fetch: (async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) throw new Error("temporary catalogue failure");
        return Response.json({ items: [], total: 0, limit: 25, offset: 0 });
      }) as typeof fetch,
    });
    const retryWorker = createWorker({ runScheduled: runner });
    const activeEnv = { ...env, KILL_SWITCH: "0" } as unknown as Env;
    const tick = { schemaVersion: 1, scheduledTime: Date.now() };
    const firstAck = vi.fn();

    await expect(retryWorker.queue(
      { messages: [{ ...queueMessage(tick), ack: firstAck }] },
      activeEnv,
      createExecutionContext(),
    )).rejects.toThrow("temporary catalogue failure");
    expect(firstAck).not.toHaveBeenCalled();

    const retryAck = vi.fn();
    await retryWorker.queue(
      { messages: [{ ...queueMessage(tick, 2), ack: retryAck }] },
      activeEnv,
      createExecutionContext(),
    );
    expect(retryAck).toHaveBeenCalledOnce();
    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");

    const duplicateAck = vi.fn();
    await retryWorker.queue(
      { messages: [{ ...queueMessage(tick, 3), ack: duplicateAck }] },
      activeEnv,
      createExecutionContext(),
    );
    expect(duplicateAck).toHaveBeenCalledOnce();
    expect(fetchCalls).toBe(2);
    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");
  });

  it("delays a locked Queue tick, then completes and deduplicates it after lease expiry", async () => {
    await env.DB.prepare(
      `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
       VALUES ('scheduler_lease', 'dead-owner', 30_000, 10_000)`,
    ).run();
    let fetchCalls = 0;
    const runner = createWp2ScheduledRunner({
      now: () => 20_000,
      randomUUID: () => "queue-after-expiry",
      fetch: (async () => {
        fetchCalls += 1;
        return Response.json({ items: [], total: 0, limit: 25, offset: 0 });
      }) as typeof fetch,
    });
    const retryWorker = createWorker({ runScheduled: runner });
    const activeEnv = { ...env, KILL_SWITCH: "0" } as unknown as Env;
    const tick = { schemaVersion: 1, scheduledTime: Date.now() };
    const lockedAck = vi.fn();
    const lockedRetry = vi.fn();

    await retryWorker.queue(
      { messages: [{ ...queueMessage(tick), ack: lockedAck, retry: lockedRetry }] },
      activeEnv,
      createExecutionContext(),
    );
    expect(lockedAck).not.toHaveBeenCalled();
    expect(lockedRetry).toHaveBeenCalledWith({ delaySeconds: 240 });
    expect(await runtimeInteger("last_queue_scheduled_time")).toBeNull();

    await env.DB.prepare(
      "UPDATE runtime_state SET integerValue = 0 WHERE key = 'scheduler_lease'",
    ).run();
    const completedAck = vi.fn();
    await retryWorker.queue(
      { messages: [{ ...queueMessage(tick, 2), ack: completedAck }] },
      activeEnv,
      createExecutionContext(),
    );
    expect(completedAck).toHaveBeenCalledOnce();
    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");

    const duplicateAck = vi.fn();
    await retryWorker.queue(
      { messages: [{ ...queueMessage(tick, 3), ack: duplicateAck }] },
      activeEnv,
      createExecutionContext(),
    );
    expect(duplicateAck).toHaveBeenCalledOnce();
    expect(fetchCalls).toBe(1);
    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");
  });

  it("persists a sanitized failure in D1 without advancing state", async () => {
    await env.DB.prepare(
      "INSERT INTO runtime_state (key, textValue, updatedAt) VALUES ('next_scheduler_phase', 'sweep', 9000)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO runtime_state (key, integerValue, updatedAt) VALUES ('sweep_offset', 17, 9000)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO runtime_state (key, textValue, updatedAt) VALUES ('header_high_water', '1000:9', 9000)",
    ).run();
    let clock = 10_000;
    const runner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "failure-run",
      executePhase: async () => {
        throw new Error("secret=https://private.example/token?raw-body");
      },
    });
    const config = loadConfig({ KILL_SWITCH: "0" });

    await expect(runner(
      { scheduledTime: 10_000, cron: "*/5 * * * *" },
      env,
      createExecutionContext(),
      config,
    )).rejects.toThrow();

    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");
    expect(await runtimeInteger("sweep_offset")).toBe(17);
    expect(await runtimeText("header_high_water")).toBe("1000:9");
    const health = await (await healthResponse(env.DB, config, 20_000)).json() as Record<string, unknown>;
    expect(health).toMatchObject({
      status: "degraded",
      lease: { active: false },
      lastPhase: { phase: "sweep", status: "error", errorCode: "PHASE_FAILED" },
    });
    expect(JSON.stringify(health)).not.toContain("private.example");
    expect(JSON.stringify(health)).not.toContain("raw-body");
  });

  it("counts an attempted upstream request in a failed phase summary", async () => {
    const runner = createWp2ScheduledRunner({
      now: () => 10_000,
      randomUUID: () => "failed-upstream-run",
      fetch: async () => new Response("unavailable", { status: 503 }),
    });

    await expect(runner(
      { scheduledTime: 10_000, cron: "*/5 * * * *" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).rejects.toThrow("HTTP 503");

    expect(JSON.parse(await runtimeText("last_header_summary") ?? "{}")).toMatchObject({
      phase: "header",
      status: "error",
      errorCode: "TRUST8004_HTTP_ERROR",
      requests: 1,
    });
  });

  it("records every scheduler outcome in the daily ledger", async () => {
    let clock = Date.parse("2026-08-28T10:00:00.000Z");
    const successRunner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "daily-success",
      executePhase: async () => {},
    });
    await successRunner(
      { scheduledTime: clock, cron: "queue" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    );

    const failureRunner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "daily-failure",
      executePhase: async () => { throw new Error("controlled failure"); },
    });
    await expect(failureRunner(
      { scheduledTime: clock, cron: "queue" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).rejects.toThrow("controlled failure");

    await env.DB.prepare(
      `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
       VALUES ('scheduler_lease', 'other-run', ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         textValue = excluded.textValue,
         integerValue = excluded.integerValue,
         updatedAt = excluded.updatedAt`,
    ).bind(clock + 10_000, clock).run();
    const lockedRunner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "daily-locked",
      executePhase: async () => { throw new Error("must not execute"); },
    });
    await expect(lockedRunner(
      { scheduledTime: clock, cron: "queue" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).resolves.toBe("locked");

    await env.DB.prepare(
      `UPDATE runtime_state SET textValue = NULL, integerValue = 0, updatedAt = ?
       WHERE key = 'scheduler_lease'`,
    ).bind(clock).run();
    await env.DB.prepare(
      `INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
       VALUES ('last_queue_scheduled_time', NULL, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         textValue = NULL,
         integerValue = excluded.integerValue,
         updatedAt = excluded.updatedAt`,
    ).bind(clock + 10_000, clock).run();
    const duplicateRunner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => "daily-duplicate",
      executePhase: async () => { throw new Error("must not execute"); },
    });
    await expect(duplicateRunner(
      { scheduledTime: clock, cron: "queue" },
      env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).resolves.toBe("duplicate");

    const row = await env.DB.prepare(
      "SELECT textValue FROM runtime_state WHERE key = 'daily_budget_20260828'",
    ).first<{ textValue: string }>();
    expect(JSON.parse(row?.textValue ?? "{}")).toMatchObject({
      invocations: 4,
      completed: 1,
      failed: 1,
      duplicate: 1,
      locked: 1,
      upstreamRequests: 0,
      d1Queries: 16,
      rowsReadObservedBeforeLedger: expect.any(Number),
      rowsWrittenObservedBeforeLedger: expect.any(Number),
    });
  });

  it("runs HEADER and rolling SWEEP atomically and preserves a removed endpoint", async () => {
    let headerIncludesAgent = true;
    let detailIncludesEndpoint = true;
    const catalogAgent = (agentId: string, includeEndpoint: boolean) => ({
      chainId: 56,
      agentId,
      name: `Agent ${agentId}`,
      registeredAt: 1_000,
      metadataUpdatedAt: 900,
      metadataReasonCode: "ok",
      services: includeEndpoint
        ? [{ name: "ERC-8183", endpoint: "https://seller.example.org/quote" }]
        : [],
      endpoints: [],
    });
    const fetchCatalog = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/agents")) {
        const items = headerIncludesAgent ? [catalogAgent("16", true)] : [];
        return Response.json({
          items,
          total: items.length,
          limit: Number(url.searchParams.get("limit")),
          offset: Number(url.searchParams.get("offset")),
        });
      }
      const agentId = url.pathname.split("56:")[1];
      if (agentId === undefined) return new Response(null, { status: 404 });
      return Response.json(catalogAgent(agentId, agentId === "16" && detailIncludesEndpoint));
    };
    let clock = 10_000;
    const runner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => `run-${clock}`,
      fetch: fetchCatalog as typeof fetch,
    });
    const config = loadConfig({
      PROBE_AGENT_ALLOWLIST: "303779",
      PROBE_ENDPOINT_ALLOWLIST: "https://bnb-agent-marketplace-ruby.vercel.app/grid",
    });
    const controller = { scheduledTime: 10_000, cron: "*/5 * * * *" };
    const context = createExecutionContext();

    await runner(controller, env, context, config); // HEADER
    expect(JSON.parse(await runtimeText("last_header_summary") ?? "{}")).toMatchObject({
      candidateTargets: 1,
      materialWrites: 1,
      d1Queries: 7,
    });
    expect(await env.DB.prepare(
      "SELECT declarationState FROM probe_targets WHERE agentId = '16'",
    ).first()).toEqual({ declarationState: "current" });
    expect(await runtimeText("next_scheduler_phase")).toBe("sweep");

    await runner(controller, env, context, config); // SWEEP page 1/2
    expect(await runtimeInteger("sweep_offset")).toBe(4);
    expect(await runtimeText("next_scheduler_phase")).toBe("probe");

    await runner(controller, env, context, config); // PROBE bootstraps Grid; metadata is unavailable
    expect(await runtimeText("next_scheduler_phase")).toBe("header");

    headerIncludesAgent = false;
    detailIncludesEndpoint = false;
    await runner(controller, env, context, config); // HEADER, identical target data
    await runner(controller, env, context, config); // SWEEP page 2/2, round complete
    expect(await runtimeInteger("sweep_round")).toBe(1);
    await runner(controller, env, context, config); // PROBE retries the safe Grid bootstrap
    await runner(controller, env, context, config); // HEADER empty
    await runner(controller, env, context, config); // SWEEP page contains agent 16

    expect(await env.DB.prepare(
      "SELECT declarationState FROM probe_targets WHERE agentId = '16'",
    ).first()).toEqual({ declarationState: "removed" });
    const summary = JSON.parse(await runtimeText("last_sweep_summary") ?? "{}");
    expect(summary).toMatchObject({ requests: 4, removedTargets: 1 });
  });
});

async function runtimeText(key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT textValue FROM runtime_state WHERE key = ?")
    .bind(key)
    .first<{ textValue: string | null }>();
  return row?.textValue ?? null;
}

async function runtimeInteger(key: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT integerValue FROM runtime_state WHERE key = ?")
    .bind(key)
    .first<{ integerValue: number | null }>();
  return row?.integerValue ?? null;
}
