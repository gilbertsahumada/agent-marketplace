import { env } from "cloudflare:workers";
import { createWorker } from "../../src/index";
import { clearCatalogFixtures } from "./catalog-fixtures";

const now = 1_788_000_000_000;
beforeEach(clearCatalogFixtures);

async function seed(chain: 56 | 97) {
  const key = `eip155:${chain}:999`;
  const endpoint = String(chain).padStart(64, "0");
  await env.DB.prepare("INSERT INTO catalog_agents (agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES (?,'999',?,?,'ok','current',?,?)").bind(key,chain,`Seller ${chain}`,now,now).run();
  await env.DB.prepare("INSERT INTO catalog_endpoints (endpointKey,protocol,endpoint,safety,declaredProtocol,role,validationProtocol,eligibility,nextProbeAt) VALUES (?,'a2a',?,'safe','a2a','operational','a2a','eligible',0)").bind(endpoint,`https://seller${chain}.example`).run();
  await env.DB.prepare("INSERT INTO catalog_agent_endpoints (agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt) VALUES (?,?,'current',?,?)").bind(key,endpoint,now,now).run();
}

it("isolates list, unfiltered facets and legacy default by chain", async () => {
  await seed(56); await seed(97);
  const app = createWorker({ now: () => now });
  for (const [query, chain] of [["",56],["&chain=56",56],["&chain=97",97]] as const) {
    const response = await app.fetch(new Request(`https://worker.test/catalog-agents?facets=true${query}`),env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({chainId:chain,total:1,items:[{agentKey:`eip155:${chain}:999`,chainId:chain}],facets:{statuses:{declared:1},reachability:{never:1},protocols:{a2a:1}}});
  }
});

it("selects same agent ID independently for detail and rejects unsupported networks", async () => {
  await seed(56); await seed(97);
  const app = createWorker({ now: () => now });
  for (const chain of [56,97]) {
    const response = await app.fetch(new Request(`https://worker.test/catalog-agent/999?chain=${chain}`),env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({chainId:chain,agent:{agentKey:`eip155:${chain}:999`,name:`Seller ${chain}`}});
  }
  for (const path of ["catalog-agents?chain=1","catalog-agent/999?chain=1","catalog-agents?chain=56&chain=97"]) {
    expect((await app.fetch(new Request(`https://worker.test/${path}`),env)).status).toBe(400);
  }
});
