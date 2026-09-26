/** Local-only prototype. No migrations, triggers, HTTP routes or cache writes. */
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import { publicCatalogueFacts } from "../../src/routes/catalog-public-facts";
import type { D1Database } from "../../src/types";

export const PROTOTYPE_TABLE = "prototype_public_current_endpoints";
export const agentFields = ["agentKey","agentId","chainId","name","categoriesJson","priority","registeredAt","indexState"];
export const capabilityFields = ["agentKey","endpointKey","state","compatibilityState","schemaHash","compatibilityCheckedAt","compatibilityExpiresAt","capabilityExpiresAt","lastSuccessAt","consecutiveFailures","lastErrorCode","lastAttemptId"];
export const evidenceFields = ["latestPlatformOutcome","latestPlatformObservedAt","latestPlatformExpiresAt","latestPlatformProtocol","latestPlatformSuccessId","hasBrowserProtocolSuccessEver","latestQuoteOutcome","latestQuoteIsBuyer","latestQuoteExpiresAt","hasBuyerVerifiedQuoteEver"];

/** Build cost is explicitly metered separately from requests. Every copied
 * value is raw agent/declaration/capability data or intrinsic evidence. Shared
 * endpoint policy is intentionally absent and always joined live. */
export async function constructDensePrototype(d1: D1Database): Promise<void> {
  await d1.prepare(`DROP TABLE IF EXISTS ${PROTOTYPE_TABLE}`).run();
  const columns = [...agentFields.map(name=>`agent_${name}`),...capabilityFields.map(name=>`cap_${name}`),...evidenceFields.map(name=>`evidence_${name}`)];
  await d1.prepare(`CREATE TABLE ${PROTOTYPE_TABLE} (
    ${columns.join(",")},endpointKey TEXT NOT NULL,declarationState TEXT,
    PRIMARY KEY(agent_agentKey,endpointKey)) WITHOUT ROWID`).run();
  await d1.prepare(`INSERT INTO ${PROTOTYPE_TABLE}
    SELECT ${agentFields.map(name=>`a.${name}`).join(",")},${capabilityFields.map(name=>`c.${name}`).join(",")},${evidenceFields.map(name=>`p.${name}`).join(",")},
      COALESCE(d.endpointKey,''),d.declarationState
    FROM catalog_agents a LEFT JOIN catalog_agent_endpoints d ON d.agentKey=a.agentKey AND d.declarationState='current'
    LEFT JOIN catalog_seller_capabilities c ON c.agentKey=d.agentKey AND c.endpointKey=d.endpointKey
    LEFT JOIN catalog_public_endpoint_evidence p ON p.agentKey=d.agentKey AND p.endpointScope=d.endpointKey AND p.projectionVersion=1`).run();
}

export const flags = ["hasOperational","requestable","quoteCapable","hasMcp","hasSeller","erc8183","needsVerification",
  "a2a","mcp","httpFresh","platformSuccess","browserSuccess","failure","latestReachable","freshValid","freshQuote","anyQuote",
  "suspended","quoteFailed","a2aTransport","mcpTransport","httpTransport","completedJobs","mcpOnly","pending","failed","live","historical","never","browserObserved","declared"] as const;
export type Flag = typeof flags[number];
export interface ClassifiedAgent { agentKey: string; agentId: string; priority: number; registeredAt: number | null;
  categoriesJson: string; searchMatch: number; bits: number; }
export const has = (row: ClassifiedAgent, flag: Flag): boolean => Math.floor(row.bits / 2 ** flags.indexOf(flag)) % 2 === 1;

export function denseClassificationSql(now: number, chain: 56|97, enabled: boolean, search: string): string {
  // Reuse the current, parity-tested runtime policy, not cached policy results.
  // The replacement is intentionally confined to this prototype's source join.
  let relation = new SQLiteAsyncDialect().sqlToQuery(publicCatalogueFacts(now,chain,enabled).inlineParams()).sql;
  const start = relation.indexOf("FROM catalog_agents a");
  const end = relation.indexOf("WHERE a.chainId=",start);
  if (start < 0 || end < 0) throw new Error("Prototype source relation changed");
  relation = relation.slice(0,start) + `FROM ${PROTOTYPE_TABLE} d
    LEFT JOIN catalog_endpoints e ON e.endpointKey=d.endpointKey
    LEFT JOIN catalog_quote_attempts t ON t.id=d.cap_lastAttemptId AND d.cap_state='failed'
    LEFT JOIN catalog_quote_requests r ON r.id=t.requestId AND t.status IN ('failed','rejected')
    ` + relation.slice(end);
  relation = relation.replace(/\ba\.([A-Za-z][A-Za-z0-9]*)/g,"d.agent_$1")
    .replace(/\bc\.([A-Za-z][A-Za-z0-9]*)/g,"d.cap_$1")
    .replace(/\bp\.([A-Za-z][A-Za-z0-9]*)/g,"d.evidence_$1");
  // Categories are classified from the raw JSON once in the shared JS pass.
  // Do not also execute the SQL json_each aggregate for every grouped agent.
  const categoryStart = relation.indexOf("(SELECT COALESCE(SUM(DISTINCT CASE j.value");
  const categoryEnd = relation.indexOf(" AS categoryMask", categoryStart);
  if (categoryStart < 0 || categoryEnd < 0) throw new Error("Prototype category relation changed");
  relation = relation.slice(0,categoryStart) + "0" + relation.slice(categoryEnd);
  // Alias copied raw agent columns back to the existing public names.
  for (const name of ["agentKey","agentId","chainId","categoriesJson","priority","registeredAt"]) {
    relation = relation.replace(`d.agent_${name},`,`d.agent_${name} AS ${name},`);
  }
  const quote = (value: string) => `'${value.replaceAll("'","''")}'`;
  const escaped = search.replaceAll("\\","\\\\").replaceAll("%","\\%").replaceAll("_","\\_");
  // Name is required only for search, and must not filter the chain-only summary.
  relation = relation.replace("d.agent_registeredAt AS registeredAt,",`d.agent_registeredAt AS registeredAt,d.agent_name AS name,`);
  return `WITH ${relation} SELECT agentKey,agentId,priority,registeredAt,categoriesJson,
    ${search ? `CASE WHEN agentId=${quote(search)} OR name LIKE ${quote(`%${escaped}%`)} ESCAPE '\\' THEN 1 ELSE 0 END` : "1"} AS searchMatch,
    ${flags.map((flag,index)=>`(CASE WHEN ${flag} THEN ${2**index} ELSE 0 END)`).join("+")} AS bits
    FROM public_flags`;
}

export async function classifyDensePrototype(d1: D1Database,now: number,chain: 56|97,enabled: boolean,search: string): Promise<ClassifiedAgent[]> {
  return (await d1.prepare(denseClassificationSql(now,chain,enabled,search)).all<ClassifiedAgent>()).results ?? [];
}
