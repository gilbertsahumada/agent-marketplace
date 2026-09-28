import { env } from 'cloudflare:workers';
import { beforeEach,expect,it,vi } from 'vitest';
import { clearCatalogFixtures } from './catalog-fixtures';
import { loadConfig } from '../../src/config';
import type { Env } from '../../src/types';
import type { D1DatabaseLike } from '../../src/db/client';
import { upsertDiscoveryWork,produceDiscoveryAgenda,type DiscoveryMessage } from '../../src/catalog/pilot-discovery-agenda';
import { discoveryContextVersion,runCatalogDiscovery } from '../../src/phases/catalog-pilot-discovery';
const NOW=1_800_000_000_000,KEY='a'.repeat(64),AGENT='eip155:56:341563',db=env.DB as unknown as D1DatabaseLike;
const contract={encoding:'prefixed-json',taskDescriptionPrefix:'SERVICE_V1:',inputSchema:{type:'object',required:['topic'],properties:{topic:{type:'string'}}},
  capabilityProbeParameters:{topic:'public sample'},terms:{deliverables:'Report',quality_standards:'Cited',evaluation_required:true,evaluator_type:'uma_oov3'}};
const card={name:'Public seller',url:'https://seller.example.com/a2a',skills:[{id:'negotiate'}],capabilities:{extensions:[{uri:'https://marketplace.trust8004.xyz/extensions/negotiation-input/v1',params:contract}]}};
beforeEach(async()=>{
  await clearCatalogFixtures();
  await env.DB.prepare('DELETE FROM catalog_pilot_discovery_work').run();
  await env.DB.prepare('DELETE FROM catalog_pilot_origin_schedule').run();
  await env.DB.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES(?,'341563',56,'ok','current',0,0)").bind(AGENT).run();
  await env.DB.prepare("INSERT INTO catalog_endpoints(endpointKey,protocol,endpoint,originKey,safety,role,validationProtocol,eligibility,nextProbeAt) VALUES(?,'a2a',?,'origin','safe','operational','a2a','eligible',0)").bind(KEY,card.url).run();
  await env.DB.prepare("INSERT INTO catalog_agent_endpoints(agentKey,endpointKey,declarationState,metadataVersion,firstSeenAt,lastSeenAt) VALUES(?,?,'current','v1',0,0)").bind(AGENT,KEY).run();
  await upsertDiscoveryWork(db,{agentKey:AGENT,endpointKey:KEY,originKey:'origin',chainId:56,transport:'a2a',
    contextVersion:discoveryContextVersion({metadataVersion:'v1',transport:'a2a',endpoint:card.url})},NOW);
});
async function message(){const result:DiscoveryMessage[]=[];await produceDiscoveryAgenda(db,{send:async body=>{result.push(body as DiscoveryMessage);}},{nowMs:NOW+60_000,maxOrigins:1});return result[0]!;}
it('discovers usable requirements without ever negotiating, including duplicate delivery',async()=>{
  const work=await message();
  const fetchImpl=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{expect(init?.method??'GET').toBe('GET');return Response.json(card);}) as typeof fetch;
  const result=await runCatalogDiscovery(work,env as unknown as Env,loadConfig({}),{now:()=>NOW+60_001,fetchImpl});
  expect(result.compatibilitySucceeded).toBe(true);
  expect(fetchImpl).toHaveBeenCalledOnce();
  await runCatalogDiscovery(work,env as unknown as Env,loadConfig({}),{now:()=>NOW+60_002,fetchImpl});
  expect(fetchImpl).toHaveBeenCalledOnce();
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_quote_requests').first()).toEqual({n:0});
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_quote_attempts').first()).toEqual({n:0});
});
it.each(['declaration','suspension','newer_evidence'])('does not commit stale results after %s changes during discovery',async change=>{
  const work=await message();
  const fetchImpl:typeof fetch=async()=>{
    if(change==='declaration')await env.DB.prepare("UPDATE catalog_agent_endpoints SET declarationState='removed'").run();
    else await env.DB.prepare(`INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,createdAt,updatedAt,compatibilityCheckedAt,schemaHash)
      VALUES(?,?,'a2a',?,0,?,?,?)`).bind(AGENT,KEY,change==='suspension'?'suspended':'discovered',NOW+60_001,NOW+60_001,'newer').run();
    return Response.json(card);
  };
  const result=await runCatalogDiscovery(work,env as unknown as Env,loadConfig({}),{now:()=>NOW+60_002,fetchImpl});
  expect(result.errorCode).toBe('DISCOVERY_STALE_COMPLETION');
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_observations').first()).toEqual({n:0});
});
it('honors a future capability backoff without contacting the seller',async()=>{
  const work=await message();
  await env.DB.prepare("INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,nextProbeAt,consecutiveFailures,createdAt,updatedAt) VALUES(?,?,'a2a','failed',?,2,0,0)")
    .bind(AGENT,KEY,NOW+3_600_000).run();
  const fetchImpl=vi.fn();
  const result=await runCatalogDiscovery(work,env as unknown as Env,loadConfig({}),{now:()=>NOW+60_002,fetchImpl});
  expect(result.errorCode).toBe('DISCOVERY_BACKOFF');
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT nextAttemptAt FROM catalog_pilot_discovery_work').first()).toEqual({nextAttemptAt:NOW+3_600_000});
});
it('defers a queued renewal when another request already refreshed evidence',async()=>{
  const work=await message();
  await env.DB.prepare("INSERT INTO catalog_seller_capabilities(agentKey,endpointKey,transport,state,compatibilityState,compatibilityCheckedAt,compatibilityExpiresAt,createdAt,updatedAt) VALUES(?,?,'a2a','discovered','compatible',?,?,0,0)")
    .bind(AGENT,KEY,NOW+60_001,NOW+86_460_001).run();
  const fetchImpl=vi.fn();
  const result=await runCatalogDiscovery(work,env as unknown as Env,loadConfig({}),{now:()=>NOW+60_002,fetchImpl});
  expect(result.errorCode).toBe('DISCOVERY_RENEWED');
  expect(fetchImpl).not.toHaveBeenCalled();
});
it('records vendor failure without usable compatibility or a quote',async()=>{
  const work=await message();
  const result=await runCatalogDiscovery(work,env as unknown as Env,loadConfig({}),{now:()=>NOW+60_002,fetchImpl:async()=>new Response('unavailable',{status:503})});
  expect(result.compatibilitySucceeded).toBe(false);
  const capability=await env.DB.prepare('SELECT compatibilityState,compatibilityExpiresAt FROM catalog_seller_capabilities').first<{compatibilityState:string;compatibilityExpiresAt:number|null}>();
  expect(capability!.compatibilityState).not.toBe('compatible');
  expect(capability!.compatibilityExpiresAt).toBeNull();
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_quote_requests').first()).toEqual({n:0});
});
it('does not admit invalid requirements even when the protocol responds',async()=>{
  const work=await message();
  const invalid={...card,capabilities:{extensions:[]}};
  const result=await runCatalogDiscovery(work,env as unknown as Env,loadConfig({}),{now:()=>NOW+60_002,fetchImpl:async()=>Response.json(invalid)});
  expect(result.compatibilitySucceeded).toBe(false);
  expect(await env.DB.prepare('SELECT compatibilityExpiresAt FROM catalog_seller_capabilities').first()).toEqual({compatibilityExpiresAt:null});
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM catalog_quote_requests').first()).toEqual({n:0});
});
