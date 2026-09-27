import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import {clearCatalogFixtures} from './catalog-fixtures';
import {dropDenseMaintenance} from '../prototypes/dense-public-maintenance';
import {dropEndpointOnlyMaintenance} from '../prototypes/endpoint-only-maintenance';
import {seedEndpointCardinalityFixture} from '../prototypes/endpoint-only-cardinality-fixture';
import {constructEndpointOnlyPrototype,endpointOnlyColumns,endpointOnlySourceSql,endpointOnlyClassificationSql,ENDPOINT_ONLY_TABLE} from '../prototypes/endpoint-only-public-prototype';
import {metered,type ReadRecord} from './d1-meter';
const SHADOW='prototype_endpoint_network_pk',REFERENCE='prototype_endpoint_previous_pk',NOW=1_800_000_000_000;
const cost=(rows:ReadRecord[])=>({queries:rows.length,reads:rows.reduce((n,r)=>n+r.rowsRead,0),writes:rows.reduce((n,r)=>n+r.rowsWritten,0)});
const sorted=(rows:Record<string,unknown>[])=>rows.sort((a,b)=>String(a.agentKey).localeCompare(String(b.agentKey)));

it('measures a chain-leading primary key without a secondary index or canonical-key assumption',async()=>{
 await dropDenseMaintenance(env.DB);await dropEndpointOnlyMaintenance(env.DB);await clearCatalogFixtures();
 await seedEndpointCardinalityFixture(env.DB);await constructEndpointOnlyPrototype(env.DB);
 // Freeze the former two-column PK rather than comparing the new helper to itself.
 await env.DB.prepare(`DROP TABLE IF EXISTS ${REFERENCE}`).run();
 await env.DB.prepare(`CREATE TABLE ${REFERENCE}(${endpointOnlyColumns.join(',')},PRIMARY KEY(agent_agentKey,endpointKey)) WITHOUT ROWID`).run();
 await env.DB.prepare(`INSERT INTO ${REFERENCE} SELECT * FROM ${ENDPOINT_ONLY_TABLE}`).run();
 await env.DB.prepare(`DROP TABLE IF EXISTS ${SHADOW}`).run();
 const setup:ReadRecord[]=[],db=metered(env.DB,setup);
 await db.prepare(`CREATE TABLE ${SHADOW}(${endpointOnlyColumns.map(name=>name==='agent_chainId'?`${name} INTEGER`:name==='agent_agentKey'||name==='endpointKey'?`${name} TEXT`:name).join(',')},PRIMARY KEY(agent_chainId,agent_agentKey,endpointKey)) WITHOUT ROWID`).run();
 await db.prepare(`INSERT INTO ${SHADOW} SELECT * FROM ${ENDPOINT_ONLY_TABLE}`).run();
 console.info('ENDPOINT_NETWORK_PK_CONSTRUCTION',JSON.stringify(cost(setup)));
 expect((await env.DB.prepare(`PRAGMA index_list(${SHADOW})`).all()).results).toHaveLength(1);
 for(const inventory of ['operational','registry']as const)for(const chain of [97,56]as const){
  const current=endpointOnlyClassificationSql(NOW,chain,true,'',inventory);
  const original=current.replaceAll(ENDPOINT_ONLY_TABLE,REFERENCE)
   .replace('ON d.agent_chainId=a.chainId AND d.agent_agentKey=a.agentKey','ON d.agent_agentKey=a.agentKey');
  const replacement=current.replaceAll(ENDPOINT_ONLY_TABLE,SHADOW);
  const plan=(await env.DB.prepare(`EXPLAIN QUERY PLAN ${replacement}`).all<{detail:string}>()).results??[];
  console.info('ENDPOINT_NETWORK_PK_PLAN',JSON.stringify({chain,inventory,plan}));
  expect(plan.some(row=>row.detail.includes(inventory==='registry'?'SEARCH d USING PRIMARY KEY (agent_chainId=? AND agent_agentKey=?)':'SEARCH d USING PRIMARY KEY (agent_chainId=?)'))).toBe(true);
  const before:ReadRecord[]=[],after:ReadRecord[]=[];
  const expected=(await metered(env.DB,before).prepare(original).all<Record<string,unknown>>()).results??[];
  const actual=(await metered(env.DB,after).prepare(replacement).all<Record<string,unknown>>()).results??[];
  expect(sorted(actual)).toEqual(sorted(expected));
  expect(cost(before).reads).toBe(inventory==='operational'?(chain===97?40946:81355):(chain===97?739:299627));
  expect(cost(after).reads).toBe(inventory==='operational'?(chain===97?358:81177):(chain===97?739:299627));
  expect(cost(after).reads).toBeLessThanOrEqual(cost(before).reads);expect(cost(after).writes).toBe(0);
  console.info('ENDPOINT_NETWORK_PK_READS',JSON.stringify({chain,inventory,before:cost(before),after:cost(after),plan}));
 }
 // Source schema permits arbitrary agentKey strings: prefix assumptions would
 // incorrectly omit this same-network identity. The network PK does not.
 await env.DB.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,name,metadataState,indexState,firstSeenAt,lastSeenAt)VALUES('opaque-id','999',97,'Opaque','ok','current',0,0)").run();
 await env.DB.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt) SELECT 'opaque-id',d.endpointKey,'current','v1',0,0 FROM catalog_agent_endpoints d JOIN catalog_agents a ON a.agentKey=d.agentKey WHERE a.chainId=97 LIMIT 1").run();
 await env.DB.prepare(`INSERT INTO ${SHADOW} ${endpointOnlySourceSql} AND a.agentKey='opaque-id'`).run();
 const sql=endpointOnlyClassificationSql(NOW,97,true,'','operational').replaceAll(ENDPOINT_ONLY_TABLE,SHADOW);
 expect((await env.DB.prepare(sql).all<{agentKey:string}>()).results?.some(row=>row.agentKey==='opaque-id')).toBe(true);
},120_000);
