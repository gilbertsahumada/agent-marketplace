import {env} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import {createWorker} from '../../src/index';
import {seedRenewalPilot} from '../../src/phases/renewal-pilot';
import type {Env} from '../../src/types';
import {clearCatalogFixtures} from './catalog-fixtures';
const NOW=1_800_000_000_000;
const settings=()=>({...env,KILL_SWITCH:'0',PRODUCER_KILL_SWITCH:'0',CATALOG_PILOT_PAUSED:'1',CATALOG_PILOT_SEED_ENABLED:'1',BACKGROUND_COST_CONTROLS_ENABLED:'1',SHARED_SECRET:'local-test-only'} as unknown as Env);
beforeEach(async()=>{
 await clearCatalogFixtures();
 await env.DB.prepare('DELETE FROM catalog_pilot_discovery_work').run();
 await env.DB.prepare('DELETE FROM catalog_pilot_origin_schedule').run();
 await env.DB.prepare("DELETE FROM runtime_state WHERE key LIKE 'background_%'").run();
});
it('requires both the temporary seed gate and bearer authentication',async()=>{
 const app=createWorker({now:()=>NOW});
 const request=(secret?:string)=>new Request('https://worker.example/__admin/renewal-pilot/seed',{method:'POST',headers:secret?{authorization:`Bearer ${secret}`}:{}});
 expect((await app.fetch(request(),settings())).status).toBe(401);
 expect((await app.fetch(request('local-test-only'),{...settings(),CATALOG_PILOT_SEED_ENABLED:'0'})).status).toBe(404);
 expect((await app.fetch(request('local-test-only'),{...settings(),CATALOG_PILOT_PAUSED:'0'})).status).toBe(404);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_pilot_discovery_work').first()).toEqual({n:0});
});
it('seeds only current admitted keys, preserves future backoff and is idempotent',async()=>{
 const key='eip155:56:341563';
 await env.DB.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES(?,'341563',56,'ok','current',0,0)").bind(key).run();
 await env.DB.prepare("INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt) VALUES('seed','a2a','https://seller.example/a2a','origin','safe','operational','a2a','eligible',0)").run();
 await env.DB.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt) VALUES(?,'seed','current','v1',0,0)").bind(key).run();
 await env.DB.prepare("INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,compatibilityCheckedAt,nextProbeAt,consecutiveFailures,createdAt,updatedAt) VALUES(?,'seed','a2a','failed','compatible',?,?,2,0,0)").bind(key,NOW,NOW+48*3_600_000).run();
 const first=await seedRenewalPilot(settings(),NOW);
 expect(first).toMatchObject({status:'completed',value:{admitted:1,unavailable:12}});
 const before=await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work').all();
 expect(before.results![0]).toMatchObject({agentKey:key,nextAttemptAt:NOW+48*3_600_000,failures:2});
 await seedRenewalPilot(settings(),NOW+1);
 expect((await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work').all()).results).toEqual(before.results);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_quote_requests').first()).toEqual({n:0});
});
