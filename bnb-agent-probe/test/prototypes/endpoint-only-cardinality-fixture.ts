import type {D1Database} from '../../src/types';

/** Deterministic synthetic agent/declaration counts from the sanitized sizing
 * aggregate. Not a production payload replica: no capabilities or observations.
 * Caller owns clearing its isolated database and resetting experimental triggers.
 */
export async function seedEndpointCardinalityFixture(db:D1Database):Promise<void>{
 for(const [chain,count] of [[56,183220],[97,286]] as const){
  await db.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
   INSERT INTO catalog_agents(agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt)
   SELECT 'eip155:'||?||':'||x,CAST(x AS TEXT),?,'Agent '||x,'ok','current',0,0 FROM n`).bind(count,chain,chain).run();
 }
 await db.prepare(`WITH slots(x) AS(SELECT 0 UNION ALL SELECT x+1 FROM slots WHERE x<11),pairs AS(
 SELECT a.agentKey,slots.x slot FROM catalog_agents a CROSS JOIN slots
 WHERE (a.chainId=56 AND CAST(a.agentId AS INTEGER)<=35230 AND (slots.x=0 OR (a.agentId='1' AND slots.x<=11) OR (CAST(a.agentId AS INTEGER) BETWEEN 2 AND 5348 AND slots.x=1)))
 OR(a.chainId=97 AND CAST(a.agentId AS INTEGER)<=96 AND(slots.x=0 OR(a.agentId='1' AND slots.x<=6)OR(CAST(a.agentId AS INTEGER)BETWEEN 2 AND 78 AND slots.x=1))))
 INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt,representativeAgentKey)
 SELECT agentKey||':'||slot,'a2a','https://seller.example/a2a','origin','safe','operational','a2a','eligible',0,agentKey FROM pairs`).run();
 await db.prepare(`INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt)
 SELECT representativeAgentKey,endpointKey,'current','v1',0,0 FROM catalog_endpoints`).run();
}
