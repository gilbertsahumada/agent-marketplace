import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { loadConfig } from "../../src/config";
import type { D1DatabaseLike } from "../../src/db/client";
import { createDatabase, readCatalogProjectionMismatches } from "../../src/db/orm";
import { runCatalogValidationRequest } from "../../src/phases/catalog-validation-request";
import { clearCatalogFixtures } from "./catalog-fixtures";

const NOW = 1_788_000_000_000;
const ENDPOINT_KEY = "d".repeat(64);

beforeEach(async () => {
  await clearCatalogFixtures();
  await env.DB.prepare(`INSERT INTO catalog_agents (
    agentKey, agentId, chainId, metadataState, indexState, firstSeenAt, lastSeenAt
  ) VALUES ('eip155:56:42', '42', 56, 'ok', 'current', ?, ?)`)
    .bind(NOW, NOW).run();
  await env.DB.prepare(`INSERT INTO catalog_endpoints (
    endpointKey, protocol, endpoint, safety, nextProbeAt, declaredProtocol,
    role, validationProtocol, eligibility
  ) VALUES (?, 'mcp', 'https://seller.example.com/mcp', 'safe', 0, 'mcp',
    'operational', 'mcp', 'eligible')`).bind(ENDPOINT_KEY).run();
  await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
    agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority
  ) VALUES ('eip155:56:42', ?, 'current', ?, ?, 40)`)
    .bind(ENDPOINT_KEY, NOW, NOW).run();
  await env.DB.prepare(`INSERT INTO catalog_validation_requests (
    dedupeKey, agentKey, endpointKey, validationKind, requestedBy, status, createdAt
  ) VALUES (?, 'eip155:56:42', ?, 'protocol', 'browser_fallback', 'queued', ?)`)
    .bind(`${ENDPOINT_KEY}:protocol`, ENDPOINT_KEY, NOW).run();
});

describe("catalog validation Queue work", () => {
  it("runs the exact declared endpoint and completes the request with platform evidence", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }, {
        headers: { "mcp-session-id": "session" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "quote" }] } }));
    const request = await env.DB.prepare("SELECT id FROM catalog_validation_requests").first<{ id: number }>();
    expect(await env.DB.prepare(`SELECT e.validationProtocol, e.endpoint, r.declarationState
      FROM catalog_agent_endpoints r JOIN catalog_endpoints e ON e.endpointKey = r.endpointKey
      WHERE r.agentKey = 'eip155:56:42' AND r.endpointKey = ?`).bind(ENDPOINT_KEY).first()).toMatchObject({
      validationProtocol: "mcp", endpoint: "https://seller.example.com/mcp", declarationState: "current",
    });

    expect(await runCatalogValidationRequest(
      env.DB as unknown as D1DatabaseLike,
      request!.id,
      loadConfig({ KILL_SWITCH: "0", PROBE_GENERAL_EGRESS_APPROVED: "1" }),
      () => NOW,
      fetchImpl,
    )).toBe("completed");

    expect(await env.DB.prepare(`SELECT status, attemptCount, errorCode, leaseOwner, resultObservationId
      FROM catalog_validation_requests WHERE id = ?`).bind(request!.id).first()).toMatchObject({
      status: "completed", attemptCount: 1, errorCode: null, leaseOwner: null,
      resultObservationId: expect.any(Number),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const persistedObservation = await env.DB.prepare(`SELECT id, source, outcome, verificationLevel, validationKind
      FROM catalog_observations WHERE endpointKey = ?`).bind(ENDPOINT_KEY).first<Record<string, unknown>>();
    expect(persistedObservation).toMatchObject({
      source: "buyer_refresh", outcome: "protocol_valid",
      verificationLevel: "platform_observed", validationKind: "protocol",
    });
    expect(await env.DB.prepare(`SELECT resultObservationId FROM catalog_validation_requests
      WHERE id = ?`).bind(request!.id).first()).toMatchObject({ resultObservationId: persistedObservation!.id });
    expect(await env.DB.prepare(`SELECT lastAttemptOutcome, lastSuccessfulAt, consecutiveFailures
      FROM catalog_endpoints WHERE endpointKey = ?`).bind(ENDPOINT_KEY).first()).toMatchObject({
      lastAttemptOutcome: "protocol_valid", lastSuccessfulAt: NOW, consecutiveFailures: 0,
    });
    expect(await readCatalogProjectionMismatches(
      createDatabase(env.DB as unknown as D1DatabaseLike),
    )).toEqual([]);
    expect(await runCatalogValidationRequest(
      env.DB as unknown as D1DatabaseLike,
      request!.id,
      loadConfig({ KILL_SWITCH: "0", PROBE_GENERAL_EGRESS_APPROVED: "1" }),
      () => NOW,
      fetchImpl,
    )).toBe("duplicate");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("reclaims an expired running lease and records one atomic result", async () => {
    const request = await env.DB.prepare("SELECT id FROM catalog_validation_requests").first<{ id: number }>();
    await env.DB.prepare(`UPDATE catalog_validation_requests
      SET status = 'running', attemptCount = 1, leaseOwner = 'dead-consumer', leaseExpiresAt = ?
      WHERE id = ?`).bind(NOW - 1, request!.id).run();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }, {
        headers: { "mcp-session-id": "session" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 2, result: { tools: [] } }));

    await expect(runCatalogValidationRequest(
      env.DB as unknown as D1DatabaseLike,
      request!.id,
      loadConfig({ KILL_SWITCH: "0", PROBE_GENERAL_EGRESS_APPROVED: "1" }),
      () => NOW,
      fetchImpl,
    )).resolves.toBe("completed");

    expect(await env.DB.prepare(`SELECT status, attemptCount, resultObservationId, leaseOwner, leaseExpiresAt
      FROM catalog_validation_requests WHERE id = ?`).bind(request!.id).first()).toMatchObject({
      status: "completed",
      attemptCount: 2,
      resultObservationId: expect.any(Number),
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_observations").first())
      .toMatchObject({ count: 1 });
  });
});
