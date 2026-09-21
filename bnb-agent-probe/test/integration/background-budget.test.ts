import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { D1DatabaseLike } from "../../src/db/client";
import { runWithBackgroundBudget, runBackgroundControl, BackgroundBudgetError } from "../../src/db/background-budget";

const db = env.DB as unknown as D1DatabaseLike;
const NOW = Date.UTC(2026, 8, 21, 23, 59);
const key = "background_budget:2026-09-21:jobs";
it("measures accounting queries on local D1",async()=>{
  const log:Array<{kind:string;meta:unknown}>=[];
  const instrumented:D1DatabaseLike={prepare(sql){
    const wrap=(s:ReturnType<D1DatabaseLike["prepare"]>):ReturnType<D1DatabaseLike["prepare"]>=>({...s,
      bind:(...v)=>wrap(s.bind(...v)),
      async all<Row>(){const r=await s.all<Row>();log.push({kind:sql.startsWith("INSERT")?"admission":"read",meta:r.meta});return r;},
      async run<Meta>(){const r=await s.run<Meta>();log.push({kind:sql.includes("MAX(")?"close":"settlement",meta:r.meta});return r;},
    });return wrap(db.prepare(sql));
  },batch:s=>db.batch(s)};
  await runWithBackgroundBudget(instrumented,"jobs","measure",NOW,async()=>0);
  await runWithBackgroundBudget(instrumented,"jobs","measure",NOW,async()=>0);
  await db.prepare("UPDATE runtime_state SET integerValue=10000000 WHERE key=?").bind(key).run();
  await runWithBackgroundBudget(instrumented,"jobs","measure",NOW,async()=>0);
  expect(log.map(entry=>[entry.kind,(entry.meta as {rows_read:number}).rows_read,(entry.meta as {rows_written:number}).rows_written])).toEqual([
    ["admission",1,2],["settlement",1,1],["admission",2,1],["settlement",1,1],["admission",2,1],
  ]);
});
beforeEach(async () => { await db.prepare("DELETE FROM runtime_state WHERE key LIKE 'background_budget:%'").run(); });
async function used(k = key) {
  return (await db.prepare("SELECT integerValue AS n FROM runtime_state WHERE key=?").bind(k).first<{n:number}>())?.n ?? 0;
}

it("atomically admits only reservations that fit a shared lane", async () => {
  let calls = 0;
  const results = await Promise.all(Array.from({length: 12}, () => runWithBackgroundBudget(db, "jobs", "probe", NOW, async () => ++calls, {estimateNanoUsd: 2_000_000})));
  expect(calls).toBe(4);
  expect(results.filter(r => r.status === "completed")).toHaveLength(4);
  expect(await used()).toBe(4 * 5_000 + 8 * 2_000); // unused estimates refunded; cheaper denied control
});

it("separates UTC days and the fixed 40/60 lane allocations", async () => {
  await db.prepare("INSERT INTO runtime_state VALUES (?,NULL,10000000,?)").bind(key,NOW).run();
  let calls=0;
  expect((await runWithBackgroundBudget(db,"jobs","probe",NOW,async()=>++calls)).status).toBe("denied");
  expect((await runWithBackgroundBudget(db,"maintenance","probe",NOW,async()=>++calls)).status).toBe("completed");
  expect((await runWithBackgroundBudget(db,"jobs","probe",NOW+60_000,async()=>++calls)).status).toBe("completed");
  expect(calls).toBe(2);
});

it("retains reservations after callback failure, including control overhead", async () => {
  await expect(runWithBackgroundBudget(db,"jobs","probe",NOW,async()=>{throw new Error("failure");})).rejects.toThrow("failure");
  expect(await used()).toBe(55_000);
});

it("meters first, raw and batch without double execution", async () => {
  const result = await runWithBackgroundBudget(db,"jobs","probe",NOW,async measured=>{
    expect(await measured.prepare("SELECT 1 AS n").first()).toEqual({n:1});
    expect(await measured.prepare("SELECT 2 AS n").raw!({columnNames:true})).toEqual([["n"],[2]]);
    return measured.batch([measured.prepare("SELECT 3 AS n"),measured.prepare("SELECT 4 AS n")]);
  });
  expect(result.status).toBe("completed");
  if(result.status === "completed") expect(result.observedNanoUsd).toBeGreaterThan(0);
});

it("missing metadata closes the lane and blocks following work", async () => {
  const broken: D1DatabaseLike = { ...db, prepare(sql) {
    const original=db.prepare(sql);
    if(sql !== "SELECT 1") return original;
    return {...original, async all<Row>() { return {success:true,meta:{},results:[] as Row[]}; }};
  }, batch: statements=>db.batch(statements) };
  await expect(runWithBackgroundBudget(broken,"jobs","probe",NOW,async measured=>measured.prepare("SELECT 1").all())).rejects.toBeInstanceOf(BackgroundBudgetError);
  expect(await used()).toBeGreaterThanOrEqual(10_000_000);
  let called=false;
  expect((await runWithBackgroundBudget(db,"jobs","probe",NOW,async()=>{called=true;})).status).toBe("denied");
  expect(called).toBe(false);
});

it("charges an observed overrun and prevents a caught error from enabling more queries", async () => {
  let queries=0;
  const excessive: D1DatabaseLike = { prepare(sql) {
    if(sql !== "SELECT 1") return db.prepare(sql);
    return {bind(){return this;},first:async()=>null,async all<Row>(){queries++;return {success:true,meta:{rows_read:100_000,rows_written:0},results:[] as Row[]};},run:async()=>{throw new Error("unused");}};
  },batch:statements=>db.batch(statements)};
  await expect(runWithBackgroundBudget(excessive,"jobs","probe",NOW,async measured=>{
    try{await measured.prepare("SELECT 1").all();}catch{}
    await measured.prepare("SELECT 1").all();
  },{estimateNanoUsd:50_000})).rejects.toBeInstanceOf(BackgroundBudgetError);
  expect(queries).toBe(1);
  expect(await used()).toBeGreaterThanOrEqual(105_000);
});

it("rejects invalid estimates before touching the database", async()=>{
  await expect(runWithBackgroundBudget(db,"jobs","probe",NOW,async()=>0,{estimateNanoUsd:0})).rejects.toThrow();
  expect(await used()).toBe(0);
});

it("keeps an unfinished reservation charged without preventing the next UTC day", async()=>{
  let release!:()=>void;
  let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const hold=new Promise<void>(resolve=>{release=resolve;});
  const running=runWithBackgroundBudget(db,"jobs","held",NOW,async()=>{entered();await hold;});
  await started;
  expect(await used()).toBe(55_000);
  await runWithBackgroundBudget(db,"jobs","next-day",NOW+60_000,async()=>0);
  expect(await used("background_budget:2026-09-22:jobs")).toBe(5_000);
  release();
  await running;
  expect(await used()).toBe(5_000);
  expect(await used("background_budget:2026-09-22:jobs")).toBe(5_000);
});

it("prices writes at 1000 nanoUSD and reads at one", async()=>{
  const priced:D1DatabaseLike={prepare(sql){
    if(sql!=="priced")return db.prepare(sql);
    return {bind(){return this;},first:async()=>null,async all<Row>(){return {success:true,meta:{rows_read:7,rows_written:3},results:[] as Row[]};},run:async()=>{throw new Error("unused");}};
  },batch:statements=>db.batch(statements)};
  const result=await runWithBackgroundBudget(priced,"jobs","price",NOW,m=>m.prepare("priced").all());
  expect(result.status).toBe("completed");
  expect(await used()).toBe(8_007);
});

it("rejects unmetered admission before invoking the callback",async()=>{
  let called=false;
  const broken:D1DatabaseLike={prepare(sql){
    const statement=db.prepare(sql);
    if(!sql.includes("VALUES (?,'granted'"))return statement;
    return { ...statement,bind(...values){const bound=statement.bind(...values);return {...bound,async all<Row>(){const result=await bound.all<Row>();return {...result,meta:undefined};}};} };
  },batch:statements=>db.batch(statements)};
  await expect(runWithBackgroundBudget(broken,"jobs","missing-control",NOW,async()=>{called=true;})).rejects.toBeInstanceOf(BackgroundBudgetError);
  expect(called).toBe(false);
  expect(await used()).toBeGreaterThanOrEqual(10_000_000);
});

it("never retries an ambiguous settlement refund",async()=>{
  let settlements=0;
  const ambiguous:D1DatabaseLike={prepare(sql){
    const statement=db.prepare(sql);
    if(!sql.includes("integerValue=integerValue+?"))return statement;
    return {...statement,bind(...values){const bound=statement.bind(...values);return {...bound,async run<Meta>(){settlements++;await bound.run<Meta>();throw new Error("lost response");}};}};
  },batch:statements=>db.batch(statements)};
  await expect(runWithBackgroundBudget(ambiguous,"jobs","ambiguous",NOW,async()=>0)).rejects.toThrow("lost response");
  expect(settlements).toBe(1);
  expect(await used()).toBeGreaterThanOrEqual(10_000_000);
});

it("returns and persists a UTC not-before deadline for durable deferral",async()=>{
  await db.prepare("INSERT INTO runtime_state VALUES (?,NULL,10000000,?)").bind(key,NOW).run();
  const result=await runWithBackgroundBudget(db,"jobs","deferred",NOW,async()=>{throw new Error("must not run");});
  expect(result).toEqual({status:"denied",lane:"jobs",unitKey:"deferred",notBeforeMs:Date.UTC(2026,8,22)});
  expect(await db.prepare("SELECT textValue FROM runtime_state WHERE key=?").bind(key).first()).toEqual({textValue:`denied:${Date.UTC(2026,8,22)}`});
});

it("charges durable control persistence after exhaustion without admitting normal work",async()=>{
  await db.prepare("INSERT INTO runtime_state VALUES (?,NULL,10000000,?)").bind(key,NOW).run();
  const result=await runBackgroundControl(db,"jobs","deferred-persistence",NOW,async measured=>{
    await measured.prepare("INSERT INTO runtime_state VALUES ('test_deferred_record',NULL,1,0) ON CONFLICT(key) DO UPDATE SET integerValue=1").run();
    return "persisted";
  },{estimateNanoUsd:1}); // control persistence cannot be dropped for overrunning estimate
  expect(result.value).toBe("persisted");
  expect(result.observedNanoUsd).toBeGreaterThan(2000);
  expect(await used()).toBeGreaterThan(10_005_000);
  expect((await runWithBackgroundBudget(db,"jobs","work",NOW,async()=>0)).status).toBe("denied");
  await runBackgroundControl(db,"jobs","defer-after-denial",NOW,async()=>0);
  expect(await db.prepare("SELECT textValue FROM runtime_state WHERE key=?").bind(key).first()).toEqual({textValue:`denied:${Date.UTC(2026,8,22)}`});
});

it("latches a metadata failure despite another in-flight unit refunding its reservation",async()=>{
  let release!:()=>void;
  let entered!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const concurrent=runWithBackgroundBudget(db,"jobs","concurrent",NOW,async()=>{entered();await hold;},{estimateNanoUsd:2_000_000});
  await started;
  const broken:D1DatabaseLike={prepare(sql){
    if(sql!=="unmetered")return db.prepare(sql);
    return {bind(){return this;},first:async()=>null,async all<Row>(){return {success:true,meta:{},results:[] as Row[]};},run:async()=>{throw new Error("unused");}};
  },batch:s=>db.batch(s)};
  await expect(runWithBackgroundBudget(broken,"jobs","broken",NOW,m=>m.prepare("unmetered").all())).rejects.toBeInstanceOf(BackgroundBudgetError);
  release();await concurrent;
  expect(await used()).toBeLessThan(10_000_000);
  await runBackgroundControl(db,"jobs","preserve-latch",NOW,async()=>0);
  let called=false;
  expect((await runWithBackgroundBudget(db,"jobs","must-remain-closed",NOW,async()=>{called=true;})).status).toBe("denied");
  expect(called).toBe(false);
  expect(await db.prepare("SELECT textValue FROM runtime_state WHERE key=?").bind(key).first()).toEqual({textValue:`closed:${Date.UTC(2026,8,22)}`});
  expect((await runWithBackgroundBudget(db,"jobs","next-day",NOW+60_000,async()=>0)).status).toBe("completed");
});

it("creates the closed latch when admission returns unmetered without inserting a row",async()=>{
  const broken:D1DatabaseLike={prepare(sql){
    if(!sql.includes("VALUES (?,'granted'"))return db.prepare(sql);
    return {bind(){return this;},first:async()=>null,async all<Row>(){return {success:true,meta:{},results:[] as Row[]};},run:async()=>{throw new Error("unused");}};
  },batch:s=>db.batch(s)};
  let called=false;
  await expect(runWithBackgroundBudget(broken,"jobs","no-admission-row",NOW,async()=>{called=true;})).rejects.toBeInstanceOf(BackgroundBudgetError);
  expect(called).toBe(false);
  expect(await db.prepare("SELECT textValue FROM runtime_state WHERE key=?").bind(key).first()).toEqual({textValue:`closed:${Date.UTC(2026,8,22)}`});
  expect((await runWithBackgroundBudget(db,"jobs","retry",NOW,async()=>{called=true;})).status).toBe("denied");
  expect(called).toBe(false);
});

it("retains a denial until UTC rollover even when an earlier reservation is refunded",async()=>{
  let release!:()=>void;
  let entered!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const running=runWithBackgroundBudget(db,"jobs","large",NOW,async()=>{entered();await hold;},{estimateNanoUsd:9_980_000});
  await started;
  expect((await runWithBackgroundBudget(db,"jobs","denied",NOW,async()=>0)).status).toBe("denied");
  release();await running;
  expect(await used()).toBe(7_000);
  expect((await runWithBackgroundBudget(db,"jobs","still-denied",NOW,async()=>0)).status).toBe("denied");
  expect(await used()).toBe(9_000);
  expect((await runWithBackgroundBudget(db,"jobs","new-day",NOW+60_000,async()=>0)).status).toBe("completed");
});
