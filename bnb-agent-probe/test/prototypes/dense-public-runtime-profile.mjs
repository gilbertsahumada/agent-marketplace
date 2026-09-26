// Local-only runtime evidence. Starts/disposes its own Miniflare instance and
// connects exclusively to that instance's returned inspector URL.
import { build } from "esbuild";
import { Miniflare,convertV4MiniflareOptions } from "miniflare";
import { readD1Migrations } from "@cloudflare/vitest-plugin";
import WebSocket from "ws";
import path from "node:path";
import { deepStrictEqual } from "node:assert";

const root=path.resolve(import.meta.dirname,"../..");
const fixtureAgents=Number(process.argv.find(arg=>arg.startsWith("--agents="))?.split("=")[1]??20000);
if(![20000,40000].includes(fixtureAgents)) throw new Error("Only bounded 20000/40000 fixtures are supported");
const bundled=await build({entryPoints:[path.join(import.meta.dirname,"dense-public-runtime-profile.worker.ts")],
  bundle:true,write:false,format:"esm",platform:"neutral",conditions:["workerd","worker","browser"],
  external:["cloudflare:workers","node:*"],target:"es2022"});
const mf=new Miniflare(convertV4MiniflareOptions({cf:false,inspectorPort:0,workers:[{name:"dense-public-runtime-profile",modules:true,script:bundled.outputFiles[0].text,
  compatibilityDate:"2026-09-01",compatibilityFlags:["nodejs_compat"],
  d1Databases:{DB:"dense-public-runtime-exclusive"},
  outboundService:()=>new Response("Outbound network disabled",{status:503})}]}));
let socket;
try {
  console.error("[local profile] Applying local migrations");
  const db=await mf.getD1Database("DB");
  for(const migration of await readD1Migrations(path.join(root,"migrations"))) {
    await db.batch(migration.queries.map(query=>db.prepare(query)));
  }
  console.error("[local profile] Connecting own inspector");
  const inspector=await mf.getInspectorURL();
  const discovery=new URL("/json/list",inspector);
  discovery.protocol=inspector.protocol==="wss:"?"https:":"http:";
  const targets=await(await fetch(discovery)).json();
  const target=targets.find(item=>item.title?.includes("dense-public-runtime-profile")) ?? targets.find(item=>item.id?.includes("dense-public-runtime-profile"));
  if(!target) throw new Error(`Own inspector target not found; titles: ${targets.map(item=>item.title).join(",")}`);
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.once("open",resolve);socket.once("error",reject);});
  let sequence=0;
  const pending=new Map();
  socket.on("message",data=>{const value=JSON.parse(data.toString());if(value.id){const p=pending.get(value.id);if(p){pending.delete(value.id);value.error?p.reject(new Error(JSON.stringify(value.error))):p.resolve(value.result);}}});
  const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Inspector command timed out: ${method}`));},15000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    socket.send(JSON.stringify({id,method,params}));});
  await command("Runtime.enable");
  await command("Profiler.enable");
  await command("Profiler.setSamplingInterval",{interval:1000});
  await command("Runtime.getHeapUsage");
  console.error(`[local profile] Seeding frozen ${fixtureAgents} fixture`);
  // Fixture generation is setup, not measured Worker execution. Run the exact
  // fixture source against this local D1 binding from Node to avoid including
  // hundreds of thousands of seed-event strings in the application isolate.
  globalThis.__DENSE_PROFILE_ENV={DB:db};
  const fixture=await build({stdin:{contents:'export {seedPublicEnriched,completeProjectionFixture} from "../integration/public-enriched-fixture"; export {constructDensePrototype} from "./dense-public-classification";',
    resolveDir:import.meta.dirname,sourcefile:"runtime-fixture.ts"},bundle:true,write:false,platform:"node",format:"esm",
    plugins:[{name:"exclusive-fixture-env",setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:"profile-env",namespace:"profile-env"}));builder.onLoad({filter:/.*/,namespace:"profile-env"},()=>({contents:"export const env=globalThis.__DENSE_PROFILE_ENV;",loader:"js"}));}}]});
  const setup=await import(`data:text/javascript;base64,${Buffer.from(fixture.outputFiles[0].text).toString("base64")}`);
  await setup.seedPublicEnriched(fixtureAgents);
  await setup.completeProjectionFixture();
  await setup.constructDensePrototype(db);
  const referenceResponses=new Map();
  async function operation(scope,barrier=false) {
    const start=performance.now();
    const response=await mf.dispatchFetch(`http://profile.local/profile?scope=${scope}${barrier?"&barrier=4":""}`);
    const body=await response.json();
    if(!response.ok) throw new Error(`Profile response ${response.status}`);
    const publicBody={list:body.list,facets:body.facets,summary:body.summary};
    if(referenceResponses.has(scope)) deepStrictEqual(publicBody,referenceResponses.get(scope));
    else referenceResponses.set(scope,publicBody);
    return {scope,elapsedMs:performance.now()-start,diagnostics:body.prototypeDiagnostics,
      maxActiveRequests:Number(response.headers.get("x-local-profile-max-active")),sameResponseAsSequential:true};
  }
  const scenarios=[];
  for(const concurrent of [false,true]) {
    const before=await command("Runtime.getHeapUsage"),heapSamples=[];
    let sampling=true;
    const sampler=(async()=>{while(sampling){heapSamples.push(await command("Runtime.getHeapUsage"));await new Promise(resolve=>setTimeout(resolve,10));}})();
    await command("Profiler.start");
    let operations,profile;
    try {
      operations=concurrent?await Promise.all(["hiring","evaluation","hiring","evaluation"].map(scope=>operation(scope,true)))
        :[await operation("hiring"),await operation("evaluation"),await operation("hiring")];
      ({profile}=await command("Profiler.stop"));
    } finally { sampling=false;await sampler; }
    if(concurrent&&Math.max(...operations.map(row=>row.maxActiveRequests))!==4) throw new Error(`Four concurrent Worker requests were not observed: ${JSON.stringify(operations.map(row=>row.maxActiveRequests))}`);
    const after=await command("Runtime.getHeapUsage");
    const nodeNames=new Map(profile.nodes.map(node=>[node.id,node.callFrame.functionName])),sampleKinds={idle:0,program:0,gc:0,other:0};
    for(const id of profile.samples??[]){const name=nodeNames.get(id);sampleKinds[name==="(idle)"?"idle":name==="(program)"?"program":name==="(garbage collector)"?"gc":"other"]++;}
    scenarios.push({concurrency:concurrent?4:1,before,after,
      sampledMaxUsedHeapBytes:Math.max(before.usedSize,after.usedSize,...heapSamples.map(x=>x.usedSize)),heapSampleCount:heapSamples.length,
      samplingIntervalRequestedUs:1000,profileDurationUs:profile.endTime-profile.startTime,cpuSampleKinds:sampleKinds,operations});
  }
  console.log(JSON.stringify({kind:"exclusive-local-workerd-concurrency-profile",fixtureAgents,scenarios,
    limitations:["Sampled heap maximum is not a proven peak; no forced garbage collection.","V8 sampling is local workerd evidence, not billed production CPU or Node CPU.","Inspector polling adds overhead; D1 runs in its separate local service.","Only the worker target created by this script was inspected."]},null,2));
} finally {
  socket?.close();
  await mf.dispose();
}
