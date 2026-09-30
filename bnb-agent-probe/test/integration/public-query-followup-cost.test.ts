import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import {SQLiteAsyncDialect} from 'drizzle-orm/sqlite-core';
import {classifyPublicCurrent,publicCurrentClassificationQuery} from '../../src/catalog/public-current-classification';
import {classifyPublicCurrent as reference} from '../fixtures/pr179-current-classification';
import {seedPublicEnriched,completeProjectionFixture,NOW} from './public-enriched-fixture';
import {metered,type ReadRecord} from './d1-meter';
import {catalogAgentsResponse as baselineResults} from '../fixtures/pr179-catalog-agents';
import {catalogCombinedResponse as baselineCombined} from '../fixtures/pr179-catalog-combined';
import {catalogAgentsResponse as results} from '../../src/routes/catalog-agents';
import {catalogCombinedResponse as combined} from '../../src/routes/catalog-combined';

const total=(log:ReadRecord[])=>({reads:log.reduce((n,r)=>n+r.rowsRead,0),writes:log.reduce((n,r)=>n+r.rowsWritten,0),queries:log.length});
it.each([2000,20000])('PR179 classification parity and cost with %i agents',async count=>{
  await seedPublicEnriched(count);
  await completeProjectionFixture();
  for(const [operation,beforeRead,afterRead] of [['results',baselineResults,results],['combined',baselineCombined,combined]] as const){
    for(const query of ['scope=hiring','scope=evaluation','status=declared','chain=97&scope=evaluation','q=100000']){
      const beforeLog:ReadRecord[]=[],afterLog:ReadRecord[]=[];
      const request=new Request(`https://worker.test/catalog-${operation}?limit=24&${query}`);
      const before=await beforeRead(request,metered(env.DB,beforeLog),NOW);
      const after=await afterRead(request,metered(env.DB,afterLog),NOW);
      expect(after.status).toBe(before.status);
      expect(await after.json()).toEqual(await before.json());
      console.log('PUBLIC_ROUTE_FOLLOWUP',JSON.stringify({count,operation,query,baseline:total(beforeLog),candidate:total(afterLog)}));
      expect(total(afterLog).reads).toBeLessThanOrEqual(total(beforeLog).reads);
      expect(total(afterLog).writes).toBe(0);
    }
  }
  for(const query of [
    "SELECT d.agent_agentKey FROM catalog_public_current_endpoints d WHERE d.agent_chainId=56 AND d.agent_indexState='current'",
    "SELECT d.agent_agentKey,e.role FROM catalog_public_current_endpoints d LEFT JOIN catalog_endpoints e ON e.endpointKey=d.endpointKey WHERE d.agent_chainId=56 AND d.agent_indexState='current'",
    "SELECT agentKey FROM catalog_public_agent_metrics WHERE projectionVersion=1 AND jobCompleted>0 AND agentKey>='eip155:56:' AND agentKey<'eip155:57:'",
  ]){const log:ReadRecord[]=[];await metered(env.DB,log).prepare(query).all();console.log('CLASSIFICATION_COMPONENT',JSON.stringify({query,...total(log)}));}
  for(const statistics of ['absent','partial','complete'] as const){
    await env.DB.prepare('ANALYZE').run();
    if(statistics!=='complete'){
      await env.DB.prepare(statistics==='absent' ? 'DELETE FROM sqlite_stat1' : "DELETE FROM sqlite_stat1 WHERE tbl<>'catalog_public_current_endpoints'").run();
      await env.DB.prepare('ANALYZE sqlite_schema').run();
    }
    for(const chain of [56,97] as const){
      const beforeLog:ReadRecord[]=[],afterLog:ReadRecord[]=[];
      const before=await reference(metered(env.DB,beforeLog),NOW,chain,true);
      const after=await classifyPublicCurrent(metered(env.DB,afterLog),NOW,chain,true);
      expect(after).toEqual(before);
      const baseline=total(beforeLog),candidate=total(afterLog);
      const query=new SQLiteAsyncDialect().sqlToQuery(publicCurrentClassificationQuery(NOW,chain,true));
      const plan=(await env.DB.prepare('EXPLAIN QUERY PLAN '+query.sql).bind(...query.params).all()).results;
      console.log('PUBLIC_QUERY_FOLLOWUP',JSON.stringify({count,statistics,chain,baseline,candidate,plan}));
      expect(candidate.writes).toBe(0);
      expect(candidate.reads).toBeLessThanOrEqual(baseline.reads);
      if(count===20000&&chain===56)expect.soft(candidate.reads).toBeLessThanOrEqual(Math.floor(baseline.reads*.8));
    }
  }
},600000);
