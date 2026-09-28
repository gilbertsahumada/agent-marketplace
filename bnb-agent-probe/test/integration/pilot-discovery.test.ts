import { env } from 'cloudflare:workers';
import { beforeEach,expect,it } from 'vitest';
import { upsertDiscoveryWork, produceDiscoveryAgenda, claimDiscoveryExecution, completeDiscoveryExecution, discoveryAgendaHasDue, type DiscoveryMessage } from '../../src/catalog/pilot-discovery-agenda';
import { PILOT_AGENT_IDS, pilotRenewalDelay } from '../../src/catalog/pilot-policy';
import type { D1DatabaseLike } from '../../src/db/client';
import { measureD1Invocation } from '../../src/db/invocation-metrics';
import { produceRenewalPilot,consumeRenewalPilot } from '../../src/phases/renewal-pilot';
import type { Env } from '../../src/types';

const NOW=1_800_000_000_000;
const db=env.DB as unknown as D1DatabaseLike;
const target={agentKey:'eip155:56:341563',endpointKey:'endpoint',originKey:'origin',chainId:56 as const,transport:'a2a',contextVersion:'v1'};
beforeEach(async()=>{
  await env.DB.prepare('DELETE FROM catalog_pilot_discovery_work').run();
  await env.DB.prepare('DELETE FROM catalog_pilot_origin_schedule').run();
  await env.DB.prepare("DELETE FROM runtime_state WHERE key LIKE 'background_%' OR key LIKE 'catalog_pilot_%'").run();
});
it('admits at most one task per minute across independent origins',async()=>{
  const messages:unknown[]=[];
  const config={...env,KILL_SWITCH:'0',PRODUCER_KILL_SWITCH:'0',CATALOG_PILOT_PAUSED:'0',BACKGROUND_COST_CONTROLS_ENABLED:'1',STAGING_MANUAL_RUN:'0',
    CATALOG_PILOT_QUEUE:{send:async(body:unknown)=>{messages.push(body);}}} as unknown as Env;
  await upsertDiscoveryWork(db,target,NOW);
  await upsertDiscoveryWork(db,{...target,agentKey:'eip155:56:341564',originKey:'another'},NOW);
  await produceRenewalPilot(config,NOW+60_000);
  const meter=measureD1Invocation(env.DB);
  await produceRenewalPilot({...config,DB:meter.db},NOW+60_001);
  expect(messages).toHaveLength(1);
  expect(meter.snapshot().rowsWritten).toBe(0);
  expect(meter.snapshot().rowsRead).toBeLessThanOrEqual(10);
});
it('defers on exhausted maintenance budget without consuming jobs or writing',async()=>{
  await upsertDiscoveryWork(db,target,NOW);
  const day=new Date(NOW).toISOString().slice(0,10);
  await env.DB.prepare('INSERT INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES(?,?,?,?)')
    .bind(`background_budget:${day}:maintenance`,'closed:tomorrow',15_000_000,NOW).run();
  const meter=measureD1Invocation(env.DB);
  const result=await produceRenewalPilot({...env,DB:meter.db,KILL_SWITCH:'0',PRODUCER_KILL_SWITCH:'0',CATALOG_PILOT_PAUSED:'0',BACKGROUND_COST_CONTROLS_ENABLED:'1',STAGING_MANUAL_RUN:'0',
    CATALOG_PILOT_QUEUE:{send:async()=>{throw Error('must not send');}}} as unknown as Env,NOW+60_000);
  expect(result.status).toBe('deferred');
  expect(meter.snapshot().rowsWritten).toBe(0);
  expect(await env.DB.prepare('SELECT key FROM runtime_state WHERE key=?').bind(`background_budget:${day}:jobs`).first()).toBeNull();
  expect(await env.DB.prepare('SELECT state FROM catalog_pilot_discovery_work').first()).toEqual({state:'scheduled'});
});
async function publish(at=NOW+60_000) {
  const messages:DiscoveryMessage[]=[];
  await produceDiscoveryAgenda(db,{send:async body=>{messages.push(body as DiscoveryMessage);}},{nowMs:at,maxOrigins:1,combinedLimits:{56:1,97:0}});
  return messages;
}
it('enforces the fixed network/agent allowlist in code and storage',async()=>{
  await expect(upsertDiscoveryWork(db,{...target,agentKey:'eip155:97:341563',chainId:97},NOW)).rejects.toThrow();
  await expect(upsertDiscoveryWork(db,{...target,agentKey:'eip155:56:999'},NOW)).rejects.toThrow();
  await upsertDiscoveryWork(db,target,NOW);
  await expect(env.DB.prepare("UPDATE catalog_pilot_discovery_work SET chainId=97").run()).rejects.toThrow();
});
it('has deterministic 22–23 hour renewal and an idle read-only preflight',async()=>{
  for(const id of PILOT_AGENT_IDS) {
    const key=`eip155:56:${id}`,delay=pilotRenewalDelay(key);
    expect(delay).toBeGreaterThanOrEqual(22*3_600_000);
    expect(delay).toBeLessThanOrEqual(23*3_600_000);
    expect(pilotRenewalDelay(key)).toBe(delay);
  }
  await upsertDiscoveryWork(db,target,NOW);
  const meter=measureD1Invocation(env.DB);
  expect(await discoveryAgendaHasDue(meter.db as unknown as D1DatabaseLike,NOW)).toBe(false);
  expect(meter.snapshot().complete).toBe(true);
  expect(meter.snapshot().rowsWritten).toBe(0);
  expect(meter.snapshot().rowsRead).toBeLessThanOrEqual(10);
});
it('claims once, fences duplicate completions and renews without quotes',async()=>{
  await upsertDiscoveryWork(db,target,NOW);
  const [message]=await publish();
  expect(message).toBeDefined();
  const claims=await Promise.all([claimDiscoveryExecution(db,message!,NOW+60_000),claimDiscoveryExecution(db,message!,NOW+60_000)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const claim=claims.find(Boolean)!;
  expect(await completeDiscoveryExecution(db,claim,{success:true},NOW+61_000)).toBe(true);
  expect(await completeDiscoveryExecution(db,claim,{success:true},NOW+62_000)).toBe(false);
  const row=await env.DB.prepare('SELECT nextAttemptAt FROM catalog_pilot_discovery_work').first<{nextAttemptAt:number}>();
  expect(row!.nextAttemptAt).toBe(NOW+61_000+pilotRenewalDelay(target.agentKey));
});
it('retains the publication identifier after ambiguous send',async()=>{
  await upsertDiscoveryWork(db,target,NOW);
  let original:unknown;
  await produceDiscoveryAgenda(db,{send:async body=>{original=body;throw new Error('lost ACK');}},{nowMs:NOW+60_000,maxOrigins:1});
  const replay=await publish(NOW+6*60_000);
  expect(replay).toHaveLength(1);
  expect(replay[0]!.runId).toBe((original as DiscoveryMessage).runId);
});
it('recovers an expired execution lease and fences its late response',async()=>{
  await upsertDiscoveryWork(db,target,NOW);
  const [message]=await publish();
  const old=await claimDiscoveryExecution(db,message!,NOW+60_000);
  expect(old).not.toBeNull();
  const [replay]=await publish(NOW+7*60_000);
  expect(replay).toBeDefined();
  const fresh=await claimDiscoveryExecution(db,replay!,NOW+7*60_000);
  expect(fresh).not.toBeNull();
  expect(await completeDiscoveryExecution(db,old!,{success:true},NOW+7*60_000)).toBe(false);
  expect(await completeDiscoveryExecution(db,fresh!,{success:true},NOW+7*60_000)).toBe(true);
});
it('concurrent producers admit only one task globally',async()=>{
  await upsertDiscoveryWork(db,target,NOW);
  await upsertDiscoveryWork(db,{...target,agentKey:'eip155:56:341564',originKey:'another'},NOW);
  const sent:unknown[]=[];
  const config={...env,KILL_SWITCH:'0',PRODUCER_KILL_SWITCH:'0',CATALOG_PILOT_PAUSED:'0',BACKGROUND_COST_CONTROLS_ENABLED:'1',STAGING_MANUAL_RUN:'0',
    CATALOG_PILOT_QUEUE:{send:async(body:unknown)=>{sent.push(body);}}} as unknown as Env;
  await Promise.all([produceRenewalPilot(config,NOW+60_000),produceRenewalPilot(config,NOW+60_000)]);
  expect(sent).toHaveLength(1);
});
it('ACKs budget deferral without losing the durable publication',async()=>{
  await upsertDiscoveryWork(db,target,NOW);
  const [work]=await publish();
  const day=new Date(NOW).toISOString().slice(0,10);
  await env.DB.prepare('INSERT INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES(?,?,?,?)')
    .bind(`background_budget:${day}:maintenance`,'closed:tomorrow',15_000_000,NOW).run();
  let acknowledged=false;
  const result=await consumeRenewalPilot({messages:[{id:'test',timestamp:new Date(NOW),body:work,attempts:1,
    ack:()=>{acknowledged=true;},retry:()=>{throw Error('unexpected immediate retry');}}]},
    {...env,KILL_SWITCH:'0',PRODUCER_KILL_SWITCH:'0',CATALOG_PILOT_PAUSED:'0',BACKGROUND_COST_CONTROLS_ENABLED:'1',STAGING_MANUAL_RUN:'0'} as unknown as Env,
    ()=>NOW+60_001,{fetchImpl:async()=>{throw Error('must not contact vendor');}});
  expect(result.status).toBe('deferred');expect(acknowledged).toBe(true);
  expect(await env.DB.prepare('SELECT state,runId FROM catalog_pilot_discovery_work').first()).toEqual({state:'dispatch',runId:work!.runId});
});
