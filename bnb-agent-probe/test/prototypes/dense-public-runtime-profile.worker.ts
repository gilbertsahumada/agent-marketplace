import { env } from "cloudflare:workers";
import { prototypeCombinedResponse } from "./public-combined-prototype";

const NOW=1_788_000_000_000;
let activeRequests=0;
let maxActiveRequests=0;
let startWaiters:Array<()=>void>=[];
/** Exclusive local-emulator entry. Never deploy this profiling worker. */
export default {
  async fetch(request:Request):Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname!=="/profile") return new Response("Not found",{status:404});
    activeRequests++;
    maxActiveRequests=Math.max(maxActiveRequests,activeRequests);
    try {
      if(url.searchParams.get("barrier")==="4") {
        await new Promise<void>((resolve,reject)=>{
          const timeout=setTimeout(()=>reject(new Error("Local concurrency barrier timed out")),5000);
          startWaiters.push(()=>{clearTimeout(timeout);resolve();});
          if(startWaiters.length===4) { const ready=startWaiters;startWaiters=[];for(const release of ready) release(); }
        });
      }
      const result=await prototypeCombinedResponse(new Request(`https://worker.test/catalog-agents?status=declared&scope=${url.searchParams.get("scope")==="evaluation"?"evaluation":"hiring"}&limit=24`),env.DB,NOW);
      const headers=new Headers(result.headers);
      headers.set("x-local-profile-max-active",String(maxActiveRequests));
      return new Response(result.body,{status:result.status,headers});
    } finally { activeRequests--; }
  },
};
