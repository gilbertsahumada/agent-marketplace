import { describe, expect, it, vi } from "vitest";
import { ResolveJobAgents } from "../src/business/use-cases/resolve-job-agents.ts";
import { IDENTITY_REGISTRIES, IDENTITY_FRESHNESS_MS, providerIdentity, type IndexedAgentIdentity, type JobAgentEvidence } from "../shared/agent-identity.ts";

const NOW = 1_800_000_000_000;
const WALLET = `0x${"ab".repeat(20)}` as const;
const job = { chainId: 56 as const, jobId: "1", provider: WALLET };
const candidate = (id = "7", observedAt = NOW): IndexedAgentIdentity => ({ chainId: 56, registryAddress: IDENTITY_REGISTRIES[56],
  agentId: id, name: "Agent Seven", profileAvailable: true, wallet: WALLET, source: "agentWallet", blockNumber: "42", observedAt });
const evidence = (overrides: Partial<JobAgentEvidence> = {}): JobAgentEvidence => ({ jobId: "1", provider: WALLET,
  registered: [], candidates: [], candidatesTruncated: false, ...overrides });
async function resolve(entry: JobAgentEvidence) {
  const readForJobs = vi.fn().mockResolvedValue({ chainId: 56, coverage: "partial", jobs: [entry] });
  const result = await new ResolveJobAgents({ readForJobs }, () => NOW).execute([job]);
  return result["56:1"]!;
}
describe("ResolveJobAgents", () => {
  it("matches wallets without claiming historical proof", async () => {
    expect((await resolve(evidence({ candidates: [candidate()] }))).status).toBe("wallet_match");
  });
  it("prefers registered association and deduplicates phases", async () => {
    const recorded = { agent: candidate(), verifiedAt: NOW, txHash: `0x${"ab".repeat(32)}` };
    const result = await resolve(evidence({ registered: [recorded, recorded], candidates: [candidate("8")] }));
    expect(result.status).toBe("registered"); expect(result.agents.map(a => a.agentId)).toEqual(["7"]);
  });
  it("does not guess among shared wallets, including truncated results", async () => {
    expect((await resolve(evidence({ candidates: [candidate(), candidate("8")] }))).status).toBe("ambiguous");
    expect((await resolve(evidence({ candidates: [candidate()], candidatesTruncated: true }))).status).toBe("ambiguous");
  });
  it("keeps stale/future evidence distinct from current matches", async () => {
    expect((await resolve(evidence({ candidates: [candidate("7", NOW - IDENTITY_FRESHNESS_MS - 1)] }))).status).toBe("stale");
    expect((await resolve(evidence({ candidates: [candidate("7", NOW + 1)] }))).status).toBe("stale");
  });
  it("keeps not found distinct from unavailable and rejects provider mismatches", async () => {
    expect((await resolve(evidence())).status).toBe("unmatched");
    expect((await resolve(evidence({ provider: `0x${"cd".repeat(20)}` }))).status).toBe("unavailable");
    const result = await new ResolveJobAgents({ readForJobs: vi.fn().mockRejectedValue(new Error("offline")) }).execute([job]);
    expect(result["56:1"]?.status).toBe("unavailable");
  });
  it("isolates chain/registry and batches 25 at a time", async () => {
    expect((await resolve(evidence({ candidates: [{ ...candidate(), chainId: 97 }] }))).agents).toEqual([]);
    expect((await resolve(evidence({ candidates: [{ ...candidate(), registryAddress: WALLET }] }))).agents).toEqual([]);
    const readForJobs = vi.fn().mockImplementation(async ({ chainId }) => ({ chainId, jobs: [] }));
    const jobs = Array.from({ length: 26 }, (_, index) => ({ ...job, jobId: String(index) }));
    const result = await new ResolveJobAgents({ readForJobs }).execute([...jobs, { ...job, chainId: 97 }]);
    expect(readForJobs.mock.calls.map(([input]) => input.jobIds.length)).toEqual([25, 1, 1]);
    expect(result["56:1"]).toBeDefined(); expect(result["97:1"]).toBeDefined();
  });
  it("never silently substitutes owner for agentWallet", () => {
    expect(providerIdentity({ agentWallet: null, owner: WALLET })).toBeNull();
    expect(providerIdentity({ agentWallet: null, owner: WALLET, allowOwnerFallback: true })).toEqual({ wallet: WALLET, source: "ownerOf" });
  });
});
