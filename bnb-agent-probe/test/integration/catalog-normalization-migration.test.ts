import { env } from "cloudflare:workers";
import { clearCatalogFixtures } from "./catalog-fixtures";

beforeEach(async () => {
  await clearCatalogFixtures();
});

describe("catalog normalization migration", () => {
  it("keeps declared identity provenance columns available after additive migration", async () => {
    await env.DB.prepare(`INSERT INTO catalog_agents (
      agentKey, agentId, chainId, owner, metadataUri, name, metadataState,
      firstSeenAt, lastSeenAt
    ) VALUES ('eip155:56:700', '700', 56,
      '0x1111111111111111111111111111111111111111', 'ipfs://metadata/700', 'Agent 700', 'ok', 1, 1)`).run();

    await expect(env.DB.prepare("SELECT owner, metadataUri FROM catalog_agents WHERE agentId = '700'").first())
      .resolves.toEqual({ owner: "0x1111111111111111111111111111111111111111", metadataUri: "ipfs://metadata/700" });
  });

  it("enforces append-only observations in D1", async () => {
    await env.DB.prepare(`INSERT INTO catalog_observations (
      agentKey, protocol, source, outcome, observedAt, durationMs, detailsJson,
      attemptId, validationKind, verificationLevel
    ) VALUES ('eip155:56:1', 'mcp', 'worker_probe', 'protocol_valid', 1, 2, '{}',
      'attempt:1', 'protocol', 'platform_observed')`).run();

    await expect(env.DB.prepare("UPDATE catalog_observations SET durationMs = 3 WHERE attemptId = 'attempt:1'").run())
      .rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM catalog_observations WHERE attemptId = 'attempt:1'").run())
      .rejects.toThrow(/append-only/);
  });

  it("enforces evidence provenance and verification levels in D1", async () => {
    const insert = (source: string, outcome: string, kind: string, level: string) => env.DB.prepare(`
      INSERT INTO catalog_observations (
        agentKey, protocol, source, outcome, observedAt, durationMs, detailsJson,
        validationKind, verificationLevel
      ) VALUES ('eip155:56:1', 'mcp', ?, ?, 1, 0, '{}', ?, ?)
    `).bind(source, outcome, kind, level).run();

    await expect(insert("browser_reported", "protocol_valid", "protocol", "platform_observed"))
      .rejects.toThrow();
    await expect(insert("chain_read", "erc8183_detected", "chain", "platform_observed"))
      .rejects.toThrow();
    await expect(insert("browser_reported", "quote_verified", "quote", "user_observed"))
      .rejects.toThrow();
    await expect(insert("browser_reported", "protocol_valid", "protocol", "user_observed"))
      .resolves.toBeDefined();
  });

  it("deduplicates active validation requests but permits a later completed request", async () => {
    const insert = (status: string) => env.DB.prepare(`INSERT INTO catalog_validation_requests (
      dedupeKey, agentKey, endpointKey, validationKind, requestedBy, status, createdAt
    ) VALUES ('endpoint:protocol', 'eip155:56:1', 'endpoint', 'protocol', 'system', ?, 1)`).bind(status).run();

    await insert("queued");
    await expect(insert("running")).rejects.toThrow();
    await env.DB.prepare("UPDATE catalog_validation_requests SET status = 'completed', completedAt = 2 WHERE dedupeKey = 'endpoint:protocol'").run();
    await expect(insert("queued")).resolves.toBeDefined();
  });
});
