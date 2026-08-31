import { env } from "cloudflare:workers";
import type { D1DatabaseLike } from "../../src/db/client";
import { syncCatalogHeaderCandidates } from "../../src/phases/catalog-header-index";
import type { CatalogAgent } from "../../src/trust8004/types";
import { clearCatalogFixtures } from "./catalog-fixtures";

const NOW = 1_788_000_000_000;

beforeEach(async () => {
  await clearCatalogFixtures();
});

function agent(agentId: string): CatalogAgent {
  return {
    chainId: 56, agentId, owner: null, metadataUri: null, blockNumber: null, name: `Agent ${agentId}`, description: null, imageUrl: null,
    registeredAt: NOW, metadataUpdatedAt: NOW, metadataAvailable: true,
    declarations: { a2a: false, erc8183: false }, declaredEndpoints: [],
    indexEndpoints: [{ protocol: "mcp", endpoint: "https://shared.example.com/mcp" }],
  };
}

describe("incremental catalog HEADER index", () => {
  it("keeps shared endpoints normalized and chooses the marketplace candidate as representative", async () => {
    const summary = await syncCatalogHeaderCandidates(
      env.DB as unknown as D1DatabaseLike,
      [agent("1"), agent("303779")],
      NOW,
    );

    expect(summary).toMatchObject({ candidatesIndexed: 2, endpointsIndexed: 1, endpointDeclarationsIndexed: 2 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_agents").first()).toMatchObject({ count: 2 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_agent_endpoints").first()).toMatchObject({ count: 2 });
    expect(await env.DB.prepare("SELECT representativeAgentKey FROM catalog_endpoints").first())
      .toMatchObject({ representativeAgentKey: "eip155:56:303779" });
    expect(await env.DB.prepare("SELECT marketplaceConfigured, categoriesJson FROM catalog_agents WHERE agentId='303779'").first())
      .toMatchObject({ marketplaceConfigured: 1, categoriesJson: '["grid_trading"]' });
  });

  it("preserves unsafe declarations but never assigns them as work representatives", async () => {
    const unsafe = agent("2");
    unsafe.indexEndpoints = [{ protocol: "mcp", endpoint: "http://127.0.0.1/private" }];
    expect(await syncCatalogHeaderCandidates(env.DB as unknown as D1DatabaseLike, [unsafe], NOW))
      .toMatchObject({ candidatesIndexed: 1, endpointsIndexed: 1 });
    expect(await env.DB.prepare(`SELECT role, validationProtocol, eligibility, safety,
      representativeAgentKey FROM catalog_endpoints`).first()).toMatchObject({
      role: "operational",
      validationProtocol: "mcp",
      eligibility: "unsafe",
      safety: "unsafe",
      representativeAgentKey: null,
    });
  });

  it("preserves external and mislabeled social resources without scheduling them", async () => {
    const resources = agent("3");
    resources.indexEndpoints = [
      { protocol: "web", endpoint: "https://agent.example.org", rawProtocol: "website", source: "services", sourceIndex: 0 },
      { protocol: "mcp", endpoint: "https://x.com/not-an-mcp", rawProtocol: "MCP", source: "services", sourceIndex: 1 },
      { protocol: "a2a", endpoint: "https://agent.example.org/a2a", rawProtocol: "A2A", source: "services", sourceIndex: 2 },
    ];
    await syncCatalogHeaderCandidates(env.DB as unknown as D1DatabaseLike, [resources], NOW);

    expect(await env.DB.prepare(`SELECT declaredProtocol, role, validationProtocol, externalKind,
      eligibility, representativeAgentKey FROM catalog_endpoints ORDER BY declaredProtocol`).all()).toMatchObject({
      results: [
        { declaredProtocol: "a2a", role: "operational", validationProtocol: "a2a", externalKind: null, eligibility: "eligible", representativeAgentKey: "eip155:56:3" },
        { declaredProtocol: "mcp", role: "operational", validationProtocol: "mcp", externalKind: "social", eligibility: "invalid_declaration", representativeAgentKey: null },
        { declaredProtocol: "web", role: "external", validationProtocol: null, externalKind: "website", eligibility: "unsupported", representativeAgentKey: null },
      ],
    });
  });

  it("creates a quote-verification candidate without treating configuration as admission", async () => {
    const marketplace = agent("303779");
    marketplace.indexEndpoints = [{ protocol: "a2a", endpoint: "https://seller.example.com/grid" }];
    await syncCatalogHeaderCandidates(env.DB as unknown as D1DatabaseLike, [marketplace], NOW);

    expect(await env.DB.prepare(`SELECT state, commerceTransport, endpointKey, provider, validatedAt, reasonCode
      FROM catalog_agent_admission`).first()).toMatchObject({
      state: "candidate",
      commerceTransport: "a2a",
      endpointKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      provider: null,
      validatedAt: null,
      reasonCode: "QUOTE_VERIFICATION_REQUIRED",
    });
  });
});
