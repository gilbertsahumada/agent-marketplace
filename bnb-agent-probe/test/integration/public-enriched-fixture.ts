// Frozen base fixture from 1fe712a, enriched before compact-reader implementation.
import { env } from "cloudflare:workers";
import { clearCatalogFixtures } from "./catalog-fixtures";
import { backfillPublicProjections, PUBLIC_PROJECTION_CURSOR_KEY, publicProjectionsReady } from "../../src/catalog/public-projections";

export const NOW = 1_788_000_000_000;
const AGENTS = 2_000;
const ENDPOINTS_PER_AGENT = 2;
const OBSERVATIONS_PER_ENDPOINT = 8;

function hex64(seed: number, salt: string): string {
  return (salt + seed.toString(16).padStart(12, "0")).padEnd(64, "0").slice(0, 64);
}

export async function seedPublicEnriched(agentCount = AGENTS): Promise<void> {
  await clearCatalogFixtures();
  await env.DB.prepare("DELETE FROM catalog_public_endpoint_evidence").run();
  await env.DB.prepare("DELETE FROM catalog_public_agent_metrics").run();
  await env.DB.prepare(`INSERT INTO runtime_state(key,textValue,updatedAt) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET textValue=excluded.textValue,updatedAt=excluded.updatedAt`)
    .bind(PUBLIC_PROJECTION_CURSOR_KEY,JSON.stringify({ version: 1, phase: "evidence", agentKey: "", endpointScope: "" }),NOW).run();
  const statements: string[] = [];
  const agentRows: string[] = [];
  const endpointRows: string[] = [];
  const declarationRows: string[] = [];
  const observationRows: string[] = [];
  const admissionRows: string[] = [];
  let attempt = 0;
  for (let index = 0; index < agentCount; index += 1) {
    const agentId = 100_000 + index;
    const agentKey = `eip155:56:${agentId}`;
    const category = ["grid_trading", "rebalancing", "yield_optimisation", "health_factor_monitoring"][index % 4];
    agentRows.push(`('${agentKey}', '${agentId}', 56, '0x${index.toString(16).padStart(40, "0")}', 'ipfs://meta-${index}', 'Agent ${index}', '["${category}"]', 0, 'ok', 'current', ${NOW - index * 60_000}, '${1_000_000 + index}', ${NOW}, ${NOW}, ${index % 100})`);
    for (let e = 0; e < ENDPOINTS_PER_AGENT; e += 1) {
      const endpointKey = hex64(index * ENDPOINTS_PER_AGENT + e, "e");
      const protocol = e === 0 ? "a2a" : "mcp";
      endpointRows.push(`('${endpointKey}', '${protocol}', 'https://seller-${index}.example/${protocol}', '${hex64(index, "o")}', 'safe', '${agentKey}', ${NOW - 3_600_000}, ${NOW + 3_600_000}, 0, '${protocol}', 'operational', '${protocol}', 'eligible', ${NOW - 3_600_000}, 'protocol_valid', ${NOW - 3_600_000})`);
      declarationRows.push(`('${agentKey}', '${endpointKey}', 'current', ${NOW}, ${NOW}, ${e === 0 ? 80 : 40})`);
      for (let o = 0; o < OBSERVATIONS_PER_ENDPOINT; o += 1) {
        attempt += 1;
        const observedAt = NOW - (OBSERVATIONS_PER_ENDPOINT - o) * 3_600_000;
        const outcome = (index + o) % 5 === 0 ? "timeout" : "protocol_valid";
        observationRows.push(`('attempt-${attempt}', '${agentKey}', '${endpointKey}', '${protocol}', 'worker_probe', '${outcome}', ${observedAt}, ${observedAt + 12 * 3_600_000}, 200, 42, '{}', 'protocol', 'platform_observed')`);
      }
    }
    if (index % 50 === 0) {
      admissionRows.push(`('${agentKey}', 'admitted', 'a2a', '${hex64(index * ENDPOINTS_PER_AGENT, "e")}', 56, '0x${index.toString(16).padStart(40, "0")}', 'seed', NULL)`);
    }
  }
  const chunked = (rows: string[], head: string, size = 200) => {
    for (let offset = 0; offset < rows.length; offset += size) {
      statements.push(`${head} VALUES ${rows.slice(offset, offset + size).join(",")}`);
    }
  };
  chunked(agentRows, "INSERT INTO catalog_agents (agentKey, agentId, chainId, owner, metadataUri, name, categoriesJson, marketplaceConfigured, metadataState, indexState, registeredAt, blockNumber, firstSeenAt, lastSeenAt, priority)");
  chunked(endpointRows, "INSERT INTO catalog_endpoints (endpointKey, protocol, endpoint, originKey, safety, representativeAgentKey, lastProbedAt, nextProbeAt, consecutiveFailures, declaredProtocol, role, validationProtocol, eligibility, lastAttemptAt, lastAttemptOutcome, lastSuccessfulAt)");
  chunked(declarationRows, "INSERT INTO catalog_agent_endpoints (agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt, priority)");
  chunked(observationRows, "INSERT INTO catalog_observations (attemptId, agentKey, endpointKey, protocol, source, outcome, observedAt, expiresAt, httpStatus, durationMs, detailsJson, validationKind, verificationLevel)");
  chunked(admissionRows, "INSERT INTO catalog_agent_admission (agentKey, state, commerceTransport, endpointKey, chainId, provider, configurationVersion, reasonCode)");
  for (let offset = 0; offset < statements.length; offset += 25) {
    await env.DB.batch!(statements.slice(offset, offset + 25).map((statement) => env.DB.prepare(statement)));
  }
  // Different agents declare one shared operational endpoint; old observations
  // remain scoped to their original endpoint and must not bleed between agents.
  const shared = hex64(0, "e");
  await env.DB.prepare(`UPDATE catalog_agent_endpoints SET endpointKey=? WHERE
    CAST(substr(agentKey,11) AS INTEGER)%11=0 AND endpointKey IN
      (SELECT endpointKey FROM catalog_endpoints WHERE protocol='a2a')`).bind(shared).run();
  await env.DB.prepare(`INSERT INTO catalog_observations
    (attemptId,agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel)
    SELECT 'shared-'||agentKey,agentKey,endpointKey,'a2a','worker_probe','protocol_valid',?,?,1,'protocol','platform_observed'
    FROM catalog_agent_endpoints WHERE endpointKey=?`).bind(NOW-500,NOW+3600000,shared).run();
  await env.DB.prepare(`INSERT INTO catalog_seller_capabilities
    (agentKey,endpointKey,transport,state,createdAt,updatedAt,compatibilityState,schemaHash,compatibilityCheckedAt,compatibilityExpiresAt,capabilityExpiresAt,lastSuccessAt)
    SELECT d.agentKey,d.endpointKey,e.protocol,
      CASE CAST(a.agentId AS INTEGER)%10 WHEN 0 THEN 'ready' WHEN 3 THEN 'suspended'
      WHEN 4 THEN 'failed' WHEN 5 THEN 'ready' WHEN 8 THEN 'ready' WHEN 9 THEN 'unsupported' ELSE 'discovered' END,
      ?,?,CASE CAST(a.agentId AS INTEGER)%10 WHEN 4 THEN 'unavailable' WHEN 9 THEN 'unsupported' ELSE 'compatible' END,
      'fixture-schema',?,CASE WHEN CAST(a.agentId AS INTEGER)%10=5 THEN ? ELSE ? END,?,?
    FROM catalog_agents a JOIN catalog_agent_endpoints d ON d.agentKey=a.agentKey
    JOIN catalog_endpoints e ON e.endpointKey=d.endpointKey
    WHERE e.protocol='a2a' AND CAST(a.agentId AS INTEGER)%10<>2`)
    .bind(NOW-2000,NOW-1000,NOW-600000,NOW,NOW+3600000,NOW+3600000,NOW-1000).run();
  await env.DB.prepare(`INSERT INTO catalog_observations
    (attemptId,agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel)
    SELECT 'failure-'||c.agentKey,c.agentKey,c.endpointKey,c.transport,'worker_probe','timeout',?,NULL,1,'protocol','platform_observed'
    FROM catalog_seller_capabilities c JOIN catalog_agents a ON a.agentKey=c.agentKey
    WHERE CAST(a.agentId AS INTEGER)%10=6`).bind(NOW-100).run();
  await env.DB.prepare(`INSERT INTO catalog_observations
    (attemptId,agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,validationKind,verificationLevel)
    SELECT 'browser-'||d.agentKey,d.agentKey,d.endpointKey,e.protocol,'browser_reported','protocol_valid',?,?,1,'protocol','user_observed'
    FROM catalog_agent_endpoints d JOIN catalog_endpoints e ON e.endpointKey=d.endpointKey
    JOIN catalog_agents a ON a.agentKey=d.agentKey WHERE e.protocol='mcp' AND CAST(a.agentId AS INTEGER)%7=0`)
    .bind(NOW-50,NOW+1000).run();
  await env.DB.prepare(`INSERT INTO catalog_quote_requests
    (id,requestHash,agentKey,endpointKey,transport,kind,status,callerKey,createdAt)
    SELECT CAST(a.agentId AS INTEGER),'buyer-'||a.agentId,c.agentKey,c.endpointKey,c.transport,'buyer_quote',
      CASE WHEN CAST(a.agentId AS INTEGER)%10=4 THEN 'failed' ELSE 'succeeded' END,
      CASE WHEN CAST(a.agentId AS INTEGER)%30=0 THEN 'migration' ELSE 'buyer-fixture' END,?
    FROM catalog_seller_capabilities c JOIN catalog_agents a ON a.agentKey=c.agentKey
    WHERE CAST(a.agentId AS INTEGER)%2=0`).bind(NOW-2000).run();
  await env.DB.prepare(`INSERT INTO catalog_quote_attempts(id,requestId,executor,status,startedAt)
    SELECT 'quote-'||id,id,'worker',CASE WHEN status='failed' THEN 'failed' ELSE 'succeeded' END,?
    FROM catalog_quote_requests`).bind(NOW-1000).run();
  await env.DB.prepare(`INSERT INTO catalog_quote_attempts(id,requestId,executor,status,startedAt)
    SELECT 'browser-quote-'||id,id,'browser','failed',? FROM catalog_quote_requests`).bind(NOW-1500).run();
  await env.DB.prepare(`UPDATE catalog_seller_capabilities SET lastAttemptId='quote-'||substr(agentKey,11)
    WHERE CAST(substr(agentKey,11) AS INTEGER)%10=4`).run();
  await env.DB.prepare(`INSERT INTO catalog_observations
    (attemptId,agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,detailsJson,validationKind,verificationLevel)
    SELECT 'buyer-observation-'||agentKey,agentKey,endpointKey,transport,'buyer_refresh','quote_verified',?,?,1,
      '{"quoteKind":"buyer_quote"}','quote','cryptographic' FROM catalog_seller_capabilities WHERE state='ready'`)
    .bind(NOW-20,NOW+1000).run();
  await env.DB.prepare(`INSERT INTO catalog_observations
    (attemptId,agentKey,endpointKey,protocol,source,outcome,observedAt,expiresAt,durationMs,detailsJson,validationKind,verificationLevel)
    SELECT 'probe-observation-'||agentKey,agentKey,endpointKey,transport,'worker_probe','quote_verified',?,?,1,
      '{"quoteKind":"capability_probe"}','quote','cryptographic'
    FROM catalog_seller_capabilities WHERE CAST(substr(agentKey,11) AS INTEGER)%20=0`)
    .bind(NOW-10,NOW+1000).run();
  await env.DB.prepare(`INSERT INTO commerce_jobs(chainId,jobId,client,provider,evaluator,budget,expiredAt,status,hook,firstSeenAt,updatedAt)
    SELECT 56,CAST(agentId AS INTEGER),'client','provider','evaluator','1',?,
      CASE CAST(agentId AS INTEGER)%3 WHEN 0 THEN 3 WHEN 1 THEN 1 ELSE 2 END,'hook',?,?
    FROM catalog_agents WHERE CAST(agentId AS INTEGER)%5=0`).bind(NOW+3600000,NOW,NOW).run();
  await env.DB.prepare(`INSERT INTO hire_events(eventKey,agentId,chainId,phase,provenance,jobId,occurredAt)
    SELECT 'job-'||jobId,CAST(jobId AS TEXT),56,'funded','chain_verified',CAST(jobId AS TEXT),? FROM commerce_jobs`).bind(NOW).run();
  await env.DB.prepare(`INSERT INTO hire_events(eventKey,agentId,chainId,phase,provenance,jobId,occurredAt)
    SELECT 'duplicate-'||jobId,CAST(jobId AS TEXT),56,'funded','chain_verified',CAST(jobId AS TEXT),? FROM commerce_jobs`).bind(NOW).run();
  await env.DB.prepare(`INSERT INTO catalog_observations
    (attemptId,agentKey,endpointKey,protocol,source,outcome,observedAt,durationMs,validationKind,verificationLevel)
    SELECT 'chain-'||agentId,'eip155:56:'||agentId,NULL,'a2a','migration','protocol_valid',?,1,'chain','onchain'
    FROM hire_events WHERE eventKey LIKE 'job-%'`).bind(NOW).run();
  await env.DB.prepare(`UPDATE catalog_endpoints SET eligibility='unsafe',safety='unsafe'
    WHERE representativeAgentKey IN (SELECT agentKey FROM catalog_agents WHERE CAST(agentId AS INTEGER)%17=0)`).run();
  await env.DB.prepare(`UPDATE catalog_agents SET indexState='removed' WHERE CAST(agentId AS INTEGER)%41=0`).run();
  await env.DB.prepare(`INSERT INTO catalog_agents(agentKey,agentId,chainId,name,categoriesJson,metadataState,indexState,firstSeenAt,lastSeenAt)
    SELECT 'eip155:97:'||agentId,agentId,97,name,categoriesJson,'ok','current',?,? FROM catalog_agents ORDER BY agentId LIMIT 20`)
    .bind(NOW,NOW).run();
  await env.DB.prepare(`INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt)
    SELECT 'eip155:97:'||a.agentId,d.endpointKey,'current',?,? FROM catalog_agents a
    JOIN catalog_agent_endpoints d ON d.agentKey='eip155:56:'||a.agentId WHERE a.chainId=97`).bind(NOW,NOW).run();
}

export async function completeProjectionFixture(): Promise<void> {
  for (let batch = 0; batch < 10_000 && !await publicProjectionsReady(env.DB); batch++) {
    await backfillPublicProjections(env.DB,{ batchSize: 40, nowMs: NOW });
  }
  if (!await publicProjectionsReady(env.DB)) throw new Error("Fixture projection coverage is incomplete");
}
