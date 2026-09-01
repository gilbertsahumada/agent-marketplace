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
    expect(result.sql).toContain("metadataUri");
    expect(result.sql).not.toContain("BEGIN TRANSACTION");
    expect(result.sql).not.toMatch(/[\t ]+\n/);
  });

  it("materializes normalized endpoint eligibility and an immediately due probe schedule", () => {
    const result = buildCatalogD1Seed(snapshot());

    expect(result.sql).toContain(`endpointKey, protocol, endpoint, originKey, safety, safetyReason,
  declaredProtocol, role, validationProtocol, externalKind, eligibility, representativeAgentKey, nextProbeAt`);
    expect(result.sql).toContain("'mcp','operational','mcp',NULL,'eligible'");
    expect(result.sql).toContain("nextProbeAt=excluded.nextProbeAt");
    expect(result.sql).not.toContain("'unknown','external',NULL,NULL,'unsupported'");
  });

  it("seeds ERC-8183 commerce as a quote-verification candidate", () => {
    const commerceAgent = normalizeCatalogAgent({
      chainId: 56,
      agentId: "303779",
      name: "Grid seller",
      metadataReasonCode: "ok",
      services: [{ name: "ERC-8183", endpoint: "https://seller.example/grid" }],
    });
    const commerceSnapshot: CatalogSnapshotV2 = {
      ...snapshot(),
      candidates: [commerceAgent],
      registeredAgentIds: ["303779"],
      stats: {
        registered: 1, candidates: 1, declarations: 1, safeDeclarations: 1,
        unsafeDeclarations: 0, sharedOrigins: 0,
      },
    };
    const result = buildCatalogD1Seed(commerceSnapshot, {
      marketplaceAgentIds: ["303779"],
    });

    expect(result.sql).toContain("INSERT INTO catalog_agent_admission");
    expect(result.sql).toContain("'eip155:56:303779','candidate','erc8183_http'");
    expect(result.sql).toContain("'QUOTE_VERIFICATION_REQUIRED'");
  });

  it("accepts legacy snapshots that omit optional identity fields", () => {
    const legacy = snapshot() as unknown as {
      candidates: Array<Record<string, unknown>>;
    };
    delete legacy.candidates[0]!.owner;
    delete legacy.candidates[0]!.metadataUri;

    expect(() => buildCatalogD1Seed(legacy as unknown as CatalogSnapshotV2)).not.toThrow();
  });

  it("keeps social URLs declared as MCP but excludes them from probe eligibility", () => {
    const socialAgent = normalizeCatalogAgent({
      chainId: 56,
      agentId: "77",
      name: "Social profile",
      metadataReasonCode: "ok",
      services: [{ name: "MCP", endpoint: "https://x.com/agent" }],
    });
    const socialSnapshot: CatalogSnapshotV2 = {
      ...snapshot(),
      candidates: [socialAgent],
      registeredAgentIds: ["77"],
      stats: {
        registered: 1, candidates: 1, declarations: 1, safeDeclarations: 1,
        unsafeDeclarations: 0, sharedOrigins: 0,
      },
    };
    const result = buildCatalogD1Seed(socialSnapshot);

    expect(result.sql).toContain("'mcp','operational','mcp','social','invalid_declaration',NULL,NULL");
    expect(result.stats.probeRepresentatives).toBe(0);
  });

  it("preserves non-transport declarations as external resources", () => {
    const externalAgent = normalizeCatalogAgent({
      chainId: 56,
      agentId: "88",
      name: "External payment agent",
      metadataReasonCode: "ok",
      services: [
        { name: "x402", endpoint: "https://seller.example/pay" },
        { name: "Custom settlement", endpoint: "https://seller.example/settle" },
      ],
    });
    const externalSnapshot: CatalogSnapshotV2 = {
      ...snapshot(),
      candidates: [externalAgent],
      registeredAgentIds: ["88"],
      stats: {
        registered: 1, candidates: 1, declarations: 2, safeDeclarations: 2,
        unsafeDeclarations: 0, sharedOrigins: 0,
      },
    };
    const result = buildCatalogD1Seed(externalSnapshot);

    expect(result.sql).toContain("'x402','external',NULL,'other','unsupported'");
    expect(result.sql).toContain("'unknown','external',NULL,'other','unsupported'");
    expect(result.stats.probeRepresentatives).toBe(0);
  });

  it("reconciles previous rows without deleting append-only observations", () => {
    const result = buildCatalogD1Seed(snapshot());
    expect(result.sql).toContain("UPDATE catalog_agents SET indexState = 'removed'");
    expect(result.sql).toContain("UPDATE catalog_agent_endpoints SET declarationState = 'removed'");
    expect(result.sql).not.toMatch(/DELETE\s+FROM/i);
    expect(result.sql).not.toMatch(/UPDATE\s+catalog_observations/i);
  });

  it("suspends stale admissions while preserving the append-only evidence ledger", () => {
    const result = buildCatalogD1Seed(snapshot());

    expect(result.sql).toContain("UPDATE catalog_agent_admission");
    expect(result.sql).toContain("reasonCode = 'AGENT_REMOVED_FROM_SNAPSHOT'");
    expect(result.sql).toContain("reasonCode = 'NO_COMMERCE_ENDPOINT'");
    expect(result.sql).toContain("state = 'suspended'");
    expect(result.sql).not.toMatch(/DELETE\s+FROM\s+catalog_agent_admission/i);
    expect(result.sql).not.toMatch(/UPDATE\s+catalog_observations/i);
  });
});
