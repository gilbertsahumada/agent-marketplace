/** Raw current declarations only. Policy and expiry are evaluated by readers.
 * All identifiers below are internal constants; values use bound parameters. */
export const PUBLIC_CURRENT_TABLE = 'catalog_public_current_endpoints';
export const currentAgentFields = ['agentKey','agentId','chainId','name','categoriesJson','priority','registeredAt','indexState'] as const;
export const currentCapabilityFields = ['agentKey','endpointKey','state','compatibilityState','schemaHash','compatibilityCheckedAt','compatibilityExpiresAt','capabilityExpiresAt','lastSuccessAt','consecutiveFailures','lastErrorCode','lastAttemptId'] as const;
export const currentEvidenceFields = ['latestPlatformOutcome','latestPlatformObservedAt','latestPlatformExpiresAt','latestPlatformProtocol','latestPlatformSuccessId','hasBrowserProtocolSuccessEver','latestQuoteOutcome','latestQuoteIsBuyer','latestQuoteExpiresAt','hasBuyerVerifiedQuoteEver'] as const;
export const publicCurrentColumns = [
  ...currentAgentFields.map(field => `agent_${field}`),
  ...currentCapabilityFields.map(field => `cap_${field}`),
  ...currentEvidenceFields.map(field => `evidence_${field}`), 'endpointKey', 'declarationState',
] as const;

const integerColumns = new Set([
  'agent_chainId','agent_priority','agent_registeredAt',
  'cap_compatibilityCheckedAt','cap_compatibilityExpiresAt','cap_capabilityExpiresAt',
  'cap_lastSuccessAt','cap_consecutiveFailures',
  'evidence_latestPlatformObservedAt','evidence_latestPlatformExpiresAt','evidence_latestPlatformSuccessId',
  'evidence_hasBrowserProtocolSuccessEver','evidence_latestQuoteIsBuyer','evidence_latestQuoteExpiresAt','evidence_hasBuyerVerifiedQuoteEver',
]);
const primaryColumns = new Set(['agent_chainId','agent_agentKey','endpointKey']);
export const publicCurrentCreateTableSql = `CREATE TABLE IF NOT EXISTS ${PUBLIC_CURRENT_TABLE} (
  ${publicCurrentColumns.map(column => `${column} ${integerColumns.has(column) ? 'INTEGER' : 'TEXT'}${primaryColumns.has(column) ? ' NOT NULL' : ''}`).join(',\n  ')},
  PRIMARY KEY(agent_chainId,agent_agentKey,endpointKey)
) WITHOUT ROWID`;

/** Column order is explicit for inserts, parity verification and backfill. */
const sourceColumnsSql = `SELECT
  ${currentAgentFields.map(field => `a.${field}`).join(',')},
  ${currentCapabilityFields.map(field => `c.${field}`).join(',')},
  ${currentEvidenceFields.map(field => `p.${field}`).join(',')},d.endpointKey,d.declarationState`;
const evidenceJoinsSql = `LEFT JOIN catalog_seller_capabilities c ON c.agentKey=d.agentKey AND c.endpointKey=d.endpointKey
LEFT JOIN catalog_public_endpoint_evidence p ON p.agentKey=d.agentKey AND p.endpointScope=d.endpointKey AND p.projectionVersion=1
WHERE d.declarationState='current'`;
export const publicCurrentSourceSql = `${sourceColumnsSql}
FROM catalog_agent_endpoints d CROSS JOIN catalog_agents a ON a.agentKey=d.agentKey
${evidenceJoinsSql}`;

const insertPrefix = `INSERT INTO ${PUBLIC_CURRENT_TABLE} (${publicCurrentColumns.join(',')}) `;
const conflictUpdate = ` ON CONFLICT(agent_chainId,agent_agentKey,endpointKey) DO UPDATE SET ${publicCurrentColumns.filter(column => !primaryColumns.has(column)).map(column => `${column}=excluded.${column}`).join(',')}`;
const changedPayload = publicCurrentColumns.filter(column => !primaryColumns.has(column)).map(column => `${PUBLIC_CURRENT_TABLE}.${column} IS NOT excluded.${column}`).join(' OR ');
/** Bind at most 40 [chainId, agentKey, endpointKey] tuples as one JSON array.
 * Caller commits checkpoint and rows in the same transaction. Endpoint-grained
 * keys prevent an agent with large fanout from expanding the admitted page. */
const pageTuplesSql = `SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]') FROM json_each(?) LIMIT 40`;
export const publicCurrentUpsertPageSql = `${insertPrefix}${sourceColumnsSql}
FROM (SELECT value FROM json_each(?) LIMIT 40) k
CROSS JOIN catalog_agents a ON a.agentKey=json_extract(k.value,'$[1]') AND a.chainId=json_extract(k.value,'$[0]')
CROSS JOIN catalog_agent_endpoints d ON d.agentKey=a.agentKey AND d.endpointKey=json_extract(k.value,'$[2]')
${evidenceJoinsSql}${conflictUpdate}`;
export const publicCurrentDeletePageSql = `DELETE FROM ${PUBLIC_CURRENT_TABLE}
WHERE (agent_chainId,agent_agentKey,endpointKey) IN (${pageTuplesSql})`;

const sources = ['catalog_agents','catalog_agent_endpoints','catalog_seller_capabilities','catalog_public_endpoint_evidence'] as const;
const events = ['INSERT','UPDATE','DELETE'] as const;
type Source = typeof sources[number];
type Scope = 'OLD' | 'NEW';
const changedFields: Record<Source,readonly string[]> = {
  catalog_agents: currentAgentFields,
  catalog_agent_endpoints: ['agentKey','endpointKey','declarationState'],
  catalog_seller_capabilities: currentCapabilityFields,
  catalog_public_endpoint_evidence: ['agentKey','endpointScope','projectionVersion',...currentEvidenceFields],
};
function predicate(source: Source, scope: Scope, projected: boolean): string {
  const agent = `${projected ? 'agent_agentKey' : 'a.agentKey'}=${scope}.agentKey`;
  const chain = projected ? ` AND agent_chainId=${source === 'catalog_agents' ? `${scope}.chainId` : `(SELECT chainId FROM catalog_agents WHERE agentKey=${scope}.agentKey)`}` : '';
  const endpoint = source === 'catalog_agents' ? '' : ` AND ${projected ? 'endpointKey' : 'd.endpointKey'}=${scope}.${source === 'catalog_public_endpoint_evidence' ? 'endpointScope' : 'endpointKey'}`;
  return `(${agent}${chain}${endpoint})`;
}

/** Install the whole replacement through a single D1 batch. Source changes and
 * projection maintenance then share a transaction. No endpoint-policy fanout. */
export const publicCurrentTriggerStatements: readonly string[] = sources.flatMap(source => events.flatMap(event => {
  const name = `public_current_${source}_${event.toLowerCase()}`;
  const scopes: Scope[] = event === 'INSERT' ? ['NEW'] : event === 'DELETE' ? ['OLD'] : ['OLD','NEW'];
  const guard = event === 'UPDATE' ? ` WHEN ${changedFields[source].map(field => `OLD.${field} IS NOT NEW.${field}`).join(' OR ')}` : '';
  return [
    `DROP TRIGGER IF EXISTS ${name}`,
    `CREATE TRIGGER ${name} AFTER ${event} ON ${source}${guard} BEGIN
      DELETE FROM ${PUBLIC_CURRENT_TABLE} WHERE (${scopes.map(scope => predicate(source,scope,true)).join(' OR ')})
        AND NOT EXISTS (SELECT 1 FROM catalog_agents a JOIN catalog_agent_endpoints d ON d.agentKey=a.agentKey
          WHERE a.chainId=${PUBLIC_CURRENT_TABLE}.agent_chainId AND a.agentKey=${PUBLIC_CURRENT_TABLE}.agent_agentKey
            AND d.endpointKey=${PUBLIC_CURRENT_TABLE}.endpointKey AND d.declarationState='current');
      ${insertPrefix}${publicCurrentSourceSql} AND (${scopes.map(scope => predicate(source,scope,false)).join(' OR ')})${conflictUpdate} WHERE ${changedPayload};
    END`,
  ];
}));
export const publicCurrentSchemaStatements: readonly string[] = [publicCurrentCreateTableSql,...publicCurrentTriggerStatements];
