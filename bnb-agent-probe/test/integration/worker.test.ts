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
import { clearCatalogFixtures } from "./catalog-fixtures";

beforeEach(async () => {
  await clearCatalogFixtures();
  await env.DB.prepare("DELETE FROM runtime_state").run();
  await env.DB.prepare("DELETE FROM probe_observations").run();
  await env.DB.prepare("DELETE FROM probe_targets").run();
});

function catalogObservationBody(overrides: Record<string, unknown> = {}) {
  const now = 1_788_000_000_000;
  return {
    schemaVersion: 2,
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
  it("serves the same versioned v2 contract fixture consumed by the application", async () => {
    const fixture = JSON.parse(
      (env as unknown as { CATALOG_API_V2_FIXTURE: string }).CATALOG_API_V2_FIXTURE,
    ) as { list: Record<string, unknown>; detail: Record<string, unknown> };
    const now = 1_788_000_000_000;
    const endpointKey = "a".repeat(64);
    const originKey = "b".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, owner, metadataUri, name, categoriesJson, marketplaceConfigured, metadataState,
      indexState, registeredAt, blockNumber, firstSeenAt, lastSeenAt, priority
    ) VALUES ('eip155:56:42', '42', 56, '0x1111111111111111111111111111111111111111',
      'ipfs://bafybeigdyrzt5-example', 'Contract fixture seller', '["grid_trading"]', 0,
      'ok', 'current', ?, '123', ?, ?, 80)`).bind(now, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey, lastProbedAt,
      nextProbeAt, consecutiveFailures, declaredProtocol, role, validationProtocol, eligibility,
      lastAttemptAt, lastAttemptOutcome, lastSuccessfulAt
    ) VALUES (?, 'a2a', 'https://seller.example/a2a', ?, 'safe', 'eip155:56:42', ?, ?, 0,
      'a2a', 'operational', 'a2a', 'eligible', ?, 'protocol_valid', ?)`)
      .bind(endpointKey, originKey, now, now + 43_200_000, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority
    ) VALUES ('eip155:56:42', ?, 'current', ?, ?, 80)`).bind(endpointKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt,
      httpStatus, durationMs, detailsJson, validationKind, verificationLevel
    ) VALUES ('contract-attempt', 'eip155:56:42', ?, 'a2a', 'worker_probe', 'protocol_valid', ?, ?,
      200, 42, '{"schemaVersion":2,"stageDurationsMs":{"agentCard":42}}', 'protocol', 'platform_observed')`)
      .bind(endpointKey, now, now + 43_200_000).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_admission (
      agentKey, state, commerceTransport, endpointKey, chainId, configurationVersion, reasonCode
    ) VALUES ('eip155:56:42', 'candidate', 'a2a', ?, 56, 'contract-v2', 'QUOTE_VERIFICATION_REQUIRED')`)
      .bind(endpointKey).run();
    const app = createWorker({ now: () => now });

    const list = await app.fetch(new Request("https://worker.test/catalog-agents"), env);
    expect(await list.json()).toMatchObject(fixture.list);
    const detail = await app.fetch(new Request("https://worker.test/catalog-agent/42"), env);
    expect(await detail.json()).toMatchObject(fixture.detail);
  });

  it("filters normalized catalog candidates using platform evidence, never browser claims", async () => {
    const now = 1_788_000_000_000;
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, categoriesJson, metadataState, indexState, firstSeenAt, lastSeenAt, priority
    ) VALUES
      ('eip155:56:1', '1', 56, 'Agent one', '["grid_trading"]', 'ok', 'current', ?, ?, 60),
      ('eip155:56:2', '2', 56, 'Agent two', '["yield_optimisation"]', 'ok', 'current', ?, ?, 40)`).bind(now, now, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey, nextProbeAt, consecutiveFailures,
      declaredProtocol, role, validationProtocol, eligibility
    ) VALUES
      (?, 'a2a', 'https://one.example/a2a', 'origin-one', 'safe', 'eip155:56:1', 0, 0,
        'a2a', 'operational', 'a2a', 'eligible'),
      (?, 'mcp', 'https://two.example/mcp', 'origin-two', 'safe', 'eip155:56:2', 0, 0,
        'mcp', 'operational', 'mcp', 'eligible')`).bind(
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
      agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt, durationMs, detailsJson,
      verificationLevel
    ) VALUES
      ('eip155:56:1', ?, 'a2a', 'worker_probe', 'protocol_valid', ?, ?, 20, '{}', 'platform_observed'),
      ('eip155:56:2', ?, 'mcp', 'browser_reported', 'protocol_valid', ?, ?, 30, '{}', 'user_observed')`).bind(
      "a".repeat(64), now, now + 900_000,
      "b".repeat(64), now, now + 900_000,
    ).run();
    const app = createWorker({ now: () => now });
    const context = createExecutionContext();

    const a2a = await app.fetch(new Request("https://worker.test/catalog-agents?status=a2a"), env, context);
    expect(a2a.status).toBe(200);
    expect(await a2a.json()).toMatchObject({ total: 1, items: [{ agentId: "1" }] });

    const mcpOnly = await app.fetch(new Request("https://worker.test/catalog-agents?status=mcp_only"), env, context);
    expect(mcpOnly.status).toBe(200);
    expect(await mcpOnly.json()).toMatchObject({ total: 1, items: [{ agentId: "2" }] });

    const combined = await app.fetch(new Request("https://worker.test/catalog-agents?status=declared&status=a2a"), env, context);
    expect(combined.status).toBe(200);
    expect(await combined.json()).toMatchObject({
      statuses: ["declared", "a2a"],
      total: 1,
      items: [{ agentId: "1" }],
    });

    const outcomes = await app.fetch(new Request("https://worker.test/catalog-agents?status=declared&category=grid_trading&category=yield_optimisation"), env, context);
    expect(await outcomes.json()).toMatchObject({
      categories: ["grid_trading", "yield_optimisation"],
      total: 2,
    });

    const pending = await app.fetch(new Request("https://worker.test/catalog-agents?status=pending"), env, context);
    expect(await pending.json()).toMatchObject({
      total: 1,
      items: [{ agentId: "2", observations: [{ source: "browser_reported" }] }],
    });

    await env.DB.prepare(`INSERT INTO catalog_agent_admission (
      agentKey, state, commerceTransport, endpointKey, chainId, provider,
      validatedAt, configurationVersion, reasonCode
    ) VALUES ('eip155:56:1', 'admitted', 'a2a', ?, 56, 'test', ?, 'test-v1', 'fixture')`)
      .bind("a".repeat(64), now).run();
    const hireable = await app.fetch(new Request("https://worker.test/catalog-agents?status=hireable"), env, context);
    expect(await hireable.json()).toMatchObject({ total: 1, items: [{ agentId: "1" }] });
  });

  it("does not call an externally declared resource hireable", async () => {
    const now = 1_788_000_000_000;
    const agentKey = "eip155:56:9001";
    const endpointKey = "e".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, categoriesJson, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES (?, '9001', 56, 'External only', '[]', 'ok', 'current', ?, ?)`).bind(agentKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey,
      nextProbeAt, consecutiveFailures, declaredProtocol, role, validationProtocol, eligibility
    ) VALUES (?, 'web', 'https://example.com', 'external-origin', 'safe', NULL, NULL, 0,
      'web', 'external', NULL, 'unsupported')`).bind(endpointKey).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES (?, ?, 'current', ?, ?)`).bind(agentKey, endpointKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_admission (
      agentKey, state, commerceTransport, endpointKey, chainId, reasonCode
    ) VALUES (?, 'admitted', 'a2a', ?, 56, 'fixture')`).bind(agentKey, endpointKey).run();

    const app = createWorker({ now: () => now });
    const response = await app.fetch(new Request(
      "https://worker.test/catalog-agents?status=hireable&inventory=registry",
    ), env, createExecutionContext());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 0, items: [] });
  });

  it("excludes agents with a seller declaration from the MCP-only filter", async () => {
    const now = 1_788_000_000_000;
    const agentKey = "eip155:56:9004";
    const mcpEndpoint = "3".repeat(64);
    const sellerEndpoint = "4".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES (?, '9004', 56, 'ok', 'current', ?, ?)`).bind(agentKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, safety, nextProbeAt, declaredProtocol,
      role, validationProtocol, eligibility
    ) VALUES
      (?, 'mcp', 'https://mixed.example/mcp', 'safe', ?, 'mcp', 'operational', 'mcp', 'eligible'),
      (?, 'a2a', 'https://mixed.example/a2a', 'safe', ?, 'a2a', 'operational', 'a2a', 'eligible')`)
      .bind(mcpEndpoint, now, sellerEndpoint, now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES (?, ?, 'current', ?, ?), (?, ?, 'current', ?, ?)`)
      .bind(agentKey, mcpEndpoint, now, now, agentKey, sellerEndpoint, now, now).run();

    const app = createWorker({ now: () => now });
    const response = await app.fetch(new Request(
      "https://worker.test/catalog-agents?status=mcp_only&inventory=registry",
    ), env, createExecutionContext());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 0, items: [] });
  });

  it("uses the latest cryptographic quote outcome for quote filters", async () => {
    const now = 1_788_000_000_000;
    const agentKey = "eip155:56:9002";
    const endpointKey = "f".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, categoriesJson, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES (?, '9002', 56, 'Quote changed', '[]', 'ok', 'current', ?, ?)`).bind(agentKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey,
      nextProbeAt, consecutiveFailures, declaredProtocol, role, validationProtocol, eligibility
    ) VALUES (?, 'a2a', 'https://quote.example/a2a', 'quote-origin', 'safe', ?, ?, 0,
      'a2a', 'operational', 'a2a', 'eligible')`).bind(endpointKey, agentKey, now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES (?, ?, 'current', ?, ?)`).bind(agentKey, endpointKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt, durationMs,
      detailsJson, validationKind, verificationLevel
    ) VALUES (?, ?, 'a2a', 'buyer_refresh', 'quote_verified', ?, ?, 10, '{}', 'quote', 'cryptographic'),
      (?, ?, 'a2a', 'buyer_refresh', 'quote_rejected', ?, NULL, 10, '{}', 'quote', 'cryptographic')`)
      .bind(agentKey, endpointKey, now - 100, now + 900_000, agentKey, endpointKey, now).run();

    const app = createWorker({ now: () => now });
    const verified = await app.fetch(new Request(
      "https://worker.test/catalog-agents?quote=verified&inventory=registry",
    ), env, createExecutionContext());
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ total: 0, items: [] });
  });

  it("requires quote evidence for the currently admitted commerce endpoint", async () => {
    const now = 1_788_000_000_000;
    const agentKey = "eip155:56:9003";
    const admittedEndpoint = "1".repeat(64);
    const otherEndpoint = "2".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES (?, '9003', 56, 'ok', 'current', ?, ?)`).bind(agentKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, safety, nextProbeAt, declaredProtocol,
      role, validationProtocol, eligibility
    ) VALUES
      (?, 'a2a', 'https://admitted.example/a2a', 'safe', ?, 'a2a', 'operational', 'a2a', 'eligible'),
      (?, 'a2a', 'https://other.example/a2a', 'safe', ?, 'a2a', 'operational', 'a2a', 'eligible')`)
      .bind(admittedEndpoint, now, otherEndpoint, now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES (?, ?, 'current', ?, ?), (?, ?, 'current', ?, ?)`)
      .bind(agentKey, admittedEndpoint, now, now, agentKey, otherEndpoint, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_admission (
      agentKey, state, commerceTransport, endpointKey, chainId, reasonCode
    ) VALUES (?, 'admitted', 'a2a', ?, 56, 'fixture')`).bind(agentKey, admittedEndpoint).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt, durationMs,
      detailsJson, validationKind, verificationLevel
    ) VALUES (?, ?, 'a2a', 'buyer_refresh', 'quote_verified', ?, ?, 10, '{}', 'quote', 'cryptographic')`)
      .bind(agentKey, otherEndpoint, now, now + 900_000).run();

    const app = createWorker({ now: () => now });
    const withoutAdmittedQuote = await app.fetch(new Request(
      "https://worker.test/catalog-agents?quote=verified&inventory=registry",
    ), env, createExecutionContext());
    expect(await withoutAdmittedQuote.json()).toMatchObject({ total: 0, items: [] });

    await env.DB.prepare(`INSERT INTO catalog_observations (
      agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt, durationMs,
      detailsJson, validationKind, verificationLevel
    ) VALUES (?, ?, 'a2a', 'buyer_refresh', 'quote_verified', ?, ?, 10, '{}', 'quote', 'cryptographic')`)
      .bind(agentKey, admittedEndpoint, now, now + 900_000).run();
    const withAdmittedQuote = await app.fetch(new Request(
      "https://worker.test/catalog-agents?quote=verified&inventory=registry",
    ), env, createExecutionContext());
    expect(await withAdmittedQuote.json()).toMatchObject({ total: 1, items: [{ agentId: "9003" }] });
  });

  it("does not treat onchain reads as platform reachability evidence", async () => {
    const now = 1_788_000_000_000;
    const agentKey = "eip155:56:7002";
    const endpointKey = "c".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, categoriesJson, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES (?, '7002', 56, 'Chain-only evidence', '[]', 'ok', 'current', ?, ?)`)
      .bind(agentKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey,
      nextProbeAt, consecutiveFailures, declaredProtocol, role, validationProtocol, eligibility
    ) VALUES (?, 'a2a', 'https://chain-only.example/a2a', 'chain-only', 'safe', ?, ?, 0,
      'a2a', 'operational', 'a2a', 'eligible')`)
      .bind(endpointKey, agentKey, now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES (?, ?, 'current', ?, ?)`)
      .bind(agentKey, endpointKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt,
      expiresAt, durationMs, detailsJson, validationKind, verificationLevel
    ) VALUES ('chain-only-read', ?, ?, 'a2a', 'chain_read', 'protocol_valid', ?, ?, 1, '{}', 'protocol', 'onchain')`)
      .bind(agentKey, endpointKey, now, now + 900_000).run();

    const app = createWorker({ now: () => now });
    const context = createExecutionContext();
    const pending = await app.fetch(new Request("https://worker.test/catalog-agents?status=pending"), env, context);
    expect(await pending.json()).toMatchObject({ total: 1, items: [{ agentId: "7002" }] });

    const never = await app.fetch(new Request(
      "https://worker.test/catalog-agents?reachability=never&protocol=a2a",
    ), env, context);
    expect(await never.json()).toMatchObject({ total: 1, items: [{ agentId: "7002" }] });

    const live = await app.fetch(new Request(
      "https://worker.test/catalog-agents?reachability=live&protocol=a2a",
    ), env, context);
    expect(await live.json()).toMatchObject({ total: 0, items: [] });
  });

  it("does not transfer a representative endpoint observation to another declarer", async () => {
    const now = 1_788_000_000_000;
    const endpointKey = "4".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, categoriesJson, metadataState, indexState,
      firstSeenAt, lastSeenAt, priority
    ) VALUES
      ('eip155:56:7301', '7301', 56, 'Representative', '[]', 'ok', 'current', ?, ?, 2),
      ('eip155:56:7302', '7302', 56, 'Shared declarer', '[]', 'ok', 'current', ?, ?, 1)`)
      .bind(now, now, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey,
      nextProbeAt, consecutiveFailures, declaredProtocol, role, validationProtocol, eligibility
    ) VALUES (?, 'a2a', 'https://shared-agent.example/a2a', 'shared-agent', 'safe',
      'eip155:56:7301', ?, 0, 'a2a', 'operational', 'a2a', 'eligible')`)
      .bind(endpointKey, now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority
    ) VALUES
      ('eip155:56:7301', ?, 'current', ?, ?, 2),
      ('eip155:56:7302', ?, 'current', ?, ?, 1)`)
      .bind(endpointKey, now, now, endpointKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt,
      expiresAt, durationMs, detailsJson, validationKind, verificationLevel
    ) VALUES ('representative-success', 'eip155:56:7301', ?, 'a2a', 'worker_probe',
      'protocol_valid', ?, ?, 25, '{}', 'protocol', 'platform_observed')`)
      .bind(endpointKey, now, now + 900_000).run();

    const app = createWorker({ now: () => now });
    const live = await app.fetch(new Request(
      "https://worker.test/catalog-agents?reachability=live&protocol=a2a",
    ), env, createExecutionContext());
    expect(await live.json()).toMatchObject({ total: 1, items: [{ agentId: "7301" }] });

    const sharedDeclarer = await app.fetch(
      new Request("https://worker.test/catalog-agent/7302"), env, createExecutionContext(),
    );
    expect(await sharedDeclarer.json()).toMatchObject({
      agentId: "7302",
      resources: [{ endpointKey, attemptCount: 0, latestEvidence: null }],
      state: { operationalStatus: "pending", freshness: "never" },
    });
  });

  it("does not reuse a representative endpoint's fresh projection for another declarer", async () => {
    const now = 1_788_000_000_000;
    const endpointKey = "5".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, metadataState, indexState,
      firstSeenAt, lastSeenAt
    ) VALUES
      ('eip155:56:7401', '7401', 56, 'Representative', 'ok', 'current', ?, ?),
      ('eip155:56:7402', '7402', 56, 'Shared declarer', 'ok', 'current', ?, ?)`)
      .bind(now, now, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey,
      lastAttemptAt, lastAttemptOutcome, lastSuccessfulAt, nextProbeAt,
      consecutiveFailures, declaredProtocol, role, validationProtocol, eligibility
    ) VALUES (?, 'a2a', 'https://shared-agent.example/a2a', 'shared-agent', 'safe',
      'eip155:56:7401', ?, 'protocol_valid', ?, ?, 0, 'a2a', 'operational', 'a2a', 'eligible')`)
      .bind(endpointKey, now, now, now + 900_000).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES
      ('eip155:56:7401', ?, 'current', ?, ?),
      ('eip155:56:7402', ?, 'current', ?, ?)`)
      .bind(endpointKey, now, now, endpointKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt,
      expiresAt, durationMs, detailsJson, validationKind, verificationLevel
    ) VALUES ('representative-fresh', 'eip155:56:7401', ?, 'a2a', 'worker_probe',
      'protocol_valid', ?, ?, 25, '{}', 'protocol', 'platform_observed')`)
      .bind(endpointKey, now, now + 900_000).run();

    const send = vi.fn(async () => undefined);
    const privateEnv = {
      ...env, BUYER_OBSERVATION_SECRET: "catalog-secret", WP2_QUEUE: { send },
    } as unknown as Env;
    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/catalog-validations", {
        method: "POST",
        headers: { authorization: "Bearer catalog-secret", "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 2, agentId: "7402", endpointKey, validationKind: "protocol",
        }),
      }),
      privateEnv,
      createExecutionContext(),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "queued", reused: false });
    expect(send).toHaveBeenCalledOnce();

    const detail = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/catalog-agent/7402"),
      privateEnv,
      createExecutionContext(),
    );
    expect(await detail.json()).toMatchObject({
      resources: [{
        lastAttemptAt: null,
        lastAttemptOutcome: null,
        lastSuccessfulAt: null,
        nextProbeAt: null,
        attemptCount: 0,
        latestEvidence: null,
      }],
    });
  });

  it("serves the v2 catalog contract with combinable filters, cursor paging, and resource evidence", async () => {
    const now = 1_788_000_000_000;
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, categoriesJson, metadataState, indexState,
      firstSeenAt, lastSeenAt, priority, metadataVersion, metadataObservedAt, policyVersion
    ) VALUES
      ('eip155:56:10', '10', 56, 'Live MCP', '["grid_trading"]', 'ok', 'current',
        ?, ?, 80, 'meta-10', ?, 2),
      ('eip155:56:11', '11', 56, 'Failed A2A', '["yield_optimisation"]', 'ok', 'current',
        ?, ?, 70, 'meta-11', ?, 2)`).bind(now, now, now, now, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey,
      nextProbeAt, consecutiveFailures, declaredProtocol, role, validationProtocol,
      externalKind, eligibility, lastAttemptAt, lastAttemptOutcome, lastSuccessfulAt
    ) VALUES
      (?, 'mcp', 'https://live.example/mcp', 'live', 'safe', 'eip155:56:10',
        ?, 0, 'mcp', 'operational', 'mcp', NULL, 'eligible', ?, 'protocol_valid', ?),
      (?, 'web', 'https://live.example/', 'live', 'safe', NULL,
        NULL, 0, 'web', 'external', NULL, 'website', 'unsupported', NULL, NULL, NULL),
      (?, 'a2a', 'https://failed.example/.well-known/agent-card.json', 'failed', 'safe', 'eip155:56:11',
        ?, 2, 'a2a', 'operational', 'a2a', NULL, 'eligible', ?, 'timeout', NULL)`)
      .bind("c".repeat(64), now + 60_000, now, now, "d".repeat(64), "e".repeat(64), now + 60_000, now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority, rawServiceLabel, rawSource, metadataVersion
    ) VALUES
      ('eip155:56:10', ?, 'current', ?, ?, 80, 'mcp', 'services', 'meta-10'),
      ('eip155:56:10', ?, 'current', ?, ?, 1, 'website', 'services', 'meta-10'),
      ('eip155:56:11', ?, 'current', ?, ?, 70, 'a2a', 'services', 'meta-11')`)
      .bind("c".repeat(64), now, now, "d".repeat(64), now, now, "e".repeat(64), now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt,
      durationMs, detailsJson, validationKind, verificationLevel
    ) VALUES
      ('attempt-live', 'eip155:56:10', ?, 'mcp', 'worker_probe', 'protocol_valid', ?, ?, 42,
        '{"schemaVersion":2,"stageDurations":{"initialize":12,"toolsList":30}}', 'protocol', 'platform_observed'),
      ('attempt-failed', 'eip155:56:11', ?, 'a2a', 'worker_probe', 'timeout', ?, NULL, 5000,
        '{"schemaVersion":2,"stage":"agent_card"}', 'protocol', 'platform_observed')`)
      .bind("c".repeat(64), now, now + 86_400_000, "e".repeat(64), now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_admission (
      agentKey, state, commerceTransport, endpointKey, chainId, provider, validatedAt, configurationVersion
    ) VALUES ('eip155:56:10', 'admitted', 'a2a', ?, 56,
      '0x1111111111111111111111111111111111111111', ?, 'quote-v1')`)
      .bind("c".repeat(64), now).run();
    await env.DB.prepare(`INSERT INTO catalog_ingest_tasks (
      agentKey, metadataVersion, nextDeclarationIndex, declarationCount, status, requestedBy,
      priority, generationStartedAt, updatedAt, attemptCount, retryAt
    ) VALUES ('eip155:56:10', 'meta-10', 2, 2, 'completed', 'header', 80, ?, ?, 1, 0)`)
      .bind(now, now).run();

    const app = createWorker({ now: () => now });
    const context = createExecutionContext();
    const filtered = await app.fetch(new Request(
      "https://worker.test/catalog-agents?protocol=mcp&reachability=live&commerce=admitted&chain=56&category=grid_trading&limit=1",
    ), env, context);
    expect(filtered.status).toBe(200);
    expect(await filtered.json()).toMatchObject({
      schemaVersion: 2,
      apiVersion: 2,
      filters: {
        protocols: ["mcp"], reachability: ["live"], commerce: ["admitted"], chainId: 56,
      },
      total: 1,
      nextCursor: null,
      items: [{
        agentId: "10",
        platformAttemptCount: 1,
        state: { operationalStatus: "platform_reachable", commerceStatus: "admitted" },
      }],
    });

    const failed = await app.fetch(new Request(
      "https://worker.test/catalog-agents?latestFailure=true&protocol=a2a",
    ), env, context);
    expect(await failed.json()).toMatchObject({ total: 1, items: [{ agentId: "11" }] });

    const detail = await app.fetch(new Request("https://worker.test/catalog-agent/10"), env, context);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      schemaVersion: 2,
      apiVersion: 2,
      agentId: "10",
      provenance: { source: "trust8004", metadataVersion: "meta-10" },
      ingest: { status: "completed", nextDeclarationIndex: 2, declarationCount: 2 },
      resources: [
        {
          role: "operational",
          validationProtocol: "mcp",
          attemptCount: 1,
          latestEvidence: { attemptId: "attempt-live", outcome: "protocol_valid" },
        },
        { role: "external", externalKind: "website", attemptCount: 0, latestEvidence: null },
      ],
      state: { canRequestInfrastructureValidation: true },
      policyVersion: 2,
    });
  });

  it("treats a fresh ERC-8183 HTTP health observation as live reachability", async () => {
    const now = 1_788_000_000_000;
    const endpointKey = "9".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, categoriesJson, metadataState, indexState,
      firstSeenAt, lastSeenAt, priority
    ) VALUES ('eip155:56:8183', '8183', 56, 'ERC-8183 seller', '["grid_trading"]', 'ok', 'current', ?, ?, 80)`)
      .bind(now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey,
      nextProbeAt, consecutiveFailures, declaredProtocol, role, validationProtocol,
      eligibility, lastAttemptAt, lastAttemptOutcome, lastSuccessfulAt
    ) VALUES (?, 'erc8183_http', 'https://seller.example/jobs', 'seller', 'safe',
      'eip155:56:8183', ?, 0, 'erc8183_http', 'operational', 'erc8183_http',
      'eligible', ?, 'protocol_valid', ?)`)
      .bind(endpointKey, now + 60_000, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority
    ) VALUES ('eip155:56:8183', ?, 'current', ?, ?, 80)`)
      .bind(endpointKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt,
      expiresAt, durationMs, detailsJson, validationKind, verificationLevel
    ) VALUES ('erc8183-live', 'eip155:56:8183', ?, 'erc8183_http', 'worker_probe',
      'protocol_valid', ?, ?, 25, '{}', 'protocol', 'platform_observed')`)
      .bind(endpointKey, now, now + 360 * 60_000).run();

    const app = createWorker({ now: () => now });
    const response = await app.fetch(new Request(
      "https://worker.test/catalog-agents?protocol=erc8183_http&reachability=live",
    ), env, createExecutionContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total: 1,
      items: [{ agentId: "8183", state: { operationalStatus: "platform_reachable", freshness: "live" } }],
    });
  });

  it("does not expose user-level quote claims or mislabeled chain rows as verified evidence", async () => {
    const now = 1_788_000_000_000;
    const agentKey = "eip155:56:7200";
    const endpointKey = "8".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, categoriesJson, metadataState, indexState,
      firstSeenAt, lastSeenAt, priority
    ) VALUES (?, '7200', 56, 'Evidence filtering', '[]', 'ok', 'current', ?, ?, 1)`)
      .bind(agentKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey,
      nextProbeAt, consecutiveFailures, declaredProtocol, role, validationProtocol, eligibility
    ) VALUES (?, 'a2a', 'https://evidence-filter.example/a2a', 'evidence-filter', ?, ?,
      ?, 0, 'a2a', 'operational', 'a2a', 'eligible')`)
      .bind(endpointKey, "safe", agentKey, now).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES (?, ?, 'current', ?, ?)`)
      .bind(agentKey, endpointKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt,
      expiresAt, durationMs, detailsJson, validationKind, verificationLevel
    ) VALUES
      ('user-quote-claim', ?, ?, 'erc8183', 'browser_reported', 'quote_rejected', ?, ?, 1, '{}', 'quote', 'user_observed'),
      ('mislabeled-chain', ?, ?, 'a2a', 'chain_read', 'protocol_valid', ?, ?, 1, '{}', 'protocol', 'onchain')`)
      .bind(agentKey, endpointKey, now, now + 900_000, agentKey, endpointKey, now, now + 900_000).run();

    const detail = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/catalog-agent/7200"), env, createExecutionContext(),
    );

    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      quote: null,
      onchainReferences: [],
      state: { quoteStatus: "not_supported", canPrepareHire: false },
    });
  });

  it("does not classify a successful endpoint as live after a newer platform failure", async () => {
    const now = 1_788_000_000_000;
    const endpointKey = "7".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, categoriesJson, metadataState, indexState,
      firstSeenAt, lastSeenAt, priority
    ) VALUES ('eip155:56:7001', '7001', 56, 'Flaky endpoint', '[]', 'ok', 'current', ?, ?, 20)`)
      .bind(now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey,
      nextProbeAt, consecutiveFailures, declaredProtocol, role, validationProtocol,
      eligibility, lastAttemptAt, lastAttemptOutcome, lastSuccessfulAt
    ) VALUES (?, 'a2a', 'https://flaky.example/a2a', 'flaky', 'safe',
      'eip155:56:7001', ?, 1, 'a2a', 'operational', 'a2a', 'eligible', ?, 'timeout', ?)`)
      .bind(endpointKey, now, now, now - 1_000).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority
    ) VALUES ('eip155:56:7001', ?, 'current', ?, ?, 20)`)
      .bind(endpointKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt,
      expiresAt, durationMs, detailsJson, validationKind, verificationLevel
    ) VALUES
      ('flaky-success', 'eip155:56:7001', ?, 'a2a', 'worker_probe', 'protocol_valid', ?, ?, 20, '{}', 'protocol', 'platform_observed'),
      ('flaky-failure', 'eip155:56:7001', ?, 'a2a', 'worker_probe', 'timeout', ?, NULL, 20, '{}', 'protocol', 'platform_observed')`)
      .bind(endpointKey, now - 1_000, now + 900_000, endpointKey, now).run();

    const app = createWorker({ now: () => now });
    const live = await app.fetch(new Request(
      "https://worker.test/catalog-agents?reachability=live&protocol=a2a",
    ), env, createExecutionContext());
    expect(await live.json()).toMatchObject({ total: 0, items: [] });

    const historical = await app.fetch(new Request(
      "https://worker.test/catalog-agents?reachability=historical&protocol=a2a",
    ), env, createExecutionContext());
    expect(await historical.json()).toMatchObject({ total: 1, items: [{ agentId: "7001" }] });
  });

  it("can roll catalog reads back to the compatibility contract independently", async () => {
    const now = 1_788_000_000_000;
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, name, categoriesJson, metadataState, indexState,
      firstSeenAt, lastSeenAt, priority
    ) VALUES ('eip155:56:12', '12', 56, 'Compatibility agent', '[]', 'ok', 'current', ?, ?, 1)`)
      .bind(now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey, nextProbeAt,
      consecutiveFailures, declaredProtocol, role, validationProtocol, eligibility
    ) VALUES (?, 'a2a', 'https://compat.example/a2a', 'compat', 'safe', 'eip155:56:12', 0,
      0, 'a2a', 'operational', 'a2a', 'eligible')`).bind("f".repeat(64)).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority
    ) VALUES ('eip155:56:12', ?, 'current', ?, ?, 1)`).bind("f".repeat(64), now, now).run();
    const compatibilityEnv = { ...env, CATALOG_V2_READS_ENABLED: "0" } as unknown as Env;
    const app = createWorker({ now: () => now });

    const list = await app.fetch(new Request("https://worker.test/catalog-agents"), compatibilityEnv);
    expect(await list.json()).toMatchObject({ schemaVersion: 1, total: 1, items: [{ agentId: "12" }] });
    const detail = await app.fetch(new Request("https://worker.test/catalog-agent/12"), compatibilityEnv);
    expect(await detail.json()).toMatchObject({ schemaVersion: 1, agentId: "12" });
  });

  it("exposes sanitized authenticated catalog operations metrics", async () => {
    const now = 1_788_000_000_000;
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, categoriesJson, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:13', '13', 56, '[]', 'ok', 'current', ?, ?)`)
      .bind(now - 10_000, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey, nextProbeAt,
      consecutiveFailures, declaredProtocol, role, validationProtocol, eligibility
    ) VALUES (?, 'mcp', 'https://secret-target.example/mcp', 'secret-origin', 'safe',
      'eip155:56:13', ?, 2, 'mcp', 'operational', 'mcp', 'eligible')`)
      .bind("1".repeat(64), now - 5_000).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority
    ) VALUES ('eip155:56:13', ?, 'current', ?, ?, 1)`)
      .bind("1".repeat(64), now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_ingest_tasks (
      agentKey, metadataVersion, nextDeclarationIndex, declarationCount, status, requestedBy,
      priority, generationStartedAt, updatedAt, attemptCount, retryAt, upstreamObservedAt
    ) VALUES ('eip155:56:13', 'meta-13', 0, 1, 'pending', 'header', 1, ?, ?, 0, 0, ?)`)
      .bind(now - 2_000, now, now - 12_000).run();
    const app = createWorker({ now: () => now });
    const operationalEnv = { ...env, SHARED_SECRET: "operations-secret" } as unknown as Env;

    const unauthorized = await app.fetch(
      new Request("https://worker.test/__admin/catalog-operations"), operationalEnv,
    );
    expect(unauthorized.status).toBe(401);
    const response = await app.fetch(new Request("https://worker.test/__admin/catalog-operations", {
      headers: { authorization: "Bearer operations-secret" },
    }), operationalEnv);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      schemaVersion: 2,
      work: { dueEndpoints: 1, failedEndpoints: 1, ingestTasks: { pending: 1 } },
      discovery: { maximumVisibilityLagMs: 10_000 },
      budgetProfile: {
        d1QueriesPerInvocation: 40,
        ingest: { discoveryPageSize: 12, tasksPerRun: 2, declarationsPerTask: 4 },
        protocolTimeoutMs: { a2a: 5_000, mcp: 5_000, erc8183Http: 5_000 },
        refreshMinutes: { priority: 15, a2a: 720, mcp: 1_440, erc8183Http: 360 },
        failureBackoffMinutes: [60, 360, 1_440, 10_080],
        v2: { readsEnabled: true, writesEnabled: false },
      },
    });
    expect(JSON.stringify(body)).not.toContain("secret-target.example");
    expect(JSON.stringify(body)).not.toContain("operations-secret");
  });

  it("tracks a newly registered identity only after onchain transaction verification", async () => {
    const now = 1_788_000_000_000;
    const txHash = `0x${"a".repeat(64)}` as const;
    const privateEnv = { ...env, BUYER_OBSERVATION_SECRET: "catalog-secret", BSC_RPC_URL: "https://rpc.example" } as unknown as Env;
    const verifyCatalogRegistration = vi.fn(async () => ({ blockNumber: 123456n }));
    const app = createWorker({ now: () => now, verifyCatalogRegistration });
    const response = await app.fetch(new Request("https://worker.test/catalog-directed-tracking", {
      method: "POST",
      headers: { authorization: "Bearer catalog-secret", "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 2, chainId: 56, agentId: "777", txHash }),
    }), privateEnv, createExecutionContext());

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      schemaVersion: 2,
      status: "registered",
      tracking: { chainId: 56, agentId: "777", txHash, blockNumber: "123456" },
    });
    expect(verifyCatalogRegistration).toHaveBeenCalledOnce();
    const status = await app.fetch(new Request("https://worker.test/catalog-directed-tracking/777"), privateEnv, createExecutionContext());
    expect(await status.json()).toMatchObject({
      tracking: { status: "registered", agentId: "777", txHash },
      taskStatus: "pending",
      nextDeclarationIndex: 0,
      declarationCount: 0,
    });
    const evidence = await env.DB.prepare(`SELECT validationKind, verificationLevel, artifactHash
      FROM catalog_observations WHERE agentKey = 'eip155:56:777'`).first<Record<string, unknown>>();
    expect(evidence).toEqual({ validationKind: "chain", verificationLevel: "onchain", artifactHash: txHash });

    const replay = await app.fetch(new Request("https://worker.test/catalog-directed-tracking", {
      method: "POST",
      headers: { authorization: "Bearer catalog-secret", "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 2, chainId: 56, agentId: "777", txHash }),
    }), privateEnv, createExecutionContext());
    expect(replay.status).toBe(200);
    expect(verifyCatalogRegistration).toHaveBeenCalledOnce();
  });

  it("persists authenticated catalog evidence and exposes its provenance per agent", async () => {
    const now = 1_788_000_000_000;
    const privateEnv = { ...env, BUYER_OBSERVATION_SECRET: "catalog-secret" } as unknown as Env;
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:45422', '45422', 56, 'ok', 'current', ?, ?)`)
      .bind(now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, safety, nextProbeAt, declaredProtocol,
      role, validationProtocol, eligibility
    ) VALUES (?, 'mcp', 'https://seller.example/mcp', 'safe', 0, 'mcp',
      'operational', 'mcp', 'eligible')`).bind("a".repeat(64)).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:45422', ?, 'current', ?, ?)`)
      .bind("a".repeat(64), now, now).run();
    const response = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/catalog-browser-observations", {
        method: "POST",
        headers: { authorization: "Bearer catalog-secret", "content-type": "application/json" },
        body: JSON.stringify(catalogObservationBody()),
      }),
      privateEnv,
      createExecutionContext(),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "recorded", id: expect.any(Number) });

    const throttled = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/catalog-browser-observations", {
        method: "POST",
        headers: { authorization: "Bearer catalog-secret", "content-type": "application/json" },
        body: JSON.stringify(catalogObservationBody()),
      }),
      privateEnv,
      createExecutionContext(),
    );
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).toBe("10");

    const publicResponse = await createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/catalog-agent?agentId=45422"),
      privateEnv,
      createExecutionContext(),
    );
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=60");
    expect(await publicResponse.json()).toMatchObject({
      schemaVersion: 2,
      apiVersion: 2,
      chainId: 56,
      agentId: "45422",
      platformAttemptCount: 0,
      declarations: [{ endpointKey: "a".repeat(64), eligibility: "eligible" }],
      observations: [{
        source: "browser_reported",
        outcome: "protocol_valid",
        protocol: "mcp",
        details: { capabilityCount: 4, method: "POST", cors: true },
      }],
      state: {
        operationalStatus: "browser_observed",
        freshness: "never",
        canPrepareHire: false,
        buyerAction: "check_availability",
      },
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
    expect((await post(catalogObservationBody({ source: "marketplace_probe" }))).status).toBe(400);
    expect((await post(catalogObservationBody({ protocol: "web" }))).status).toBe(400);
    expect((await post(catalogObservationBody({ outcome: "quote_verified" }))).status).toBe(400);
    expect((await post(catalogObservationBody({ outcome: "erc8183_detected" }))).status).toBe(400);
    expect((await post(catalogObservationBody({ endpointKey: "raw-url" }))).status).toBe(400);
    expect((await post({ ...catalogObservationBody(), authorization: "secret" })).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_observations").first())
      .toMatchObject({ count: 0 });
  });

  it("deduplicates catalog validation requests and dispatches their Queue work", async () => {
    const now = 1_788_000_000_000;
    const endpointKey = "c".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:42', '42', 56, 'ok', 'current', ?, ?)`)
      .bind(now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, safety, nextProbeAt, declaredProtocol,
      role, validationProtocol, eligibility
    ) VALUES (?, 'mcp', 'https://seller.example/mcp', 'safe', 0, 'mcp',
      'operational', 'mcp', 'eligible')`).bind(endpointKey).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:42', ?, 'current', ?, ?)`)
      .bind(endpointKey, now, now).run();
    const send = vi.fn(async () => undefined);
    const privateEnv = {
      ...env,
      BUYER_OBSERVATION_SECRET: "catalog-secret",
      WP2_QUEUE: { send },
    } as unknown as Env;
    const request = () => new Request("https://worker.test/catalog-validations", {
      method: "POST",
      headers: { authorization: "Bearer catalog-secret", "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 2, agentId: "42", endpointKey, validationKind: "protocol" }),
    });
    const app = createWorker({ now: () => now });
    const first = await app.fetch(request(), privateEnv, createExecutionContext());
    const firstBody = await first.json() as { validationId: number };
    expect(first.status).toBe(202);
    expect(firstBody).toMatchObject({ status: "queued", reused: false, validationId: expect.any(Number) });
    expect(send).toHaveBeenCalledOnce();
    const duplicate = await app.fetch(request(), privateEnv, createExecutionContext());
    expect(await duplicate.json()).toMatchObject({ status: "queued", reused: true, validationId: firstBody.validationId });
    expect(send).toHaveBeenCalledOnce();

    await env.DB.prepare("UPDATE catalog_validation_requests SET status = 'failed' WHERE id = ?")
      .bind(firstBody.validationId).run();
    const rateLimited = await app.fetch(request(), privateEnv, createExecutionContext());
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("retry-after")).toBe("60");
    expect(await rateLimited.json()).toMatchObject({
      error: "rate_limited",
      validationId: firstBody.validationId,
      retryAfterMs: 60_000,
    });
    await env.DB.prepare("UPDATE catalog_validation_requests SET status = 'queued' WHERE id = ?")
      .bind(firstBody.validationId).run();

    const statusUrl = `https://worker.test/catalog-validations/${firstBody.validationId}`;
    expect((await app.fetch(new Request(statusUrl), privateEnv, createExecutionContext())).status).toBe(401);
    const status = await app.fetch(new Request(statusUrl, {
      headers: { authorization: "Bearer catalog-secret" },
    }), privateEnv, createExecutionContext());
    expect(await status.json()).toMatchObject({ schemaVersion: 2, validation: { status: "queued", attemptCount: 0 } });

    await env.DB.prepare(`INSERT INTO catalog_observations (
      attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt,
      expiresAt, durationMs, detailsJson, validationKind, verificationLevel
    ) VALUES ('fresh-agent-scoped', 'eip155:56:42', ?, 'mcp', 'worker_probe',
      'protocol_valid', ?, ?, 25, '{}', 'protocol', 'platform_observed')`)
      .bind(endpointKey, now, now + 60_000).run();
    await env.DB.prepare(`UPDATE catalog_endpoints
      SET lastSuccessfulAt = ?, lastAttemptOutcome = 'protocol_valid', nextProbeAt = ? WHERE endpointKey = ?`)
      .bind(now, now + 60_000, endpointKey).run();
    const fresh = await app.fetch(request(), privateEnv, createExecutionContext());
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({ status: "completed", reused: true, validationId: null });
    expect(send).toHaveBeenCalledOnce();

    await env.DB.prepare(`UPDATE catalog_validation_requests
      SET status = 'completed', createdAt = ? WHERE id = ?`).bind(now - 120_000, firstBody.validationId).run();
    await env.DB.prepare(`UPDATE catalog_endpoints
      SET lastAttemptOutcome = 'network_error', nextProbeAt = ? WHERE endpointKey = ?`)
      .bind(now + 60_000, endpointKey).run();
    await env.DB.prepare(`INSERT INTO catalog_observations (
      attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt,
      expiresAt, durationMs, detailsJson, validationKind, verificationLevel
    ) VALUES ('agent-scoped-failure', 'eip155:56:42', ?, 'mcp', 'worker_probe',
      'network_error', ?, NULL, 25, '{}', 'protocol', 'platform_observed')`)
      .bind(endpointKey, now + 1).run();
    const afterFailure = await app.fetch(request(), privateEnv, createExecutionContext());
    expect(afterFailure.status).toBe(202);
    expect(await afterFailure.json()).toMatchObject({ status: "queued", reused: false });
    expect(send).toHaveBeenCalledTimes(2);

    const runCatalogValidation = vi.fn(async () => "completed" as const);
    const ack = vi.fn();
    await createWorker({ now: () => now, runCatalogValidation }).queue({
      messages: [{
        ...queueMessage({ schemaVersion: 2, kind: "catalog_validation", validationId: firstBody.validationId, enqueuedAt: now }),
        ack,
      }],
    }, { ...privateEnv, KILL_SWITCH: "0" }, createExecutionContext());
    expect(runCatalogValidation).toHaveBeenCalledWith(firstBody.validationId, expect.anything(), expect.anything());
    expect(ack).toHaveBeenCalledOnce();
  });

  it("does not share an on-demand validation request between agents sharing an endpoint", async () => {
    const now = 1_788_000_000_000;
    const endpointKey = "a".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES
      ('eip155:56:42', '42', 56, 'ok', 'current', ?, ?),
      ('eip155:56:43', '43', 56, 'ok', 'current', ?, ?)`).bind(now, now, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, safety, nextProbeAt, declaredProtocol,
      role, validationProtocol, eligibility
    ) VALUES (?, 'mcp', 'https://shared.example/mcp', 'safe', 0, 'mcp',
      'operational', 'mcp', 'eligible')`).bind(endpointKey).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES
      ('eip155:56:42', ?, 'current', ?, ?),
      ('eip155:56:43', ?, 'current', ?, ?)`).bind(endpointKey, now, now, endpointKey, now, now).run();
    const send = vi.fn(async () => undefined);
    const privateEnv = {
      ...env, BUYER_OBSERVATION_SECRET: "catalog-secret", WP2_QUEUE: { send },
    } as unknown as Env;
    const post = (agentId: string) => createWorker({ now: () => now }).fetch(
      new Request("https://worker.test/catalog-validations", {
        method: "POST",
        headers: { authorization: "Bearer catalog-secret", "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 2, agentId, endpointKey, validationKind: "protocol" }),
      }),
      privateEnv,
      createExecutionContext(),
    );

    const first = await post("42");
    const second = await post("43");
    const firstBody = await first.json() as { validationId: number };
    const secondBody = await second.json() as { validationId: number };
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(firstBody.validationId).not.toBe(secondBody.validationId);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare("SELECT dedupeKey, agentKey FROM catalog_validation_requests ORDER BY id").all())
      .toMatchObject({ results: [
        { dedupeKey: `eip155:56:42:${endpointKey}:protocol`, agentKey: "eip155:56:42" },
        { dedupeKey: `eip155:56:43:${endpointKey}:protocol`, agentKey: "eip155:56:43" },
      ] });
  });

  it("does not leave an active validation request when Queue dispatch fails", async () => {
    const now = 1_788_000_000_000;
    const endpointKey = "9".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:99', '99', 56, 'ok', 'current', ?, ?)`)
      .bind(now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, safety, nextProbeAt, declaredProtocol,
      role, validationProtocol, eligibility
    ) VALUES (?, 'a2a', 'https://queue-failure.example/a2a', 'safe', 0, 'a2a',
      'operational', 'a2a', 'eligible')`).bind(endpointKey).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:99', ?, 'current', ?, ?)`).bind(endpointKey, now, now).run();
    const privateEnv = {
      ...env,
      BUYER_OBSERVATION_SECRET: "catalog-secret",
      WP2_QUEUE: { send: vi.fn(async () => { throw new Error("queue unavailable"); }) },
    } as unknown as Env;
    const response = await createWorker({ now: () => now }).fetch(new Request(
      "https://worker.test/catalog-validations",
      {
        method: "POST",
        headers: { authorization: "Bearer catalog-secret", "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 2, agentId: "99", endpointKey, validationKind: "protocol" }),
      },
    ), privateEnv, createExecutionContext());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "queue_unavailable", validationId: expect.any(Number) });
    expect(await env.DB.prepare(`SELECT status, errorCode FROM catalog_validation_requests`).first())
      .toMatchObject({ status: "failed", errorCode: "QUEUE_SEND_FAILED" });
  });

  it("enforces the configured daily Queue reserve across distinct validation targets", async () => {
    const now = 1_788_000_000_000;
    const endpointKey = "8".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:88', '88', 56, 'ok', 'current', ?, ?)`)
      .bind(now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (
      endpointKey, protocol, endpoint, safety, nextProbeAt, declaredProtocol,
      role, validationProtocol, eligibility
    ) VALUES (?, 'mcp', 'https://daily-limit.example/mcp', 'safe', 0, 'mcp',
      'operational', 'mcp', 'eligible')`).bind(endpointKey).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:88', ?, 'current', ?, ?)`).bind(endpointKey, now, now).run();
    await env.DB.prepare(`INSERT INTO catalog_validation_requests (
      dedupeKey, agentKey, endpointKey, validationKind, requestedBy, status, createdAt, completedAt
    ) VALUES ('prior:protocol', 'eip155:56:1', ?, 'protocol', 'browser_fallback', 'completed', ?, ?)`)
      .bind("7".repeat(64), now - 1_000, now - 500).run();
    const send = vi.fn(async () => undefined);
    const privateEnv = {
      ...env,
      BUYER_OBSERVATION_SECRET: "catalog-secret",
      CATALOG_VALIDATION_REQUESTS_PER_DAY: "1",
      WP2_QUEUE: { send },
    } as unknown as Env;
    const response = await createWorker({ now: () => now }).fetch(new Request(
      "https://worker.test/catalog-validations",
      {
        method: "POST",
        headers: { authorization: "Bearer catalog-secret", "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 2, agentId: "88", endpointKey, validationKind: "protocol" }),
      },
    ), privateEnv, createExecutionContext());

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "daily_budget_exhausted", retryAfterMs: expect.any(Number) });
    expect(send).not.toHaveBeenCalled();
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

  it("runs the v2 discovery worklist without the legacy allowlist", async () => {
    const catalogAgent = {
      chainId: 56,
      agentId: "987654",
      name: "New public agent",
      registeredAt: 10_000,
      metadataUpdatedAt: 9_000,
      metadataReasonCode: "ok",
      services: [
        { name: "MCP", endpoint: "https://new-agent.example.com/mcp" },
        { name: "website", endpoint: "https://new-agent.example.com" },
      ],
      endpoints: [],
    };
    const fetchCatalog = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/agents")) {
        return Response.json({
          items: [catalogAgent],
          total: 1,
          limit: Number(url.searchParams.get("limit")),
          offset: Number(url.searchParams.get("offset")),
        });
      }
      if (url.pathname.endsWith("/agents/56:987654")) return Response.json(catalogAgent);
      return new Response(null, { status: 404 });
    });
    let clock = 20_000;
    const runner = createWp2ScheduledRunner({
      now: () => clock++,
      randomUUID: () => `catalog-v2-${clock}`,
      fetch: fetchCatalog as typeof fetch,
    });
    const config = loadConfig({
      KILL_SWITCH: "0",
      PRODUCER_KILL_SWITCH: "0",
      CATALOG_V2_WRITES_ENABLED: "1",
      CATALOG_DISCOVERY_PAGE_SIZE: "1",
      CATALOG_INGEST_TASKS_PER_RUN: "1",
      CATALOG_DECLARATIONS_PER_TASK: "1",
      PROBE_GENERAL_EGRESS_APPROVED: "1",
      PROBE_AGENT_ALLOWLIST: "*",
      PROBE_ENDPOINT_ALLOWLIST: "*",
    });
    const context = createExecutionContext();

    await runner({ scheduledTime: 20_000, cron: "*/5 * * * *" }, env, context, config);
    expect(await env.DB.prepare("SELECT name FROM catalog_agents WHERE agentId = '987654'").first())
      .toEqual({ name: "New public agent" });
    expect(await env.DB.prepare("SELECT status, nextDeclarationIndex FROM catalog_ingest_tasks").first())
      .toEqual({ status: "pending", nextDeclarationIndex: 1 });
    expect(fetchCatalog.mock.calls.some(([url]) => String(url).includes("limit=1"))).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM catalog_endpoints").first())
      .toEqual({ total: 1 });

    await runner({ scheduledTime: 25_000, cron: "*/5 * * * *" }, env, context, config);
    expect(await env.DB.prepare("SELECT status, nextDeclarationIndex FROM catalog_ingest_tasks").first())
      .toEqual({ status: "retiring", nextDeclarationIndex: 2 });
    expect(await env.DB.prepare(`SELECT declaredProtocol, role, eligibility, representativeAgentKey
      FROM catalog_endpoints ORDER BY declaredProtocol`).all()).toMatchObject({
      results: [
        { declaredProtocol: "mcp", role: "operational", eligibility: "eligible", representativeAgentKey: "eip155:56:987654" },
        { declaredProtocol: "web", role: "external", eligibility: "unsupported", representativeAgentKey: null },
      ],
    });
    expect(await runtimeInteger("catalog_sweep_offset")).toBe(0);
    expect(await runtimeText("next_scheduler_phase")).toBe("probe");
    expect(fetchCatalog.mock.calls.some(([url]) => String(url).includes("sortOrder=asc"))).toBe(true);

    await runner({ scheduledTime: 30_000, cron: "*/5 * * * *" }, env, context, config);
    expect(await env.DB.prepare("SELECT status, nextDeclarationIndex FROM catalog_ingest_tasks").first())
      .toEqual({ status: "completed", nextDeclarationIndex: 2 });
    expect(await runtimeText("next_scheduler_phase")).toBe("header");
    expect(JSON.parse(await runtimeText("last_probe_summary") ?? "{}")).toMatchObject({
      mode: "catalog_v2",
      status: "ok",
    });
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
