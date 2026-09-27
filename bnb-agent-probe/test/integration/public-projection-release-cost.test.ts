import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import {clearCatalogFixtures} from './catalog-fixtures';
import {metered,type ReadRecord} from './d1-meter';
import {backfillPublicProjections,PUBLIC_PROJECTION_CURSOR_KEY,readPublicProjectionCoverage} from '../../src/catalog/public-projections';

it.each([false,true])('measures sparse release pages (current maintenance populated: %s)',async(currentPopulated)=>{
 await clearCatalogFixtures();
 if(currentPopulated){
  await env.DB.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<255)
   INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt) SELECT 'eip155:56:'||x,CAST(x AS TEXT),56,'ok','current',0,0 FROM n`).run();
  await env.DB.prepare("INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt) VALUES('endpoint','a2a','https://example.invalid','origin','safe','operational','a2a','eligible',0)").run();
  await env.DB.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,firstSeenAt,lastSeenAt) SELECT agentKey,'endpoint','current',0,0 FROM catalog_agents").run();
 }
 const names=['catalog_public_observation_insert','catalog_public_request_insert','catalog_public_attempt_insert','catalog_public_hire_insert'];
 const triggers=(await env.DB.prepare(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN (${names.map(()=>'?').join(',')})`).bind(...names).all<{name:string;sql:string}>()).results!;
 expect(triggers).toHaveLength(4);for(const trigger of triggers)await env.DB.prepare(`DROP TRIGGER ${trigger.name}`).run();
 try{
  await env.DB.prepare(`WITH RECURSIVE a(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM a WHERE x<255), n(y) AS(SELECT 1 UNION ALL SELECT y+1 FROM n WHERE y<2398)
   INSERT INTO catalog_observations(agentKey,endpointKey,protocol,source,outcome,observedAt,durationMs,validationKind,verificationLevel)
   SELECT 'eip155:56:'||x,'endpoint','a2a','worker_probe','timeout',y,0,'protocol','platform_observed' FROM a JOIN n ON y<=CASE WHEN x=1 THEN 2398 WHEN x<=124 THEN 22 ELSE 21 END+CASE WHEN x BETWEEN 2 AND 146 THEN 1 ELSE 0 END`).run();
  await env.DB.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<851)
   INSERT INTO catalog_quote_requests(id,requestHash,agentKey,endpointKey,transport,kind,status,callerKey,createdAt)
   SELECT x,'release-'||x,'eip155:56:'||CASE WHEN x<=127 THEN 1 WHEN x<=540 THEN x-126 ELSE x-524 END,'endpoint','a2a',CASE WHEN x<=104 OR x BETWEEN 128 AND 142 THEN 'buyer_quote' ELSE 'capability_probe' END,'succeeded','buyer',0 FROM n`).run();
  await env.DB.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<853)
   INSERT INTO catalog_quote_attempts(id,requestId,executor,status,startedAt) SELECT 'release-'||x,CASE WHEN x<=827 THEN x ELSE x-827 END,'worker','succeeded',x FROM n`).run();
  await env.DB.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<58085)
   INSERT INTO commerce_jobs(chainId,jobId,client,provider,evaluator,budget,expiredAt,status,hook,firstSeenAt,updatedAt)
   SELECT 56,x,'client','provider','evaluator','1',0,3,'hook',0,0 FROM n`).run();
  await env.DB.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<19)
   INSERT INTO hire_events(eventKey,agentId,chainId,phase,provenance,jobId,occurredAt)
   SELECT 'release-'||x,CAST(CASE WHEN x<=15 THEN 50001 WHEN x<=17 THEN 50002 ELSE 50003 END AS TEXT),56,'funded',CASE WHEN x<=13 OR x IN(16,18) THEN 'chain_verified' ELSE 'marketplace_observed' END,CAST(x AS TEXT),0 FROM n`).run();
 }finally{for(const trigger of triggers)await env.DB.prepare(trigger.sql).run();}
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_observations').first()).toEqual({n:8000});
 await env.DB.prepare('UPDATE runtime_state SET textValue=? WHERE key=?').bind(JSON.stringify({version:1,phase:'evidence',agentKey:'',endpointScope:''}),PUBLIC_PROJECTION_CURSOR_KEY).run();
 const rows:{phase:string;reads:number;writes:number;units:number;queries:number}[]=[];
 for(let step=0;step<40;step++){
  const phase=(await readPublicProjectionCoverage(env.DB))!.phase;if(phase==='complete')break;
  const log:ReadRecord[]=[];await backfillPublicProjections(metered(env.DB,log),{batchSize:40,nowMs:0});
  const reads=log.reduce((s,r)=>s+r.rowsRead,0),writes=log.reduce((s,r)=>s+r.rowsWritten,0);
  rows.push({phase,reads,writes,units:reads+1000*writes,queries:log.length});
 }
 expect((await readPublicProjectionCoverage(env.DB))?.phase).toBe('complete');
 console.log('SPARSE_RELEASE_PAGE_COST',JSON.stringify({currentPopulated,rows,totalUnits:rows.reduce((s,r)=>s+r.units,0),maxByPhase:Object.fromEntries(['evidence','metrics','verify_evidence','verify_metrics'].map(phase=>[phase,Math.max(...rows.filter(row=>row.phase===phase).map(row=>row.units))]))}));
},60_000);
