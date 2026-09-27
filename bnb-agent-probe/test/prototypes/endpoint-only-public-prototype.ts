/** Local-only alternative: declarations are stored, absent endpoints are virtual. */
import type {D1Database} from '../../src/types';
import {agentFields,capabilityFields,evidenceFields,denseClassificationSql,PROTOTYPE_TABLE,type ClassifiedAgent} from './dense-public-classification';

export const ENDPOINT_ONLY_TABLE='prototype_public_declared_endpoints';
export const endpointOnlyColumns=[...agentFields.map(name=>`agent_${name}`),...capabilityFields.map(name=>`cap_${name}`),...evidenceFields.map(name=>`evidence_${name}`),'endpointKey','declarationState'];
export const endpointOnlySourceSql=`SELECT ${agentFields.map(name=>`a.${name}`).join(',')},${capabilityFields.map(name=>`c.${name}`).join(',')},${evidenceFields.map(name=>`p.${name}`).join(',')},d.endpointKey,d.declarationState
 FROM catalog_agent_endpoints d CROSS JOIN catalog_agents a ON a.agentKey=d.agentKey
 LEFT JOIN catalog_seller_capabilities c ON c.agentKey=d.agentKey AND c.endpointKey=d.endpointKey
 LEFT JOIN catalog_public_endpoint_evidence p ON p.agentKey=d.agentKey AND p.endpointScope=d.endpointKey AND p.projectionVersion=1
 WHERE d.declarationState='current'`;
export async function constructEndpointOnlyPrototype(db:D1Database):Promise<void>{
 const columns=[...agentFields.map(name=>`agent_${name}${name==='chainId'?' INTEGER NOT NULL':name==='agentKey'?' TEXT NOT NULL':''}`),...capabilityFields.map(name=>`cap_${name}`),...evidenceFields.map(name=>`evidence_${name}`)];
 await db.prepare(`DROP TABLE IF EXISTS ${ENDPOINT_ONLY_TABLE}`).run();
 await db.prepare(`CREATE TABLE ${ENDPOINT_ONLY_TABLE}(${columns.join(',')},endpointKey TEXT NOT NULL,declarationState TEXT,PRIMARY KEY(agent_chainId,agent_agentKey,endpointKey)) WITHOUT ROWID`).run();
 await db.prepare(`INSERT INTO ${ENDPOINT_ONLY_TABLE} ${endpointOnlySourceSql}`).run();
}

export function endpointOnlyClassificationSql(now:number,chain:56|97,enabled:boolean,search:string,inventory:'operational'|'registry'='registry'):string{
 // Registry fields remain live even when there is no projection row. The
 // operational branch uses copied agent fields, maintained by source triggers.
 // Capability/evidence copies and the live shared endpoint join are unchanged.
 const original=denseClassificationSql(now,chain,enabled,search);
 const marker=`FROM ${PROTOTYPE_TABLE} d`;
 if(!original.includes(marker))throw new Error('DENSE_SOURCE_CHANGED');
 if(inventory==='operational')return original.replace(marker,`FROM ${ENDPOINT_ONLY_TABLE} d`)+' WHERE hasOperational=1';
 return original.replace(/\bd\.agent_([A-Za-z][A-Za-z0-9]*)/g,'a.$1')
  .replace(marker,`FROM catalog_agents a LEFT JOIN ${ENDPOINT_ONLY_TABLE} d ON d.agent_chainId=a.chainId AND d.agent_agentKey=a.agentKey`);
}

export async function classifyEndpointOnlyPrototype(db:D1Database,now:number,chain:56|97,enabled:boolean,search:string,inventory:'operational'|'registry'='registry'):Promise<ClassifiedAgent[]>{
 return(await db.prepare(endpointOnlyClassificationSql(now,chain,enabled,search,inventory)).all<ClassifiedAgent>()).results??[];
}
