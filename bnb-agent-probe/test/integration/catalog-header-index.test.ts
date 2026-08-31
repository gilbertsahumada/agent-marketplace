import { env } from "cloudflare:workers";
import type { D1DatabaseLike } from "../../src/db/client";
import { syncCatalogHeaderCandidates } from "../../src/phases/catalog-header-index";
import type { CatalogAgent } from "../../src/trust8004/types";

const NOW = 1_788_000_000_000;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM catalog_observations").run();
  await env.DB.prepare("DELETE FROM catalog_agent_endpoints").run();
  await env.DB.prepare("DELETE FROM catalog_endpoints").run();
  await env.DB.prepare("DELETE FROM catalog_agents").run();
});

function agent(agentId: string): CatalogAgent {
  return {
    chainId: 56, agentId, name: `Agent ${agentId}`, description: null, imageUrl: null,
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

  it("does not persist an unsafe incremental endpoint", async () => {
    const unsafe = agent("2");
    unsafe.indexEndpoints = [{ protocol: "mcp", endpoint: "http://127.0.0.1/private" }];
    expect(await syncCatalogHeaderCandidates(env.DB as unknown as D1DatabaseLike, [unsafe], NOW))
      .toMatchObject({ candidatesIndexed: 0, endpointsIndexed: 0 });
  });
});
