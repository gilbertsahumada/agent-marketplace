import { describe, expect, it } from "vitest";
import { buildCatalogD1Seed } from "../src/trust8004/catalog-d1-seed.ts";
import { normalizeCatalogAgent } from "../src/trust8004/catalog-normalization.ts";
import type { CatalogSnapshotV2 } from "../src/trust8004/catalog-snapshot.ts";

function snapshot(): CatalogSnapshotV2 {
  const candidates = [
    normalizeCatalogAgent({ chainId: 56, agentId: "2", name: "Two", description: "line one  \nline two ", metadataReasonCode: "ok",
      services: [{ name: "MCP", endpoint: "https://shared.example/mcp" }] }),
    normalizeCatalogAgent({ chainId: 56, agentId: "1", name: "One", metadataReasonCode: "ok",
      services: [
        { name: "MCP", endpoint: "https://shared.example/mcp" },
        { name: "A2A", endpoint: "https://shared.example/a2a" },
      ] }),
  ];
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-30T00:00:00.000Z",
    chainId: 56,
    source: { provider: "trust8004", listPath: "/api/app/agents", ordering: "registered:asc" },
    registeredAgentIds: ["1", "2"],
    candidates,
    stats: { registered: 2, candidates: 2, declarations: 3, safeDeclarations: 3,
      unsafeDeclarations: 0, sharedOrigins: 1 },
    scan: { pageSize: 2, pages: 1, nextOffset: 2, complete: true },
    sourceSha256: "a".repeat(64),
  };
}

describe("catalog D1 seed", () => {
  it("keeps shared endpoints once and every agent declaration separately", () => {
    const result = buildCatalogD1Seed(snapshot(), { priorityAgentIds: ["2"], chunkSize: 10 });

    expect(result.stats).toEqual({ agents: 2, endpoints: 2, declarations: 3, probeRepresentatives: 2 });
    expect(result.sql.match(/https:\/\/shared\.example\/mcp/g)).toHaveLength(1);
    expect(result.sql).toContain("catalog_agent_endpoints");
    expect(result.sql).toContain("'eip155:56:1'");
    expect(result.sql).toContain("'eip155:56:2'");
    expect(result.sql).toContain("representativeAgentKey");
    expect(result.sql).not.toContain("BEGIN TRANSACTION");
    expect(result.sql).not.toMatch(/[\t ]+\n/);
  });

  it("reconciles previous rows without deleting append-only observations", () => {
    const result = buildCatalogD1Seed(snapshot());
    expect(result.sql).toContain("UPDATE catalog_agents SET indexState = 'removed'");
    expect(result.sql).toContain("UPDATE catalog_agent_endpoints SET declarationState = 'removed'");
    expect(result.sql).not.toMatch(/DELETE\s+FROM/i);
    expect(result.sql).not.toMatch(/UPDATE\s+catalog_observations/i);
  });
});
