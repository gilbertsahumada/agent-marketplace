import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { clearCatalogFixtures } from "./catalog-fixtures";
import { projectSharedDiscoveryFailures } from "../../src/catalog/shared-discovery";
import type { D1DatabaseLike } from "../../src/db/client";

const now = 1800000000000;
const endpoint = 'a'.repeat(64);
beforeEach(clearCatalogFixtures);
async function seed() {
  await env.DB.prepare("INSERT INTO catalog_endpoints (endpointKey,protocol,endpoint,safety,role,eligibility,validationProtocol,nextProbeAt) VALUES (?,'a2a','https://seller.example/a2a','safe','operational','eligible','a2a',0)").bind(endpoint).run();
  for (const id of [1,2,3]) {
    const key = `eip155:56:${id}`;
    await env.DB.prepare("INSERT INTO catalog_agents (agentKey,agentId,chainId,metadataState,firstSeenAt,lastSeenAt) VALUES (?,?,56,'ok',?,?)").bind(key,String(id),now,now).run();
    await env.DB.prepare("INSERT INTO catalog_agent_endpoints (agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt) VALUES (?,?,'current',?,?)").bind(key,endpoint,now,now).run();
    await env.DB.prepare("INSERT INTO catalog_seller_capabilities (agentKey,endpointKey,transport,state,createdAt,updatedAt) VALUES (?,?,'a2a','discovered',?,?)").bind(key,endpoint,now,now).run();
  }
  await env.DB.prepare("UPDATE catalog_seller_capabilities SET compatibilityState='unsupported',compatibilityErrorCode='A2A_REQUIRED_SKILLS',compatibilityCheckedAt=? WHERE agentKey='eip155:56:1'").bind(now-1000).run();
}
it("projects a bounded exact-endpoint public failure without creating quotes or fresh timestamps", async () => {
  await seed();
  expect(await projectSharedDiscoveryFailures(env.DB as unknown as D1DatabaseLike,now,1)).toBe(1);
  const row = await env.DB.prepare("SELECT * FROM catalog_seller_capabilities WHERE agentKey='eip155:56:2'").first();
  expect(row).toMatchObject({state:'discovered',compatibilityState:'unsupported',compatibilityCheckedAt:now-1000,lastSuccessAt:null});
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM catalog_quote_requests").first()).toMatchObject({n:0});
  expect(await projectSharedDiscoveryFailures(env.DB as unknown as D1DatabaseLike,now,100)).toBe(1);
});
it("does not share auth failures, stale results or project suspended rows", async () => {
  await seed();
  await env.DB.prepare("UPDATE catalog_seller_capabilities SET compatibilityErrorCode='SELLER_ACCESS_DENIED' WHERE agentKey='eip155:56:1'").run();
  expect(await projectSharedDiscoveryFailures(env.DB as unknown as D1DatabaseLike,now,100)).toBe(0);
  await env.DB.prepare("UPDATE catalog_seller_capabilities SET compatibilityErrorCode='A2A_REQUIRED_SKILLS',compatibilityCheckedAt=? WHERE agentKey='eip155:56:1'").bind(now-86400001).run();
  expect(await projectSharedDiscoveryFailures(env.DB as unknown as D1DatabaseLike,now,100)).toBe(0);
  await env.DB.prepare("UPDATE catalog_seller_capabilities SET compatibilityCheckedAt=? WHERE agentKey='eip155:56:1'").bind(now-1000).run();
  await env.DB.prepare("UPDATE catalog_seller_capabilities SET state='suspended' WHERE agentKey<>'eip155:56:1'").run();
  expect(await projectSharedDiscoveryFailures(env.DB as unknown as D1DatabaseLike,now,100)).toBe(0);
});
