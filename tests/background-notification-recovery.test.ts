import {afterEach,expect,it,vi} from "vitest";
vi.mock("../src/data/observation/hire-notification-store",()=>({notificationStore:vi.fn(async()=>({agentId:"1",quoteRequestId:1,leaseToken:"lease"}))}));
vi.mock("../src/mainnet/catalog-hire",()=>({resolveCatalogHireTarget:vi.fn(async()=>({negotiationHash:"hash"}))}));
vi.mock("../src/business/policies/job-quote-binding",()=>({assertJobQuoteBinding:vi.fn()}));
vi.mock("../src/mainnet/catalog-erc8183-repository",()=>({CatalogErc8183Repository:class {getJob=async()=>({status:"EXPIRED",deadline:"0"});}}));
vi.mock("../src/business/use-cases/recover-hire-notification",()=>({recoverHireNotification:vi.fn(async (ports:{claim:()=>Promise<unknown>;prepare:(row:unknown)=>Promise<unknown>;sending:(row:unknown)=>Promise<unknown>;finish:(row:unknown,state:string)=>Promise<unknown>})=>{
  const row=await ports.claim();await ports.prepare(row);await ports.sending(row);await ports.finish(row,"delivered");
})}));
import {processHireNotification} from "../src/mainnet/hire-notification-recovery";
import {notificationStore} from "../src/data/observation/hire-notification-store";
import {resolveCatalogHireTarget} from "../src/mainnet/catalog-hire";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it("retains background context through claim, quote lookup, sending and finish",async()=>{
  vi.stubEnv("HIRE_NOTIFICATION_RECOVERY_ENABLED","1");
  vi.stubEnv("ERC8183_TESTNET_HIRE_ENABLED","true");
  await processHireNotification(97,"1",{backgroundJobs:true});
  expect(vi.mocked(notificationStore).mock.calls.map(call=>[call[0].action,call[1]])).toEqual([
    ["claim",{backgroundJobs:true}],["sending",{backgroundJobs:true}],["finish",{backgroundJobs:true}],
  ]);
  expect(resolveCatalogHireTarget).toHaveBeenCalledWith("1",1,{chainId:97,allowExpired:true,backgroundJobs:true});
});
