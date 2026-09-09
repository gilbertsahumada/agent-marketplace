import { it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({list:vi.fn(), detail:vi.fn()}));
vi.mock("@/src/business/composition", () => ({getCatalogCandidatePage:mocks.list,getCatalogCandidate:mocks.detail}));
vi.mock("next/navigation", () => ({notFound:()=>{throw Error("NOT_FOUND");}}));
vi.mock("@/components/marketplace/catalog-candidate-view-model", () => ({catalogCandidateCard:(value:unknown)=>value}));
import CompareRoute from "../app/compare/page";
beforeEach(()=>{vi.clearAllMocks();mocks.list.mockResolvedValue({items:[],total:0});mocks.detail.mockResolvedValue(null);});
it("reads the current catalog with network, search and pagination", async()=>{
  await CompareRoute({searchParams:Promise.resolve({network:"testnet",q:"grid",page:"2",agentId:["2197","2198"]})});
  expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({chainId:97,page:2,limit:24,q:"grid",inventory:"registry"}));
  expect(mocks.detail).toHaveBeenCalledWith({chainId:97,agentId:"2197"});
});
it.each([{network:"other"},{agentId:["1","1"]},{agentId:["1","2","3","4"]},{agentId:"bad"}])("rejects invalid compare inputs %j",async params=>{
  await expect(CompareRoute({searchParams:Promise.resolve(params)})).rejects.toThrow("NOT_FOUND");
  expect(mocks.list).not.toHaveBeenCalled();
});
