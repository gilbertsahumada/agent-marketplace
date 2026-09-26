/** Local experiment only: no production schema, routes or deployment. */
import type {D1Database} from '../../src/types';
import {PROTOTYPE_TABLE,agentFields,capabilityFields,evidenceFields} from './dense-public-classification';
import {disableProductionCurrentMaintenance} from './isolate-historical-current';

const SOURCES=['catalog_agents','catalog_agent_endpoints','catalog_seller_capabilities','catalog_public_endpoint_evidence'] as const;
const EVENTS=['INSERT','UPDATE','DELETE'] as const;
const COPIED_FIELDS:Record<(typeof SOURCES)[number],readonly string[]>={
  catalog_agents:agentFields,
  catalog_agent_endpoints:['agentKey','endpointKey','declarationState'],
  catalog_seller_capabilities:capabilityFields,
  catalog_public_endpoint_evidence:['agentKey','endpointScope','projectionVersion',...evidenceFields],
};

export async function dropDenseMaintenance(d1:D1Database):Promise<void>{
  await disableProductionCurrentMaintenance(d1);
  for(const source of SOURCES)for(const event of EVENTS)
    await d1.prepare(`DROP TRIGGER IF EXISTS prototype_dense_${source}_${event.toLowerCase()}`).run();
}

async function projectionSql(d1:D1Database):Promise<string>{
  const columns=(await d1.prepare(`PRAGMA table_info(${PROTOTYPE_TABLE})`).all<{name:string}>()).results??[];
  if(!columns.length)throw new Error('DENSE_PROTOTYPE_NOT_CONSTRUCTED');
  const expressions=columns.map(({name})=>{
    if(name.startsWith('agent_'))return `a.${name.slice(6)}`;
    if(name.startsWith('cap_'))return `c.${name.slice(4)}`;
    if(name.startsWith('evidence_'))return `p.${name.slice(9)}`;
    if(name==='endpointKey')return "COALESCE(d.endpointKey,'')";
    if(name==='declarationState')return 'd.declarationState';
    throw new Error('UNEXPECTED_DENSE_COLUMN');
  });
  return `SELECT ${expressions.join(',')} FROM catalog_agents a
    LEFT JOIN catalog_agent_endpoints d ON d.agentKey=a.agentKey AND d.declarationState='current'
    LEFT JOIN catalog_seller_capabilities c ON c.agentKey=d.agentKey AND c.endpointKey=d.endpointKey
    LEFT JOIN catalog_public_endpoint_evidence p ON p.agentKey=d.agentKey AND p.endpointScope=d.endpointKey AND p.projectionVersion=1`;
}

/** All statements execute inside the source mutation's transaction. Agent and
 * declaration changes rebuild that agent's bounded endpoint set, including the
 * empty-endpoint sentinel. Evidence/capability changes touch only their pair.
 * No shared endpoint trigger: live classification still joins current policy. */
export async function installDenseMaintenance(d1:D1Database):Promise<void>{
  const select=await projectionSql(d1);
  if(!d1.batch)throw new Error('DENSE_BATCH_REQUIRED');
  const installation=[];
  for(const source of SOURCES)for(const event of EVENTS){
    const scopes=event==='INSERT'?['NEW']:event==='DELETE'?['OLD']:['OLD','NEW'];
    const pair=source==='catalog_seller_capabilities'||source==='catalog_public_endpoint_evidence';
    const endpointColumn=source==='catalog_public_endpoint_evidence'?'endpointScope':'endpointKey';
    const predicate=(scope:string,projection:boolean)=>`${projection?'agent_agentKey':'a.agentKey'}=${scope}.agentKey${pair?` AND ${projection?'endpointKey':"COALESCE(d.endpointKey,'')"}=${scope}.${endpointColumn}`:''}`;
    const statements=`DELETE FROM ${PROTOTYPE_TABLE} WHERE ${scopes.map(scope=>`(${predicate(scope,true)})`).join(' OR ')};
      INSERT INTO ${PROTOTYPE_TABLE} ${select} WHERE ${scopes.map(scope=>`(${predicate(scope,false)})`).join(' OR ')};`;
    // IS NOT is null-safe: expiry/schema transitions to or from NULL matter.
    // Scheduling, retries and ingestion timestamps are not public evidence.
    const guard=event==='UPDATE'?` WHEN ${COPIED_FIELDS[source].map(field=>`OLD.${field} IS NOT NEW.${field}`).join(' OR ')}`:'';
    const name=`prototype_dense_${source}_${event.toLowerCase()}`;
    installation.push(d1.prepare(`DROP TRIGGER IF EXISTS ${name}`));
    installation.push(d1.prepare(`CREATE TRIGGER ${name} AFTER ${event} ON ${source}${guard} BEGIN ${statements} END`));
  }
  // Reinstall atomically: concurrent writers see either complete trigger set.
  // Bootstrap table creation and reader activation remain separate concerns.
  await d1.batch(installation);
}

/** Absolute bounded repair/backfill page; both deletion and refill commit
 * together. Re-reading current sources avoids replaying stale captured rows.
 * Caller must install triggers before admitting concurrent source writers. */
export async function refreshDenseAgents(d1:D1Database,agentKeys:readonly string[]):Promise<void>{
  if(!agentKeys.length)return;
  if(agentKeys.length>40)throw new Error('DENSE_PAGE_TOO_LARGE');
  const select=await projectionSql(d1),keys=[...new Set(agentKeys)],binds=keys.map(()=>'?').join(',');
  if(!d1.batch)throw new Error('DENSE_BATCH_REQUIRED');
  await d1.batch([
    d1.prepare(`DELETE FROM ${PROTOTYPE_TABLE} WHERE agent_agentKey IN (${binds})`).bind(...keys),
    d1.prepare(`INSERT INTO ${PROTOTYPE_TABLE} ${select} WHERE a.agentKey IN (${binds})`).bind(...keys),
  ]);
}
