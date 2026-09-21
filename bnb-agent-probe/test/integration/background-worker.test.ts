import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, expect, it, vi } from "vitest";
import { createWorker, type WorkerDependencies } from "../../src/index";
import type { Env } from "../../src/types";
import type { D1DatabaseLike } from "../../src/db/client";
import { replayDeferred } from "../../src/db/deferred-background";

const NOW=Date.UTC(2026,8,21,12);
const day="2026-09-21";
const logger={info:vi.fn(),error:vi.fn()};
const summary={kind:"index_range" as const,chainId:56 as const,status:"ok" as const,fromBlock:1,toBlock:2,window:2,logs:0,jobs:0,jobsFailed:0,d1Queries:1,d1RowsWritten:1,wallTimeMs:1};
function settings(extra:Partial<Env>={}):Env {
  return {...env,KILL_SWITCH:"0",PRODUCER_KILL_SWITCH:"0",BACKGROUND_COST_CONTROLS_ENABLED:"1",COMMERCE_INDEX_ENABLED:"1",
    BACKGROUND_JOBS_PAUSED:"0",BACKGROUND_MAINTENANCE_PAUSED:"0",
    CLOUDFLARE_WORKERS_PLAN:"paid",CRON_INTERVAL_MINUTES:"1",D1_ROWS_WRITTEN_PER_RUN:"1000",CATALOG_PROBE_ENABLED:"0",CATALOG_V2_WRITES_ENABLED:"0",
    AGENT_IDENTITY_INDEX_ENABLED:"0",COMMERCE_TOKEN_BACKFILL_ENABLED:"0",HIRE_NOTIFICATION_RECOVERY_ENABLED:"0",...extra} as unknown as Env;
}
function message(body:unknown={schemaVersion:2,kind:"index_range",chainId:56,enqueuedAt:NOW},id="background-worker") {
  return {id,body,timestamp:new Date(NOW),attempts:1,ack:vi.fn(),retry:vi.fn()};
}
async function deferred() {return env.DB.prepare("SELECT textValue FROM runtime_state WHERE key LIKE 'deferred_background:%'").all<{textValue:string}>();}
beforeEach(async()=>{await env.DB.prepare("DELETE FROM runtime_state").run();await env.DB.prepare("DELETE FROM hire_notifications").run();});

it("meters jobs and acknowledges only after budget settlement",async()=>{
  const msg=message();
  const runner:NonNullable<WorkerDependencies['runCommerceIndex']>=vi.fn(async(_work,target)=>{
    expect(msg.ack).not.toHaveBeenCalled();
    await target.DB.prepare("INSERT INTO runtime_state(key,integerValue,updatedAt) VALUES ('test_commerce_cursor',2,?)").bind(NOW).run();
    expect(msg.ack).not.toHaveBeenCalled();
    return summary;
  });
  await createWorker({now:()=>NOW,logger,runCommerceIndex:runner}).queue({messages:[msg]},settings(),createExecutionContext());
  expect(runner).toHaveBeenCalledTimes(1);expect(msg.ack).toHaveBeenCalledTimes(1);expect(msg.retry).not.toHaveBeenCalled();
  const budget=await env.DB.prepare("SELECT integerValue n FROM runtime_state WHERE key=?").bind(`background_budget:${day}:jobs`).first<{n:number}>();
  expect(budget!.n).toBeGreaterThan(5000);expect(budget!.n).toBeLessThan(55_000);
});

it.each(["denied","paused"])("durably defers %s jobs without invoking the runner or moving its cursor",async reason=>{
  if(reason==="denied") await env.DB.prepare("INSERT INTO runtime_state(key,integerValue,updatedAt) VALUES (?,10000000,?)").bind(`background_budget:${day}:jobs`,NOW).run();
  const msg=message({schemaVersion:2,kind:"index_range",chainId:56,enqueuedAt:NOW,buyerSecret:"must-not-persist"});
  const runner=vi.fn().mockResolvedValue(summary);
  await createWorker({now:()=>NOW,logger,runCommerceIndex:runner}).queue({messages:[msg]},settings(reason==="paused"?{BACKGROUND_JOBS_PAUSED:"1"}:{}),createExecutionContext());
  expect(runner).not.toHaveBeenCalled();expect(msg.ack).toHaveBeenCalledTimes(1);expect(msg.retry).not.toHaveBeenCalled();
  expect(await env.DB.prepare("SELECT * FROM runtime_state WHERE key='test_commerce_cursor'").first()).toBeNull();
  const rows=await deferred();expect(rows.results).toHaveLength(1);expect(rows.results![0]!.textValue).not.toContain("buyerSecret");
  // Older original timestamps remain valid after the next UTC budget reset.
  const replayed:unknown[]=[];
  await replayDeferred(env.DB as unknown as D1DatabaseLike,"jobs",{send:async body=>{replayed.push(body);}},NOW+86_400_000);
  expect(replayed).toHaveLength(1);
  expect(replayed[0]).toMatchObject({enqueuedAt:NOW});
  await createWorker({now:()=>NOW+86_400_000,logger,runCommerceIndex:runner}).queue({messages:[message(replayed[0],"replayed")]},settings(),createExecutionContext());
  expect(runner).toHaveBeenCalledTimes(1);
});

it("leaves ordinary runner failures unacknowledged",async()=>{
  const msg=message();
  const runner=vi.fn(async()=>{throw new Error("RPC_OFFLINE");});
  await expect(createWorker({now:()=>NOW,logger,runCommerceIndex:runner}).queue({messages:[msg]},settings(),createExecutionContext())).rejects.toThrow("RPC_OFFLINE");
  expect(msg.ack).not.toHaveBeenCalled();expect(msg.retry).not.toHaveBeenCalled();
});

it("persists an over-budget message before acknowledgement",async()=>{
  const msg=message();
  const original=env.DB as unknown as D1DatabaseLike;
  const excessive:D1DatabaseLike={prepare(sql){
    if(sql!=="SELECT expensive") return original.prepare(sql);
    return {bind(){return this;},first:async()=>null,async all<Row>(){return {success:true,meta:{rows_read:100_000,rows_written:0},results:[] as Row[]};},run:async()=>{throw new Error("unused");}};
  },batch:statements=>original.batch(statements)};
  const runner=vi.fn(async(_work:unknown,target:Env)=>{
    expect(msg.ack).not.toHaveBeenCalled();
    await target.DB.prepare("SELECT expensive").all();return summary;
  });
  await createWorker({now:()=>NOW,logger,runCommerceIndex:runner}).queue({messages:[msg]},settings({DB:excessive as unknown as Env['DB']}),createExecutionContext());
  expect(msg.ack).toHaveBeenCalledTimes(1);expect((await deferred()).results).toHaveLength(1);
});

it("does not acknowledge paused work if durable persistence fails",async()=>{
  const msg=message();
  const original=env.DB as unknown as D1DatabaseLike;
  const broken:D1DatabaseLike={prepare(sql){
    if(sql.startsWith("INSERT INTO runtime_state(key,textValue,integerValue,updatedAt)")) throw new Error("DEFER_STORAGE_OFFLINE");
    return original.prepare(sql);
  },batch:statements=>original.batch(statements)};
  const runner=vi.fn().mockResolvedValue(summary);
  await expect(createWorker({now:()=>NOW,logger,runCommerceIndex:runner}).queue({messages:[msg]},settings({DB:broken as unknown as Env['DB'],BACKGROUND_JOBS_PAUSED:"1"}),createExecutionContext())).rejects.toThrow("DEFER_STORAGE_OFFLINE");
  expect(runner).not.toHaveBeenCalled();expect(msg.ack).not.toHaveBeenCalled();
});

it("retains the existing queue behavior when cost controls are disabled",async()=>{
  const msg=message();const runner=vi.fn().mockResolvedValue(summary);
  await createWorker({now:()=>NOW,logger,runCommerceIndex:runner}).queue({messages:[msg]},settings({BACKGROUND_COST_CONTROLS_ENABLED:"0",BACKGROUND_JOBS_PAUSED:"1"}),createExecutionContext());
  expect(runner).toHaveBeenCalledTimes(1);expect(msg.ack).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM runtime_state WHERE key LIKE 'background_budget:%' OR key LIKE 'deferred_background:%'").first()).toEqual({n:0});
});

it("keeps 60 minute ticks and duplicate deliveries to 60 jobs ticks and four maintenance ticks",async()=>{
  let clock=NOW;
  const sent:Record<string,unknown>[]=[];
  const target=settings({BSC_RPC_URL:"https://rpc.example.invalid",WP2_QUEUE:{send:async body=>{sent.push(body as Record<string,unknown>);}}});
  // Configure exactly one network without using a live RPC endpoint.
  delete target.BSC_TESTNET_RPC_URL;
  for(let minute=0;minute<60;minute++) {
    clock=NOW+minute*60_000;
    const controller={cron:"* * * * *",scheduledTime:clock};
    await createWorker({now:()=>clock,logger}).scheduled(controller,target,createExecutionContext());
    await createWorker({now:()=>clock,logger}).scheduled(controller,target,createExecutionContext());
  }
  expect(sent.filter(body=>body.kind==="index_range")).toHaveLength(60);
  expect(sent.filter(body=>body.schemaVersion===1 && "scheduledTime" in body)).toHaveLength(4);
},30_000);

it.each(["/hire-notifications","/catalog-quotes/7"])("authenticates marked %s before touching D1",async path=>{
  const prepare=vi.fn(()=>{throw new Error("UNAUTHORIZED_DATABASE_ACCESS");});
  const app=createWorker({now:()=>NOW,logger});
  const request=new Request(`https://worker.test${path}`,{method:path==="/hire-notifications"?"POST":"GET",headers:{authorization:"Bearer wrong","x-marketplace-background-jobs":"1"},...(path==="/hire-notifications"?{body:JSON.stringify({action:"due"})}:{})});
  const response=await app.fetch(request,settings({BUYER_OBSERVATION_SECRET:"valid-service-secret",DB:{prepare}}));
  expect(response.status).toBe(401);expect(prepare).not.toHaveBeenCalled();
});

it.each(["paused","denied"])("defers marked notification work when %s while retaining unmarked event access",async reason=>{
  const app=createWorker({now:()=>NOW,logger});
  const target=settings({BUYER_OBSERVATION_SECRET:"valid-service-secret",...(reason==="paused"?{BACKGROUND_JOBS_PAUSED:"1"}:{})});
  const binding={chainId:56,jobId:"7",agentId:"9",quoteRequestId:1,buyer:`0x${"ab".repeat(20)}`};
  const call=(action:string,marked=false)=>app.fetch(new Request("https://worker.test/hire-notifications",{method:"POST",headers:{authorization:"Bearer valid-service-secret",...(marked?{"x-marketplace-background-jobs":"1"}:{})},body:JSON.stringify({...binding,action})}),target);
  if(reason==="denied") await env.DB.prepare("INSERT INTO runtime_state(key,integerValue,updatedAt) VALUES (?,10000000,?)").bind(`background_budget:${day}:jobs`,NOW).run();
  expect((await call("enqueue")).status).toBe(200);
  expect(await (await call("due")).json()).toEqual([{chainId:56,jobId:"7"}]);
  const before=await env.DB.prepare("SELECT * FROM hire_notifications").all();
  expect((await call("due",true)).status).toBe(503);
  expect((await call("claim",true)).status).toBe(503);
  const markedQuote=await app.fetch(new Request("https://worker.test/catalog-quotes/7",{headers:{authorization:"Bearer valid-service-secret","x-marketplace-background-jobs":"1"}}),target);
  expect(markedQuote.status).toBe(503);
  expect((await env.DB.prepare("SELECT * FROM hire_notifications").all()).results).toEqual(before.results);
}, 30000);

it("memoizes an exhausted producer in a warm worker and preserves denial across cold workers until UTC",async()=>{
  await env.DB.prepare("INSERT INTO runtime_state(key,integerValue,updatedAt) VALUES (?,10000000,?)").bind(`background_budget:${day}:jobs`,NOW).run();
  let clock=NOW;
  const original=env.DB as unknown as D1DatabaseLike;
  const prepare=vi.fn((query:string)=>original.prepare(query));
  const monitored:D1DatabaseLike={prepare,batch:statements=>original.batch(statements)};
  const send=vi.fn().mockResolvedValue(undefined);
  const target=settings({DB:monitored as unknown as Env['DB'],BACKGROUND_MAINTENANCE_PAUSED:"1",BSC_RPC_URL:"https://rpc.example.invalid",WP2_QUEUE:{send}});
  delete target.BSC_TESTNET_RPC_URL;
  const warm=createWorker({now:()=>clock,logger});
  const tick=(app:ReturnType<typeof createWorker>)=>app.scheduled({cron:"* * * * *",scheduledTime:clock},target,createExecutionContext());
  await tick(warm);
  expect(prepare).toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  prepare.mockClear();clock+=60_000;
  await tick(warm);
  expect(prepare).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  const cold=createWorker({now:()=>clock,logger});
  await tick(cold);
  expect(prepare).toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  clock=Date.UTC(2026,8,22);
  await tick(cold);
  expect(send).toHaveBeenCalledExactlyOnceWith({schemaVersion:2,kind:"index_range",chainId:56,enqueuedAt:clock});
});

it("preserves manual-run mode without background D1 work or queue publication",async()=>{
  const prepare=vi.fn(()=>{throw new Error("MANUAL_MODE_DATABASE_ACCESS");});
  const send=vi.fn();
  const target=settings({STAGING_MANUAL_RUN:"1",DB:{prepare},WP2_QUEUE:{send},BSC_RPC_URL:"https://rpc.example.invalid"});
  await createWorker({now:()=>NOW,logger}).scheduled({cron:"* * * * *",scheduledTime:NOW},target,createExecutionContext());
  expect(prepare).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});

it("keeps maintenance available when the independent jobs queue send fails",async()=>{
  let clock=NOW;
  const publications:unknown[]=[];
  const send=vi.fn(async(body:unknown)=>{
    if((body as {kind?:string}).kind==="index_range") throw new Error("JOBS_QUEUE_UNAVAILABLE");
    publications.push(body);
  });
  const target=settings({BSC_RPC_URL:"https://rpc.example.invalid",WP2_QUEUE:{send}});
  delete target.BSC_TESTNET_RPC_URL;
  const app=createWorker({now:()=>clock,logger});
  for(const minute of [0,1,15]) {
    clock=NOW+minute*60_000;
    await app.scheduled({cron:"* * * * *",scheduledTime:clock},target,createExecutionContext());
  }
  expect(publications).toEqual([{schemaVersion:1,scheduledTime:NOW},{schemaVersion:1,scheduledTime:NOW+900_000}]);
  expect(send.mock.calls.filter(([body])=>(body as {kind?:string}).kind==="index_range")).toHaveLength(3);
});

it("retains durable work if control settlement fails after its acknowledgement",async()=>{
  const original=env.DB as unknown as D1DatabaseLike;
  const broken:D1DatabaseLike={prepare(query){
    if(query.startsWith("UPDATE runtime_state SET integerValue=integerValue+")) throw new Error("CONTROL_SETTLEMENT_OFFLINE");
    return original.prepare(query);
  },batch:statements=>original.batch(statements)};
  const msg=message();
  await expect(createWorker({now:()=>NOW,logger}).queue({messages:[msg]},settings({BACKGROUND_JOBS_PAUSED:"1",DB:broken as unknown as Env['DB']}),createExecutionContext())).rejects.toThrow();
  expect(msg.ack).toHaveBeenCalledTimes(1);
  expect((await deferred()).results).toHaveLength(1);
  const send=vi.fn().mockResolvedValue(undefined);
  await replayDeferred(original,"jobs",{send},NOW+900_000);
  expect(send).toHaveBeenCalledTimes(1);
});
