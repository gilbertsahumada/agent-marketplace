import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config";
import type { D1Database, Env } from "../../src/types";
import {
  catalogQuoteFallbackResponse,
  createCatalogQuoteRequestResponse,
} from "../../src/routes/catalog-quotes";
import { clearCatalogFixtures } from "./catalog-fixtures";

const NOW = 1_800_000_000_000;
const ENDPOINT_KEY = "e".repeat(64);

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
    await expect(limited.json()).resolves.toMatchObject({ code: "origin_quote_rate_limit" });
  });
});
