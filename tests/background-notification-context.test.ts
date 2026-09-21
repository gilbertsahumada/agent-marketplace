import {afterEach,expect,it,vi} from "vitest";
import {notificationStore} from "../src/data/observation/hire-notification-store";
import {resolveBuyerQuoteRequest} from "../src/data/observation/quote-request-sync";

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
function setup(){
  vi.stubEnv("OBSERVATIONS_URL","https://worker.test/catalog-agents");
  vi.stubEnv("BUYER_OBSERVATION_ALLOWED_ORIGIN","https://worker.test");
  vi.stubEnv("BUYER_OBSERVATION_SECRET","test-secret");
  const fetcher=vi.fn(async()=>Response.json({agentId:"1",requests:[]}));
  vi.stubGlobal("fetch",fetcher);
  return fetcher;
}
it("marks only explicit background persistence requests alongside private authentication",async()=>{
  const fetcher=setup();
  await notificationStore({action:"due"},{backgroundJobs:true});
  await notificationStore({action:"read",backgroundJobs:true}); // body cannot turn on context
  const options=fetcher.mock.calls.map(call=>(call as unknown as [unknown,RequestInit])[1]);
  expect(new Headers(options[0]!.headers).get("x-marketplace-background-jobs")).toBe("1");
  expect(new Headers(options[0]!.headers).get("authorization")).toBe("Bearer test-secret");
  expect(new Headers(options[1]!.headers).has("x-marketplace-background-jobs")).toBe(false);
});
it("marks background quote verification, leaving public funding lookups unchanged",async()=>{
  const fetcher=setup();
  await resolveBuyerQuoteRequest("1",1,{backgroundJobs:true});
  await resolveBuyerQuoteRequest("1",1);
  const options=fetcher.mock.calls.map(call=>(call as unknown as [unknown,RequestInit])[1]);
  expect(new Headers(options[0]!.headers).get("x-marketplace-background-jobs")).toBe("1");
  expect(new Headers(options[1]!.headers).has("x-marketplace-background-jobs")).toBe(false);
});
