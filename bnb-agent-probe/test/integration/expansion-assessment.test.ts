import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import {clearCatalogFixtures} from './catalog-fixtures';
import {measureD1Invocation} from '../../src/db/invocation-metrics';

// Assessment only: this shortlist does not widen the production pilot.
const ids=['204789','212769','212943','213036','213084','213432'];
const keys=ids.map(id=>`eip155:56:${id}`);
const query=`SELECT c.agentKey,c.state,c.compatibilityState,c.nextProbeAt,
 a.indexState,ae.declarationState,e.eligibility,e.safety,e.role
 FROM catalog_seller_capabilities c INDEXED BY sqlite_autoindex_catalog_seller_capabilities_1
 LEFT JOIN catalog_agents a ON a.agentKey=c.agentKey
 LEFT JOIN catalog_agent_endpoints ae ON ae.agentKey=c.agentKey AND ae.endpointKey=c.endpointKey
 LEFT JOIN catalog_endpoints e ON e.endpointKey=c.endpointKey
 WHERE c.agentKey IN (${keys.map(()=>'?').join(',')}) ORDER BY c.agentKey,c.endpointKey`;

it.each([2000,20000])('assesses six explicit candidates without scanning %i other capabilities',async noise=>{
 await clearCatalogFixtures();
 await env.DB.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
 INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,createdAt,updatedAt)
 SELECT 'eip155:56:'||(900000+x),'unrelated-'||x,'a2a','failed',0,0 FROM n`).bind(noise).run();
 for(const id of ids){
  const key=`eip155:56:${id}`,endpoint=`endpoint-${id}`;
  await env.DB.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES(?,?,56,'ok','current',0,0)").bind(key,id).run();
  await env.DB.prepare("INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt) VALUES(?,'a2a','https://seller.example/a2a','shared','safe','operational','a2a','eligible',0)").bind(endpoint).run();
  await env.DB.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt) VALUES(?,?,'current',0,0)").bind(key,endpoint).run();
  for(const chain of [56,97])await env.DB.prepare("INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,nextProbeAt,createdAt,updatedAt) VALUES(?,?,'a2a','failed','compatible',9999999999999,0,0)").bind(`eip155:${chain}:${id}`,endpoint).run();
 }
 const before=await env.DB.prepare('SELECT * FROM catalog_seller_capabilities WHERE agentKey IN ('+keys.map(()=>'?').join(',')+') ORDER BY agentKey,endpointKey').bind(...keys).all();
 const meter=measureD1Invocation(env.DB);
 const result=await meter.db.prepare(query).bind(...keys).all();
 expect(result.results?.map((row:any)=>row.agentKey)).toEqual(keys);
 expect(result.results?.every((row:any)=>row.state==='failed'&&row.nextProbeAt===9999999999999)).toBe(true);
 expect(meter.snapshot()).toMatchObject({queries:1,complete:true,rowsWritten:0});
 expect(meter.snapshot().rowsRead).toBeLessThanOrEqual(100);
 expect((await env.DB.prepare('SELECT * FROM catalog_seller_capabilities WHERE agentKey IN ('+keys.map(()=>'?').join(',')+') ORDER BY agentKey,endpointKey').bind(...keys).all()).results).toEqual(before.results);
 console.log(JSON.stringify({assessmentOnly:true,noise,candidates:6,...meter.snapshot()}));
});
