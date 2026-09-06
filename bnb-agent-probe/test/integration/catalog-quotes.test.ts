import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../src/config";
import type { D1Database, Env } from "../../src/types";
import {
  catalogQuoteFallbackResponse,
  createCatalogQuoteRequestResponse,
  catalogNegotiationInputResponse,
  catalogQuoteHistoryResponse,
} from "../../src/routes/catalog-quotes";
import { clearCatalogFixtures } from "./catalog-fixtures";

const NOW = 1_800_000_000_000;
const ENDPOINT_KEY = "e".repeat(64);
afterEach(() => vi.unstubAllGlobals());

function brief() {
  return {
    schemaVersion: 1,
    objective: "Compare two strategies",
    deliverable: "A JSON recommendation",
    acceptanceCriteria: "Include assumptions and risks",
  };
}

function createRequest(agentId = "42") {
  return new Request(`https://worker.test/catalog-quotes/${agentId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(brief()),
  });
}

beforeEach(async () => {
  await clearCatalogFixtures();
  await env.DB.prepare(`INSERT INTO catalog_agents (
    agentKey, agentId, chainId, categoriesJson, metadataState, indexState, firstSeenAt, lastSeenAt
  ) VALUES ('eip155:56:42', '42', 56, '["grid_trading"]', 'ok', 'current', ?, ?)`).bind(NOW, NOW).run();
  await env.DB.prepare(`INSERT INTO catalog_endpoints (
    endpointKey, protocol, endpoint, safety, nextProbeAt, declaredProtocol,
    role, validationProtocol, eligibility
  ) VALUES (?, 'a2a', 'https://seller.example.com/a2a', 'safe', 0, 'a2a',
    'operational', 'a2a', 'eligible')`).bind(ENDPOINT_KEY).run();
  await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
    agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
  ) VALUES ('eip155:56:42', ?, 'current', ?, ?)`).bind(ENDPOINT_KEY, NOW, NOW).run();
});

describe("buyer quote request ledger", () => {
  it("creates a first SDK-profile request without admission, extension or historical quotes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ url: "https://seller.example.com/a2a", protocolVersion: "0.3.0", skills: [{ id: "negotiate", description: "Send task_description and terms; receive negotiation_hash and provider_sig." }] })));
    const discovered = await catalogNegotiationInputResponse(env.DB as unknown as D1Database, "42");
    expect(discovered.status).toBe(200);
    const { contractHash } = await discovered.json() as { contractHash: string };
    const response = await createCatalogQuoteRequestResponse(new Request("https://worker.test/catalog-quotes/42", { method: "POST", body: JSON.stringify({ schemaVersion: 2, endpointKey: ENDPOINT_KEY, contractHash, parameters: { task_description: "Explain BNB identity", terms: { deliverables: "Summary", quality_standards: "Cited" } } }) }), env.DB as unknown as D1Database, { nowMs: NOW });
    expect(response.status).toBe(201);
    const created = await response.json() as { request: Record<string, unknown> };
    expect(created.request).toMatchObject({ task_description: "Explain BNB identity", terms: { deliverables: "Summary", quality_standards: "Cited", evaluation_required: true, evaluator_type: "uma_oov3" } });
    const row = await env.DB.prepare("SELECT * FROM catalog_seller_capabilities WHERE agentKey='eip155:56:42'").first();
    expect(row).toMatchObject({ state: "discovered", negotiationProfile: "bnb-sdk-v1", schemaSource: "a2a-declaration", lastSuccessAt: null });
    const stored = await env.DB.prepare("SELECT * FROM catalog_quote_requests").all();
    expect(JSON.stringify(stored)).not.toContain("Explain BNB identity");
  });
  it("keeps imported observations out of recorded request totals and pages", async () => {
    await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, { nowMs: NOW });
    await env.DB.prepare(`INSERT INTO catalog_quote_requests (requestHash, agentKey, endpointKey, transport, kind, status, callerKey, createdAt, metadataJson) VALUES ('imported', 'eip155:56:42', ?, 'a2a', 'buyer_quote', 'succeeded', 'migration', ?, '{"evidenceMigrated":1}')`).bind(ENDPOINT_KEY, NOW).run();
    const response = await catalogQuoteHistoryResponse(new Request("https://worker.test/catalog-quotes/42?page=1"), env.DB as unknown as D1Database, "42", NOW);
    const body = await response.json() as { counts: Record<string, number>; requests: unknown[] };
    expect(body.counts).toMatchObject({ buyerRequests: 1, importedObservations: 1, buyerVerified: 0 });
    expect(body.requests).toHaveLength(1);
  });
  it("closes abandoned buyer attempts without inventing a seller failure or erasing history", async () => {
    await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, { nowMs: NOW });
    await catalogQuoteHistoryResponse(new Request("https://worker.test/catalog-quotes/42"), env.DB as unknown as D1Database, "42", NOW + 60_000);
    expect(await env.DB.prepare("SELECT status FROM catalog_quote_requests").first()).toMatchObject({ status: "running" });
    await catalogQuoteHistoryResponse(new Request("https://worker.test/catalog-quotes/42"), env.DB as unknown as D1Database, "42", NOW + 301_000);
    expect(await env.DB.prepare("SELECT status,errorCode FROM catalog_quote_requests").first()).toMatchObject({ status: "failed", errorCode: "QUOTE_ATTEMPT_INTERRUPTED" });
    expect(await env.DB.prepare("SELECT status,errorCode FROM catalog_quote_attempts").first()).toMatchObject({ status: "failed", errorCode: "QUOTE_ATTEMPT_INTERRUPTED" });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM catalog_quote_requests").first()).toMatchObject({ n: 1 });
  });
  it("pages five logical quotes at a time with totals across pages", async () => {
    for (let n = 0; n < 7; n++) await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, { nowMs: NOW + n * 61_000, caller: "pagination" });
    const read = async (page: number) => (await catalogQuoteHistoryResponse(new Request(`https://worker.test/catalog-quotes/42?page=${page}`), env.DB as unknown as D1Database, "42", NOW)).json() as Promise<{ requests: { id: number }[]; counts: { requests: number }; pagination: { hasMore: boolean } }>;
    const first = await read(1), second = await read(2);
    expect(first.requests).toHaveLength(5);
    expect(second.requests).toHaveLength(2);
    expect(first.counts.requests).toBe(7);
    expect(second.counts.requests).toBe(7);
    expect(second.pagination.hasMore).toBe(false);
    expect(new Set([...first.requests, ...second.requests].map(row => row.id)).size).toBe(7);
  });
  it("discovers parameters, binds the server contract, and persists only the hash", async () => {
    const contract = { taskDescriptionPrefix: "SERVICE_V1:", inputSchema: { type: "object", required: ["topic"], properties: { topic: { type: "string" } } }, terms: { deliverables: "Report", quality_standards: "Cited", evaluation_required: true, evaluator_type: "uma_oov3" } };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ url: "https://seller.example.com/a2a", skills: [{ id: "negotiate" }], capabilities: { extensions: [{ uri: "https://marketplace.trust8004.xyz/extensions/negotiation-input/v1", params: contract }] } })));
    const discovered = await catalogNegotiationInputResponse(env.DB as unknown as D1Database, "42");
    expect(discovered.status).toBe(200);
    const compatibility = await env.DB.prepare("SELECT compatibilityState, schemaHash, compatibilityExpiresAt FROM catalog_seller_capabilities WHERE agentKey='eip155:56:42'").first();
    expect(compatibility).toMatchObject({ compatibilityState: "compatible", schemaHash: expect.any(String), compatibilityExpiresAt: expect.any(Number) });
    const { contractHash } = await discovered.json() as { contractHash: string };
    const create = (hash: string, parameters: unknown) => createCatalogQuoteRequestResponse(new Request("https://worker.test/catalog-quotes/42", {
      method: "POST", body: JSON.stringify({ schemaVersion: 2, endpointKey: ENDPOINT_KEY, contractHash: hash, parameters }),
    }), env.DB as unknown as D1Database, { nowMs: NOW });
    expect((await create("f".repeat(64), { topic: "private-buyer-topic" })).status).toBe(409);
    expect((await create(contractHash, { extra: true })).status).toBe(409);
    const accepted = await create(contractHash, { topic: "private-buyer-topic" });
    expect(accepted.status).toBe(201);
    await expect(accepted.json()).resolves.toMatchObject({ request: { task_description: 'SERVICE_V1:{"topic":"private-buyer-topic"}' } });
    const rows = await env.DB.prepare("SELECT * FROM catalog_quote_requests").all();
    expect(rows.results).toHaveLength(1);
    expect(JSON.stringify(rows.results)).not.toContain("private-buyer-topic");
  });
  it("lets a discovered candidate request a quote without legacy admission and deduplicates it for 60 seconds", async () => {
    const first = await createCatalogQuoteRequestResponse(
      createRequest(),
      env.DB as unknown as D1Database,
      { nowMs: NOW, caller: "caller:test" },
    );
    expect(first.status).toBe(201);
    const created = await first.json() as { requestId: number; attemptId: string; request: unknown };
    expect(created).toMatchObject({ requestId: expect.any(Number), attemptId: expect.any(String) });

    const duplicate = await createCatalogQuoteRequestResponse(
      createRequest(),
      env.DB as unknown as D1Database,
      { nowMs: NOW + 59_999, caller: "caller:test" },
    );
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      reused: true,
      requestId: created.requestId,
      attemptId: created.attemptId,
    });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_quote_requests").first())
      .resolves.toMatchObject({ count: 1 });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_quote_attempts").first())
      .resolves.toMatchObject({ count: 1 });
  });

  it("uses the SDK request unchanged for CORS fallback and records browser plus Worker attempts", async () => {
    const createdResponse = await createCatalogQuoteRequestResponse(
      createRequest(),
      env.DB as unknown as D1Database,
      { nowMs: NOW, caller: "caller:test" },
    );
    const created = await createdResponse.json() as { requestId: number; attemptId: string; request: Record<string, unknown> };
    const workerEnv = env as unknown as Env;
    const fallback = await catalogQuoteFallbackResponse(new Request(
      `https://worker.test/catalog-quotes/42/attempt/${created.attemptId}/fallback`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-marketplace-browser-error": "BROWSER_NETWORK_ERROR" },
        body: JSON.stringify(created.request),
      },
    ), env.DB as unknown as D1Database, created.attemptId, {
      nowMs: NOW + 100,
      env: workerEnv,
      config: loadConfig({ KILL_SWITCH: "0", PRODUCER_KILL_SWITCH: "0" }),
      expectedAgentId: "42",
    });

    // The fixture seller is deliberately unreachable. Reaching the stable
    // seller error proves the fallback accepted the exact SDK request instead
    // of rejecting its canonical snake_case terms at the route boundary.
    expect(fallback.status).toBe(502);
    await expect(fallback.json()).resolves.toMatchObject({
      error: "quote_attempt_failed",
      requestId: created.requestId,
      browserAttemptId: created.attemptId,
    });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_quote_requests").first())
      .resolves.toMatchObject({ count: 1 });
    const attempts = await env.DB.prepare(`SELECT executor, status, outcome, errorCode
      FROM catalog_quote_attempts ORDER BY startedAt, executor`).all();
    expect(attempts.results).toEqual([
      { executor: "browser", status: "failed", outcome: "fallback", errorCode: "BROWSER_NETWORK_ERROR" },
      { executor: "worker", status: "failed", outcome: "error", errorCode: "SELLER_HTTP_4XX" },
    ]);
  });

  it("rate-limits a shared origin across different agents", async () => {
    await env.DB.prepare(`UPDATE catalog_endpoints SET originKey = 'shared-origin' WHERE endpointKey = ?`)
      .bind(ENDPOINT_KEY).run();
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, categoriesJson, metadataState, indexState, firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:43', '43', 56, '["grid_trading"]', 'ok', 'current', ?, ?)`).bind(NOW, NOW).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
      agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:43', ?, 'current', ?, ?)`).bind(ENDPOINT_KEY, NOW, NOW).run();

    expect((await createCatalogQuoteRequestResponse(
      createRequest("42"), env.DB as unknown as D1Database,
      { nowMs: NOW, caller: "caller:one", originDailyLimit: 1 },
    )).status).toBe(201);
    const limited = await createCatalogQuoteRequestResponse(
      createRequest("43"), env.DB as unknown as D1Database,
      { nowMs: NOW + 1, caller: "caller:two", originDailyLimit: 1 },
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("86400");
    await expect(limited.json()).resolves.toMatchObject({ code: "origin_quote_rate_limit", retryAfterSeconds: 86400 });
  });

  it("waits for every exhausted scope and releases the rolling window at its boundary", async () => {
    await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, { nowMs: NOW, caller: "old" });
    await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, { nowMs: NOW + 3600000, caller: "buyer" });
    const options = { nowMs: NOW + 7200000, caller: "buyer", dailyLimit: 2, callerDailyLimit: 1 };
    const blocked = await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, options);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("82800");
    const released = await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, { ...options, nowMs: NOW + 3600000 + 86400000 });
    expect(released.status).toBe(201);
  });

  it("separates operational quota and history while preserving the shared provider limit", async () => {
    await env.DB.prepare("UPDATE catalog_endpoints SET originKey='shared-origin'").run();
    await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, { nowMs: NOW, caller: "buyer", callerDailyLimit: 1 });
    const operation = await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, {
      nowMs: NOW + 1, caller: "buyer", kind: "capability_probe", callerDailyLimit: 1, originDailyLimit: 2,
    });
    expect(operation.status).toBe(201);
    const registered = await operation.json() as { attemptId: string; request: unknown };
    expect(await env.DB.prepare("SELECT executor FROM catalog_quote_attempts WHERE id=?").bind(registered.attemptId).first()).toMatchObject({ executor: "worker" });
    const forbidden = await catalogQuoteFallbackResponse(new Request("https://worker.test/catalog-quotes/42/attempt/" + registered.attemptId + "/fallback", { method: "POST", body: JSON.stringify(registered.request) }), env.DB as unknown as D1Database, registered.attemptId, { nowMs: NOW + 2, env: env as unknown as Env, config: loadConfig({ KILL_SWITCH: "0", PRODUCER_KILL_SWITCH: "0" }) });
    expect(forbidden.status).toBe(409);
    await expect(forbidden.json()).resolves.toMatchObject({ error: "invalid_request_kind" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 404 })));
    const executed = await catalogQuoteFallbackResponse(new Request("https://worker.test/__admin/catalog-quotes/42", { method: "POST", body: JSON.stringify(registered.request) }), env.DB as unknown as D1Database, registered.attemptId, { nowMs: NOW + 2, operational: true, env: env as unknown as Env, config: loadConfig({ KILL_SWITCH: "0", PRODUCER_KILL_SWITCH: "0" }) });
    expect(executed.status).toBe(502);
    expect(await env.DB.prepare("SELECT status, executor FROM catalog_quote_attempts WHERE id=?").bind(registered.attemptId).first()).toMatchObject({ status: "failed", executor: "worker" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM catalog_quote_attempts").first()).toMatchObject({ total: 2 });
    const limited = await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, { nowMs: NOW + 2, caller: "another", originDailyLimit: 2 });
    expect(limited.status).toBe(429);
    const history = await catalogQuoteHistoryResponse(new Request("https://worker.test/catalog-quotes/42"), env.DB as unknown as D1Database, "42", NOW + 3);
    await expect(history.json()).resolves.toMatchObject({ counts: { buyerRequests: 1, capabilityProbes: 1 } });
  });

  it("does not repeat a fresh capability probe or count it as a buyer request", async () => {
    await env.DB.prepare(`INSERT INTO catalog_seller_capabilities
      (agentKey, endpointKey, transport, state, capabilityExpiresAt, createdAt, updatedAt)
      VALUES ('eip155:56:42', ?, 'a2a', 'ready', ?, ?, ?)`).bind(ENDPOINT_KEY, NOW + 86400000, NOW, NOW).run();
    const result = await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, { nowMs: NOW + 1, kind: "capability_probe", caller: "operator" });
    await expect(result.json()).resolves.toMatchObject({ status: "skipped", reason: "capability_fresh" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM catalog_quote_requests").first()).toMatchObject({ total: 0 });
  });

  it("reserves a bounded operator budget without ignoring scheduler load on the provider", async () => {
    await env.DB.prepare("UPDATE catalog_endpoints SET originKey='shared-origin'").run();
    await env.DB.prepare(`INSERT INTO catalog_quote_requests
      (requestHash, agentKey, endpointKey, transport, kind, status, callerKey, createdAt)
      VALUES ('scheduled', 'eip155:56:42', ?, 'a2a', 'capability_probe', 'failed', 'scheduler', ?)`).bind(ENDPOINT_KEY, NOW).run();
    const options = { nowMs: NOW + 1, kind: "capability_probe" as const, caller: "operator", dailyLimit: 1, originDailyLimit: 2 };
    const created = await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, options);
    expect(created.status).toBe(201);
    const exhausted = await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, { ...options, nowMs: NOW + 2 });
    expect(exhausted.status).toBe(429);
    await expect(exhausted.json()).resolves.toMatchObject({ code: "daily_quote_rate_limit", retryAfterSeconds: 86400 });
    const providerLimited = await createCatalogQuoteRequestResponse(createRequest(), env.DB as unknown as D1Database, { ...options, dailyLimit: 10, nowMs: NOW + 3 });
    expect(providerLimited.status).toBe(429);
    await expect(providerLimited.json()).resolves.toMatchObject({ code: "origin_quote_rate_limit" });
  });
});
