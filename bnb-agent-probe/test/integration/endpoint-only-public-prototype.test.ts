import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import {constructEndpointOnlyPrototype,classifyEndpointOnlyPrototype,ENDPOINT_ONLY_TABLE} from '../prototypes/endpoint-only-public-prototype';
import {constructDensePrototype,classifyDensePrototype,has} from '../prototypes/dense-public-classification';
import {dropDenseMaintenance} from '../prototypes/dense-public-maintenance';
import {clearCatalogFixtures} from './catalog-fixtures';
import {seedPublicEnriched,completeProjectionFixture,NOW} from './public-enriched-fixture';
import {metered,type ReadRecord} from './d1-meter';
import {prototypeCombinedResponse,type PrototypeClassifier} from '../prototypes/public-combined-prototype';
import {catalogAgentsResponse as oldList,catalogFacetsResponse as oldFacets,catalogSummaryResponse as oldSummary} from '../fixtures/public-read-reference/catalog-agents';
import {seedEndpointCardinalityFixture} from '../prototypes/endpoint-only-cardinality-fixture';
const cost=(log:ReadRecord[])=>({queries:log.length,reads:log.reduce((n,r)=>n+r.rowsRead,0),writes:log.reduce((n,r)=>n+r.rowsWritten,0)});
const sorted=<T extends {agentKey:string}>(rows:T[])=>rows.sort((a,b)=>a.agentKey<b.agentKey?-1:a.agentKey>b.agentKey?1:0);
const request=(query:string)=>new Request(`https://worker.test/catalog-agents?${query}`);
const classifier:PrototypeClassifier=(db,now,chain,enabled,query,context)=>classifyEndpointOnlyPrototype(db,now,chain,enabled,query,context.inventory==='registry'?'registry':'operational');

it('preserves full registry and operational flags across networks, missing declarations, NULLs, clocks and shared policy',async()=>{
 await dropDenseMaintenance(env.DB);await seedPublicEnriched(30);
 await env.DB.prepare("DELETE FROM catalog_agent_endpoints WHERE agentKey='eip155:56:100002'").run();
 await env.DB.prepare("UPDATE catalog_agent_endpoints SET declarationState='removed' WHERE agentKey='eip155:56:100003'").run();
 await env.DB.prepare("UPDATE catalog_agents SET name=NULL,registeredAt=NULL,categoriesJson='null' WHERE agentKey='eip155:56:100004'").run();
 await completeProjectionFixture();await constructDensePrototype(env.DB);await constructEndpointOnlyPrototype(env.DB);
 for(const now of [NOW,NOW+1000,NOW+3600000])for(const chain of [56,97] as const)for(const enabled of [true,false])for(const query of ['', '100002','Agent','%_\\\'']){
  const expected=sorted(await classifyDensePrototype(env.DB,now,chain,enabled,query));
  expect(sorted(await classifyEndpointOnlyPrototype(env.DB,now,chain,enabled,query,'registry'))).toEqual(expected);
  expect(sorted(await classifyEndpointOnlyPrototype(env.DB,now,chain,enabled,query,'operational'))).toEqual(expected.filter(row=>has(row,'hasOperational')));
 }
 for(const chain of [56,97]as const)for(const enabled of [false,true])for(const filters of ['inventory=registry','scope=hiring','scope=evaluation','inventory=registry&q=100002','status=quote_failed','protocol=mcp&category=grid_trading','page=999']){
  const query=`chain=${chain}&${filters}`;
  const actual=await(await prototypeCombinedResponse(request(`${query}&limit=3`),env.DB,NOW,2,enabled,classifier)).json()as{list:unknown;facets:unknown;summary:unknown};
  expect(actual.list,query).toEqual(await(await oldList(request(`${query}&limit=3`),env.DB,NOW,2,enabled)).json());
  expect(actual.facets,query).toEqual(await(await oldFacets(request(query.replace(/&page=999/,'')),env.DB,NOW,enabled)).json());
  expect(actual.summary,query).toEqual(await(await oldSummary(request(`chain=${chain}`),env.DB,NOW,enabled)).json());
 }
 const before=await classifyEndpointOnlyPrototype(env.DB,NOW,56,true,'','registry');
 expect(before.some(row=>row.agentId==='100002')).toBe(true);
 await env.DB.prepare("UPDATE catalog_endpoints SET eligibility='unsafe',safety='unsafe' WHERE representativeAgentKey='eip155:56:100000'").run();
 expect(sorted(await classifyEndpointOnlyPrototype(env.DB,NOW,56,true,'','registry'))).toEqual(sorted(await classifyDensePrototype(env.DB,NOW,56,true,'')));
 // Agent metadata remains live even though the prototype has not been rebuilt.
 await env.DB.prepare("UPDATE catalog_agents SET name='Renamed',priority=999 WHERE agentKey='eip155:56:100002'").run();
 expect((await classifyEndpointOnlyPrototype(env.DB,NOW,56,true,'Renamed','registry')).find(row=>row.agentId==='100002')).toMatchObject({priority:999,searchMatch:1});
 expect(await env.DB.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE} WHERE endpointKey=''`).first()).toEqual({n:0});
});

it('measures a deterministic cardinality-matched 183506-agent distribution without persisting 148180 sentinel rows',async()=>{
 await dropDenseMaintenance(env.DB);await clearCatalogFixtures();
 await seedEndpointCardinalityFixture(env.DB);
 const counts=(await env.DB.prepare(`WITH f AS(SELECT a.agentKey,a.chainId,COUNT(d.endpointKey)n FROM catalog_agents a LEFT JOIN catalog_agent_endpoints d ON d.agentKey=a.agentKey GROUP BY a.agentKey)
 SELECT chainId,COUNT(*)agents,SUM(n)declarations,SUM(n=0)sentinels,MAX(n)maxFanout FROM f GROUP BY chainId`).all()).results;
 expect(counts).toEqual([{chainId:56,agents:183220,declarations:40588,sentinels:147990,maxFanout:12},{chainId:97,agents:286,declarations:179,sentinels:190,maxFanout:7}]);
 const construction:ReadRecord[]=[];await constructEndpointOnlyPrototype(metered(env.DB,construction));
 expect(await env.DB.prepare(`SELECT COUNT(*) n FROM ${ENDPOINT_ONLY_TABLE}`).first()).toEqual({n:40767});
 expect(cost(construction)).toEqual({queries:3,reads:81671,writes:40769});
 console.info('ENDPOINT_ONLY_CONSTRUCTION',JSON.stringify({fixture:'agent/declaration cardinalities matched; no capability or observation payloads; not a production replica',...cost(construction)}));
 for(const chain of [56,97]as const)for(const inventory of ['operational','registry']as const){
  const log:ReadRecord[]=[];const started=performance.now();
  const rows=await classifyEndpointOnlyPrototype(metered(env.DB,log),NOW,chain,true,'',inventory);
  const elapsedMs=performance.now()-started;
  expect(rows).toHaveLength(inventory==='registry'?(chain===56?183220:286):(chain===56?35230:96));
  expect(cost(log)).toEqual({queries:1,reads:inventory==='registry'?(chain===56?299627:739):(chain===56?81177:358),writes:0});
  console.info('ENDPOINT_ONLY_CLASSIFICATION',JSON.stringify({chain,inventory,...cost(log),rows:rows.length,serializedBytes:new TextEncoder().encode(JSON.stringify(rows)).byteLength,elapsedMs}));
 }
},120_000);
