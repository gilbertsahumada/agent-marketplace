import { env } from "cloudflare:workers";
import { createWorker } from "../../src/index";
import { clearCatalogFixtures } from "./catalog-fixtures";

const now = 1_788_000_000_000;
beforeEach(clearCatalogFixtures);

it("includes first-time compatible sellers, excludes declarations and scopes facets to search", async () => {
  for (const [id, protocol, compatible] of [["101", "a2a", true], ["102", "mcp", true], ["103", "a2a", false]] as const) {
    const agentKey = `eip155:56:${id}`;
    const endpointKey = id.padStart(64, "0");
    await env.DB.prepare(`INSERT INTO catalog_agents (agentKey,agentId,chainId,name,categoriesJson,metadataState,indexState,firstSeenAt,lastSeenAt)
      VALUES (?,?,56,?,'["grid_trading"]','ok','current',?,?)`).bind(agentKey,id,`Seller ${id}`,now,now).run();
    await env.DB.prepare(`INSERT INTO catalog_endpoints (endpointKey,protocol,endpoint,safety,declaredProtocol,role,validationProtocol,eligibility,nextProbeAt)
      VALUES (?,?,?,'safe',?,'operational',?,'eligible',0)`).bind(endpointKey,protocol,`https://seller${id}.example`,protocol,protocol).run();
    await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt)
      VALUES (?,?,'current',?,?)`).bind(agentKey,endpointKey,now,now).run();
    if (compatible) await env.DB.prepare(`INSERT INTO catalog_seller_capabilities
      (agentKey,endpointKey,transport,state,createdAt,updatedAt,compatibilityState,schemaHash,compatibilityCheckedAt,compatibilityExpiresAt)
      VALUES (?,?,?,'discovered',?,?,'compatible','schema',?,?)`).bind(agentKey,endpointKey,protocol,now,now,now,now+86_400_000).run();
  }
  const app = createWorker({ now: () => now });
  const hiring = await app.fetch(new Request("https://worker.test/catalog-agents?scope=hiring&facets=true"), env);
  expect(await hiring.json()).toMatchObject({ total: 2, facets: { statuses: { declared: 2, requestable: 2, pending: 0 } } });
  const evaluation = await app.fetch(new Request("https://worker.test/catalog-agents?scope=evaluation&facets=true"), env);
  expect(await evaluation.json()).toMatchObject({ total: 1, items: [{ agentId: "103" }], facets: { statuses: { declared: 1, requestable: 0 } } });
  const response = await app.fetch(new Request("https://worker.test/catalog-agents?status=requestable&protocol=a2a&protocol=mcp&facets=true&q=Seller"),env);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({total:2,facets:{statuses:{requestable:2,quote_capable:0}},items:expect.arrayContaining([
    expect.objectContaining({agentId:"101",state:expect.objectContaining({canRequestQuote:true})}),
    expect.objectContaining({agentId:"102",state:expect.objectContaining({canRequestQuote:true})}),
  ])});
  const scoped = await app.fetch(new Request("https://worker.test/catalog-agents?status=requestable&q=101&facets=true"),env);
  expect(await scoped.json()).toMatchObject({total:1,facets:{statuses:{declared:1,requestable:1},categories:{grid_trading:1}}});
  const combined = await app.fetch(new Request("https://worker.test/catalog-agents?status=requestable&protocol=mcp&category=grid_trading&category=rebalancing&facets=true"),env);
  expect(await combined.json()).toMatchObject({total:1,facets:{protocols:{a2a:1,mcp:1},statuses:{requestable:1}},items:[{agentId:"102"}]});
  await env.DB.prepare(`INSERT INTO catalog_observations (agentKey,endpointKey,protocol,source,outcome,observedAt,durationMs,validationKind,verificationLevel)
    VALUES ('eip155:56:101',?,'a2a','worker_probe','http_error',?,1,'protocol','platform_observed')`).bind("101".padStart(64,"0"),now+1).run();
  const failed = await app.fetch(new Request("https://worker.test/catalog-agents?status=requestable"),env);
  expect(await failed.json()).toMatchObject({total:1,items:[{agentId:"102"}]});
});
