/** Local-only current-declaration projection. No physical directory sentinels. */
import type {D1Database} from '../../src/types';
import {agentFields,capabilityFields,evidenceFields} from './dense-public-classification';
import {ENDPOINT_ONLY_TABLE,endpointOnlySourceSql as currentSourceSql} from './endpoint-only-public-prototype';
import {disableProductionCurrentMaintenance} from './isolate-historical-current';
const SOURCES=['catalog_agents','catalog_agent_endpoints','catalog_seller_capabilities','catalog_public_endpoint_evidence'] as const;
const EVENTS=['INSERT','UPDATE','DELETE'] as const;
const FIELDS:Record<(typeof SOURCES)[number],readonly string[]>={catalog_agents:agentFields,catalog_agent_endpoints:['agentKey','endpointKey','declarationState'],catalog_seller_capabilities:capabilityFields,catalog_public_endpoint_evidence:['agentKey','endpointScope','projectionVersion',...evidenceFields]};

export function endpointOnlySourceSql():string{return currentSourceSql;}

export async function dropEndpointOnlyMaintenance(db:D1Database):Promise<void>{
 await disableProductionCurrentMaintenance(db);
 if(!db.batch)throw new Error('ENDPOINT_BATCH_REQUIRED');
 await db.batch(SOURCES.flatMap(source=>EVENTS.map(event=>db.prepare(`DROP TRIGGER IF EXISTS prototype_endpoint_${source}_${event.toLowerCase()}`))));
}

/** The complete trigger replacement commits atomically. Agent changes affect
 * only its declarations; all other changes affect only old/new endpoint pairs.
 * Shared endpoint policy is intentionally not copied or fanned out. */
export async function installEndpointOnlyMaintenance(db:D1Database):Promise<void>{
 if(!db.batch)throw new Error('ENDPOINT_BATCH_REQUIRED');
 const sourceSql=endpointOnlySourceSql(),statements=[];
 for(const source of SOURCES)for(const event of EVENTS){
  const scopes=event==='INSERT'?['NEW']:event==='DELETE'?['OLD']:['OLD','NEW'];
  const pair=source!=='catalog_agents',endpoint=source==='catalog_public_endpoint_evidence'?'endpointScope':'endpointKey';
  const predicate=(scope:string,projected:boolean)=>`${projected?'agent_agentKey':'a.agentKey'}=${scope}.agentKey${projected?` AND agent_chainId=${source==='catalog_agents'?`${scope}.chainId`:`(SELECT chainId FROM catalog_agents WHERE agentKey=${scope}.agentKey)`}`:''}${pair?` AND ${projected?'endpointKey':'d.endpointKey'}=${scope}.${endpoint}`:''}`;
  const guard=event==='UPDATE'?` WHEN ${FIELDS[source].map(field=>`OLD.${field} IS NOT NEW.${field}`).join(' OR ')}`:'';
  const name=`prototype_endpoint_${source}_${event.toLowerCase()}`;
  statements.push(db.prepare(`DROP TRIGGER IF EXISTS ${name}`));
  statements.push(db.prepare(`CREATE TRIGGER ${name} AFTER ${event} ON ${source}${guard} BEGIN
   DELETE FROM ${ENDPOINT_ONLY_TABLE} WHERE ${scopes.map(scope=>`(${predicate(scope,true)})`).join(' OR ')};
   INSERT INTO ${ENDPOINT_ONLY_TABLE} ${sourceSql} AND (${scopes.map(scope=>`(${predicate(scope,false)})`).join(' OR ')});
  END`));
 }
 await db.batch(statements);
}
