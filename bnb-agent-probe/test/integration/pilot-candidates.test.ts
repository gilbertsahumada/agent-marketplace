import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import {clearCatalogFixtures} from './catalog-fixtures';
import {pilotCandidatePageSql} from '../../src/catalog/pilot-candidates';
import {measureD1Invocation} from '../../src/db/invocation-metrics';
it.each([2000,20000])('bounds discovery sampling with %i capabilities including missing declarations',async size=>{
 await clearCatalogFixtures();
 await env.DB.prepare(`WITH RECURSIVE n(i) AS(SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
 INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,createdAt,updatedAt)
 SELECT 'eip155:56:'||(900000+i),'ep-'||i,'a2a','discovered',0,0 FROM n`).bind(size).run();
 await env.DB.prepare(`INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt)
 SELECT agentKey,substr(agentKey,11),56,'ok','current',0,0 FROM catalog_seller_capabilities ORDER BY agentKey LIMIT 249`).run();
 await env.DB.prepare(`INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt)
 SELECT endpointKey,'a2a','https://seller.example.com/',endpointKey,'safe','operational','a2a','eligible',0 FROM catalog_seller_capabilities ORDER BY agentKey LIMIT 249`).run();
 await env.DB.prepare(`INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt)
 SELECT agentKey,endpointKey,'current',0,0 FROM catalog_seller_capabilities ORDER BY agentKey LIMIT 249`).run();
 const meter=measureD1Invocation(env.DB);
 const page=await meter.db.prepare(pilotCandidatePageSql).bind('eip155:56:','').all<{agentKey:string;endpointKey:string;eligible:number|null}>();
 expect(page.results).toHaveLength(250);
 expect(page.results!.filter(row=>row.eligible)).toHaveLength(249);
 expect(meter.snapshot()).toMatchObject({complete:true,rowsWritten:0,queries:1});
 expect(meter.snapshot().rowsRead).toBeLessThanOrEqual(2500);
 expect(meter.snapshot()).toMatchSnapshot();
 const last=page.results!.at(-1)!;
 const next=await env.DB.prepare(pilotCandidatePageSql).bind(last.agentKey,last.endpointKey).all<{agentKey:string}>();
 expect(next.results!.length).toBe(250);
 expect(next.results![0]!.agentKey>last.agentKey).toBe(true);
});
