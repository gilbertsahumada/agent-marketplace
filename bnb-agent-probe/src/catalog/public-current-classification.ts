import { sql } from 'drizzle-orm';
import type { D1Database } from '../types';
import type { D1DatabaseLike } from '../db/client';
import { createDatabase } from '../db/orm';
import { publicCataloguePolicy } from '../routes/catalog-public-facts';
import { PUBLIC_CURRENT_TABLE } from './public-current-projection-sql';

export const publicCurrentFlags = ['hasOperational','requestable','quoteCapable','hasMcp','hasSeller','erc8183','needsVerification',
  'a2a','mcp','httpFresh','platformSuccess','browserSuccess','failure','latestReachable','freshValid','freshQuote','anyQuote',
  'suspended','quoteFailed','a2aTransport','mcpTransport','httpTransport','completedJobs','mcpOnly','pending','failed','live',
  'historical','never','browserObserved','declared'] as const;
export type PublicCurrentFlag = typeof publicCurrentFlags[number];
export interface PublicCurrentAgent {
  agentKey: string; agentId: string; priority: number; registeredAt: number | null;
  categoriesJson: string; searchMatch: number; bits: number;
}
export function hasPublicCurrentFlag(row: PublicCurrentAgent, flag: PublicCurrentFlag): boolean {
  return Math.floor(row.bits / 2 ** publicCurrentFlags.indexOf(flag)) % 2 === 1;
}

/** Operational marketplace only. Registry retains its paginated source reader.
 * Search is a flag rather than a WHERE clause: chain-wide summary must remain
 * independent of search. Categories are classified once by the shared consumer.
 * Network is the leading physical primary-key range; policy is evaluated live. */
export function publicCurrentClassificationQuery(now: number, chain: 56 | 97, enabled: boolean, search = '') {
  const { flags } = publicCataloguePolicy(now,chain,enabled, {
    capability: field => sql`${sql.identifier('d')}.${sql.identifier(`cap_${field}`)}`,
    evidence: field => sql`${sql.identifier('d')}.${sql.identifier(`evidence_${field}`)}`,
  });
  const escaped = search.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_');
  return sql`WITH endpoint_flags AS (
    SELECT d.agent_agentKey AS agentKey,d.agent_agentId AS agentId,d.agent_name AS name,
      d.agent_priority AS priority,d.agent_registeredAt AS registeredAt,d.agent_categoriesJson AS categoriesJson,
      ${sql.join(Object.entries(flags).map(([key,condition]) => sql`MAX(CASE WHEN ${condition} THEN 1 ELSE 0 END) AS ${sql.identifier(key)}`),sql`, `)}
    FROM ${sql.identifier(PUBLIC_CURRENT_TABLE)} d
    LEFT JOIN catalog_endpoints e ON e.endpointKey=d.endpointKey
    LEFT JOIN catalog_quote_attempts t ON t.id=d.cap_lastAttemptId AND d.cap_state='failed'
    LEFT JOIN catalog_quote_requests r ON r.id=t.requestId AND t.status IN ('failed','rejected')
    WHERE d.agent_chainId=${chain} AND d.agent_indexState='current'
    GROUP BY d.agent_agentKey
  ), public_flags AS (
    SELECT f.*,m.agentKey IS NOT NULL AS completedJobs,
      f.hasMcp AND NOT f.hasSeller AND NOT f.quoteCapable AS mcpOnly,
      NOT f.requestable AND f.needsVerification AS pending,
      f.failure AND NOT f.latestReachable AND NOT f.freshValid AS failed,
      f.a2a OR f.mcp OR f.httpFresh AS live,
      f.platformSuccess AND NOT (f.a2a OR f.mcp OR f.httpFresh) AS historical,
      NOT f.platformSuccess AS never,f.browserSuccess AND NOT f.platformSuccess AS browserObserved,1 AS declared
    FROM endpoint_flags f
    LEFT JOIN catalog_public_agent_metrics m ON m.agentKey=f.agentKey AND m.projectionVersion=1 AND m.jobCompleted>0
  ) SELECT agentKey,agentId,priority,registeredAt,categoriesJson,
    ${search ? sql`CASE WHEN agentId=${search} OR name LIKE ${`%${escaped}%`} ESCAPE '\\' THEN 1 ELSE 0 END` : sql`1`} AS searchMatch,
    ${sql.join(publicCurrentFlags.map((flag,index) => sql`(CASE WHEN ${sql.identifier(flag)} THEN ${2 ** index} ELSE 0 END)`),sql`+`)} AS bits
  FROM public_flags WHERE hasOperational=1`;
}

export async function classifyPublicCurrentAgents(db: D1Database, now: number, chain: 56 | 97, enabled: boolean, search = ''): Promise<PublicCurrentAgent[]> {
  return createDatabase(db as unknown as D1DatabaseLike).all<PublicCurrentAgent>(publicCurrentClassificationQuery(now,chain,enabled,search));
}

export type ClassifiedAgent = PublicCurrentAgent;
export const has = hasPublicCurrentFlag;
export const classifyPublicCurrent = classifyPublicCurrentAgents;
