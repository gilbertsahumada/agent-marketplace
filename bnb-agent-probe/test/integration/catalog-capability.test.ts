import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../src/config";
import { recordCompatibility } from "../../src/catalog/compatibility";
import { createDatabase } from "../../src/db/orm";
import {
  enqueueDueCatalogCapabilities,
  runCatalogCapabilityProbe,
  type CatalogCapabilityWork,
} from "../../src/phases/catalog-capability";
import type { D1DatabaseLike } from "../../src/db/client";
import type { Env } from "../../src/types";
import { clearCatalogFixtures } from "./catalog-fixtures";

const NOW = 1_800_000_000_000;
const ENDPOINT_KEY = "e".repeat(64);

async function insertCandidate(
  agentId: string,
  endpointKey = ENDPOINT_KEY,
  originKey = "seller-origin",
  state: "discovered" | "ready" | "stale" | "failed" = "discovered",
  capabilityExpiresAt: number | null = null,
) {
  const agentKey = `eip155:56:${agentId}`;
  await env.DB.prepare(`INSERT INTO catalog_agents (
    agentKey, agentId, chainId, categoriesJson, metadataState, indexState, firstSeenAt, lastSeenAt
  ) VALUES (?, ?, 56, '["grid_trading"]', 'ok', 'current', ?, ?)`)
    .bind(agentKey, agentId, NOW, NOW).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO catalog_endpoints (
    endpointKey, protocol, endpoint, originKey, safety, nextProbeAt, declaredProtocol,
    role, validationProtocol, eligibility
  ) VALUES (?, 'a2a', ?, ?, 'safe', 0, 'a2a', 'operational', 'a2a', 'eligible')`)
    .bind(endpointKey, `https://${agentId}.seller.example/a2a`, originKey).run();
  await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
    agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
  ) VALUES (?, ?, 'current', ?, ?)`).bind(agentKey, endpointKey, NOW, NOW).run();
  await env.DB.prepare(`INSERT INTO catalog_seller_capabilities (
    agentKey, endpointKey, transport, state, capabilityExpiresAt, nextProbeAt,
    consecutiveFailures, createdAt, updatedAt
  ) VALUES (?, ?, 'a2a', ?, ?, ?, 0, ?, ?)`)
    .bind(agentKey, endpointKey, state, capabilityExpiresAt, state === "ready" ? capabilityExpiresAt : 0, NOW, NOW).run();
  return { agentKey, endpointKey };
}

function work(agentKey: string, endpointKey = ENDPOINT_KEY, enqueuedAt = NOW): CatalogCapabilityWork {
  return { schemaVersion: 2, kind: "catalog_capability_probe", agentKey, endpointKey, enqueuedAt };
}

beforeEach(clearCatalogFixtures);

describe("catalog quote-capability scheduler", () => {
  it("refreshes expired requirements even when quote capability is still ready", async () => {
    await insertCandidate("42", ENDPOINT_KEY, "seller-origin", "ready", NOW + 86_400_000);
    await env.DB.prepare("UPDATE catalog_seller_capabilities SET compatibilityState='compatible', compatibilityExpiresAt=?, nextProbeAt=0").bind(NOW - 1).run();
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await enqueueDueCatalogCapabilities(env.DB as unknown as D1DatabaseLike, { send }, { nowMs: NOW, limit: 2 })).toMatchObject({ enqueued: 1 });
  });
  it.each([['stale', NOW + 1000, 'ready'], ['stale', NOW - 1, 'stale'], ['failed', NOW + 1000, 'failed'], ['suspended', NOW + 1000, 'suspended']])("discovery preserves quote truth for %s", async (state, expiry, expected) => {
    const candidate = await insertCandidate("42");
    await env.DB.prepare("UPDATE catalog_seller_capabilities SET state=?, capabilityExpiresAt=?, lastSuccessAt=? WHERE agentKey=?").bind(state, expiry, NOW - 1000, candidate.agentKey).run();
    await recordCompatibility(createDatabase(env.DB as unknown as D1DatabaseLike), { ...candidate, transport: 'a2a' }, NOW, { schemaHash: 'schema' });
    expect(await env.DB.prepare("SELECT state FROM catalog_seller_capabilities WHERE agentKey=?").bind(candidate.agentKey).first()).toMatchObject({ state: expected });
  });

  it("uses a separate bootstrap budget and looks past repeated origins", async () => {
    await insertCandidate("42");
    await insertCandidate("43", "f".repeat(64), "seller-origin");
    await insertCandidate("44", "a".repeat(64), "second-origin");
    const send = vi.fn().mockResolvedValue(undefined);
    const summary = await enqueueDueCatalogCapabilities(env.DB as unknown as D1DatabaseLike, { send }, { nowMs: NOW, limit: 1, concurrency: 1, bootstrapLimit: 2 });
    expect(summary.enqueued).toBe(2);
  });
  it("does not let a window of retries starve first-time discovery", async () => {
    for (let n = 100; n < 125; n++) {
      const key = n.toString().padStart(64, "0");
      await insertCandidate(String(n), key, `origin-${n}`, "failed");
      await env.DB.prepare("UPDATE catalog_seller_capabilities SET compatibilityState='unavailable' WHERE endpointKey=?").bind(key).run();
      await env.DB.prepare("UPDATE catalog_endpoints SET lastAttemptOutcome='protocol_valid' WHERE endpointKey=?").bind(key).run();
    }
    await insertCandidate("999", "9".repeat(64), "new-origin");
    const send = vi.fn().mockResolvedValue(undefined);
    await enqueueDueCatalogCapabilities(env.DB as unknown as D1DatabaseLike, { send }, { nowMs: NOW, limit: 1, concurrency: 1, bootstrapLimit: 1 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ agentKey: "eip155:56:999" }));
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("discovers a usable form without inventing a probe brief when no safe sample is published", async () => {
    const candidate = await insertCandidate("42");
    await env.DB.prepare("UPDATE catalog_endpoints SET endpoint='https://seller.example.com/a2a' WHERE endpointKey=?").bind(ENDPOINT_KEY).run();
    const contract = { encoding: "prefixed-json", taskDescriptionPrefix: "SERVICE_V1:", inputSchema: { type: "object", required: ["topic"], properties: { topic: { type: "string" } } }, terms: { deliverables: "Report", quality_standards: "Cited", evaluation_required: true, evaluator_type: "uma_oov3" } };
    const fetchImpl = vi.fn(async () => Response.json({ url: "https://seller.example.com/a2a", skills: [{ id: "negotiate" }], capabilities: { extensions: [{ uri: "https://marketplace.trust8004.xyz/extensions/negotiation-input/v1", params: contract }] } })) as typeof fetch;
    const result = await runCatalogCapabilityProbe(work(candidate.agentKey), env as unknown as Env, loadConfig({ CLOUDFLARE_WORKERS_PLAN: "paid" }), { now: () => NOW, fetchImpl });
    expect(result).toMatchObject({ status: "skipped", errorCode: "BUYER_INPUT_REQUIRED", requestId: null });
    expect(fetchImpl).toHaveBeenCalledOnce();
    await expect(env.DB.prepare("SELECT compatibilityState, consecutiveFailures FROM catalog_seller_capabilities WHERE agentKey=?").bind(candidate.agentKey).first()).resolves.toMatchObject({ compatibilityState: "compatible", consecutiveFailures: 0 });
    await expect(env.DB.prepare("SELECT COUNT(*) AS total FROM catalog_quote_requests").first()).resolves.toMatchObject({ total: 0 });
  });
  it("claims due work once and limits one queued probe per origin", async () => {
    await insertCandidate("42");
    await insertCandidate("43", "f".repeat(64), "seller-origin");
    const send = vi.fn().mockResolvedValue(undefined);

    const first = await enqueueDueCatalogCapabilities(env.DB as unknown as D1DatabaseLike, { send }, {
      nowMs: NOW,
      limit: 4,
      concurrency: 4,
    });
    expect(first).toMatchObject({ enqueued: 1, pending: 2 });
    expect(send).toHaveBeenCalledOnce();

    const second = await enqueueDueCatalogCapabilities(env.DB as unknown as D1DatabaseLike, { send }, {
      nowMs: NOW + 1,
      limit: 4,
      concurrency: 4,
    });
    expect(second.enqueued).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    const claims = await env.DB.prepare(`SELECT agentKey, nextProbeAt
      FROM catalog_seller_capabilities ORDER BY agentKey`).all();
    expect(claims.results).toEqual([
      { agentKey: "eip155:56:42", nextProbeAt: NOW + 5 * 60_000 },
      { agentKey: "eip155:56:43", nextProbeAt: NOW + 1 + 5 * 60_000 },
    ]);
  });

  it("turns an expired ready capability stale and queues it", async () => {
    await insertCandidate("42", ENDPOINT_KEY, "seller-origin", "ready", NOW);
    const send = vi.fn().mockResolvedValue(undefined);
    const summary = await enqueueDueCatalogCapabilities(env.DB as unknown as D1DatabaseLike, { send }, {
      nowMs: NOW,
      limit: 1,
    });
    expect(summary).toMatchObject({ enqueued: 1, ready: 0, stale: 1 });
    await expect(env.DB.prepare(`SELECT state FROM catalog_seller_capabilities
      WHERE agentKey = 'eip155:56:42'`).first()).resolves.toMatchObject({ state: "stale" });
  });

  it("backs off failed discovery without inventing quote requests or attempts", async () => {
    const candidate = await insertCandidate("42");
    const config = loadConfig({
      CLOUDFLARE_WORKERS_PLAN: "paid",
      KILL_SWITCH: "0",
      PRODUCER_KILL_SWITCH: "0",
      CATALOG_FAILURE_BACKOFF_MINUTES: "60,360,1440,10080",
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const expectedMinutes = [60, 360, 1_440, 10_080, 10_080];

    for (const [index, minutes] of expectedMinutes.entries()) {
      const at = NOW + index * 1_000;
      const result = await runCatalogCapabilityProbe(work(candidate.agentKey, candidate.endpointKey, at), env as unknown as Env, config, {
        now: () => at,
        fetchImpl,
      });
      expect(result).toMatchObject({ status: "skipped", errorCode: "SELLER_UNSAFE_URL", requestId: null });
      await expect(env.DB.prepare(`SELECT state, consecutiveFailures, nextProbeAt
        FROM catalog_seller_capabilities WHERE agentKey = ?`).bind(candidate.agentKey).first())
        .resolves.toMatchObject({
          state: "failed",
          consecutiveFailures: index + 1,
          nextProbeAt: at + minutes * 60_000,
        });
    }

    await expect(env.DB.prepare("SELECT COUNT(*) AS total FROM catalog_quote_requests").first())
      .resolves.toMatchObject({ total: 0 });
    await expect(env.DB.prepare("SELECT COUNT(*) AS total FROM catalog_quote_attempts").first())
      .resolves.toMatchObject({ total: 0 });
  });
});
