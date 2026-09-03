import { describe, expect, it, vi } from "vitest";
import type { MarketplaceAgent } from "../src/business/entities/marketplace-agent.ts";
import type { HireLedger } from "../src/business/entities/hire-job.ts";
import { ListAgentHireJobs, providerWallet } from "../src/business/use-cases/list-agent-hire-jobs.ts";

const WALLET = "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5";
const OWNER = "0x1111111111111111111111111111111111111111";
const ZERO = "0x0000000000000000000000000000000000000000";

function agent(identity: { agentWallet: string | null; owner: string | null }, owner: string | null = null): MarketplaceAgent {
  return {
    agentId: "303779",
    owner,
    onchainIdentity: { ...identity },
  } as unknown as MarketplaceAgent;
}

function ledger(overrides: Partial<HireLedger> = {}): HireLedger {
  const page = { chainId: 56 as const, jobs: [{ jobId: "56696" }], nextBefore: null };
  return {
    listRecentJobs: vi.fn(),
    listJobsByBuyer: vi.fn(),
    listJobsByProvider: vi.fn(async () => page),
    listJobsByAgent: vi.fn(async () => page),
    getJob: vi.fn(),
    summary: vi.fn(),
    ...overrides,
  } as unknown as HireLedger;
}

describe("ListAgentHireJobs", () => {
  it("prefers the registry wallet, then the registry owner, then the indexed owner", () => {
    expect(providerWallet(agent({ agentWallet: WALLET, owner: OWNER }))).toBe(WALLET);
    expect(providerWallet(agent({ agentWallet: ZERO, owner: OWNER }))).toBe(OWNER);
    expect(providerWallet(agent({ agentWallet: null, owner: null }, OWNER))).toBe(OWNER);
    expect(providerWallet(agent({ agentWallet: null, owner: "not-an-address" }))).toBeNull();
  });

  it("lists jobs by provider wallet when known and by verified hire events otherwise", async () => {
    const known = ledger();
    await expect(new ListAgentHireJobs(known).execute({ agent: agent({ agentWallet: WALLET, owner: OWNER }) }))
      .resolves.toEqual([{ jobId: "56696" }]);
    expect(known.listJobsByProvider).toHaveBeenCalledWith({ chainId: 56, provider: WALLET });
    expect(known.listJobsByAgent).not.toHaveBeenCalled();

    const unknown = ledger();
    await new ListAgentHireJobs(unknown).execute({ agent: agent({ agentWallet: null, owner: null }) });
    expect(unknown.listJobsByAgent).toHaveBeenCalledWith({ chainId: 56, agentId: "303779" });
    expect(unknown.listJobsByProvider).not.toHaveBeenCalled();
  });

  it("returns an empty list when the ledger is unavailable or throws", async () => {
    await expect(new ListAgentHireJobs(ledger({ listJobsByProvider: async () => null })).execute({ agent: agent({ agentWallet: WALLET, owner: null }) }))
      .resolves.toEqual([]);
    await expect(new ListAgentHireJobs(ledger({ listJobsByProvider: async () => { throw new Error("offline"); } })).execute({ agent: agent({ agentWallet: WALLET, owner: null }) }))
      .resolves.toEqual([]);
  });
});
