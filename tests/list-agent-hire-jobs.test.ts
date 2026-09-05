import { describe, expect, it, vi } from "vitest";
import type { MarketplaceAgent } from "../src/business/entities/marketplace-agent.ts";
import type { HireActivity, HireLedger } from "../src/business/entities/hire-job.ts";
import { ListAgentHireJobs, providerWallet } from "../src/business/use-cases/list-agent-hire-jobs.ts";

const WALLET = "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5";
const OWNER = "0x1111111111111111111111111111111111111111";
const ZERO = "0x0000000000000000000000000000000000000000";

function agent(identity: { agentWallet: string | null; owner: string | null }, owner: string | null = null): MarketplaceAgent {
  return {
    chainId: 56,
    agentId: "303779",
    owner,
    onchainIdentity: { ...identity },
  } as unknown as MarketplaceAgent;
}

const ACTIVITY: HireActivity = {
  chainId: 56,
  days: 30,
  from: "2026-08-04T12:00:00.000Z",
  to: "2026-09-03T12:00:00.000Z",
  byDay: [{ day: "2026-09-01", created: 1, funded: 1, submitted: 0, settled: 0, refunded: 0 }],
  totals: { created: 1, funded: 1, submitted: 0, settled: 0, refunded: 0 },
};

function ledger(overrides: Partial<HireLedger> = {}): HireLedger {
  const page = { chainId: 56 as const, jobs: [{ jobId: "56696" }], nextBefore: null };
  return {
    listRecentJobs: vi.fn(),
    listJobsByBuyer: vi.fn(),
    listJobsByProvider: vi.fn(async () => page),
    listJobsByAgent: vi.fn(async () => page),
    getJob: vi.fn(),
    summary: vi.fn(),
    activity: vi.fn(async () => ACTIVITY),
    ...overrides,
  } as unknown as HireLedger;
}

describe("ListAgentHireJobs", () => {
  it("uses only the registry agent wallet as the ERC-8183 provider", () => {
    expect(providerWallet(agent({ agentWallet: WALLET, owner: OWNER }))).toBe(WALLET);
    expect(providerWallet(agent({ agentWallet: ZERO, owner: OWNER }))).toBeNull();
    expect(providerWallet(agent({ agentWallet: null, owner: null }, OWNER))).toBeNull();
    expect(providerWallet(agent({ agentWallet: null, owner: "not-an-address" }))).toBeNull();
  });

  it("lists jobs by provider wallet when known and by verified hire events otherwise, naming the scope", async () => {
    const known = ledger();
    await expect(new ListAgentHireJobs(known).execute({ agent: agent({ agentWallet: WALLET, owner: OWNER }) }))
      .resolves.toEqual({ jobs: [{ jobId: "56696" }], nextBefore: null, scope: "wallet", activity: ACTIVITY });
    expect(known.listJobsByProvider).toHaveBeenCalledWith({ chainId: 56, provider: WALLET });
    expect(known.listJobsByAgent).not.toHaveBeenCalled();
    // The default window is the Worker's own default: no explicit days, so the
    // cached read is the same one the /jobs page makes.
    expect(known.activity).toHaveBeenCalledWith({ chainId: 56, provider: WALLET });

    const unknown = ledger();
    await expect(new ListAgentHireJobs(unknown).execute({ agent: agent({ agentWallet: null, owner: null }) }))
      .resolves.toEqual({ jobs: [{ jobId: "56696" }], nextBefore: null, scope: "agent", activity: ACTIVITY });
    expect(unknown.listJobsByAgent).toHaveBeenCalledWith({ chainId: 56, agentId: "303779" });
    expect(unknown.listJobsByProvider).not.toHaveBeenCalled();
    expect(unknown.activity).toHaveBeenCalledWith({ chainId: 56, agentId: "303779" });
  });

  // The jobs list is the required read; the activity window is optional and
  // must never be started ahead of it.
  it("starts the required jobs read before the optional activity read", async () => {
    const known = ledger();
    await new ListAgentHireJobs(known).execute({ agent: agent({ agentWallet: WALLET, owner: null }) });
    const jobsOrder = vi.mocked(known.listJobsByProvider).mock.invocationCallOrder[0]!;
    const activityOrder = vi.mocked(known.activity).mock.invocationCallOrder[0]!;
    expect(jobsOrder).toBeLessThan(activityOrder);

    const unknown = ledger();
    await new ListAgentHireJobs(unknown).execute({ agent: agent({ agentWallet: null, owner: null }) });
    expect(vi.mocked(unknown.listJobsByAgent).mock.invocationCallOrder[0]!)
      .toBeLessThan(vi.mocked(unknown.activity).mock.invocationCallOrder[0]!);
  });

  it("keeps an empty ledger page apart from an unavailable ledger and passes the cursor through", async () => {
    const empty = ledger({ listJobsByProvider: async () => ({ chainId: 56, jobs: [], nextBefore: null }) });
    await expect(new ListAgentHireJobs(empty).execute({ agent: agent({ agentWallet: WALLET, owner: null }) }))
      .resolves.toEqual({ jobs: [], nextBefore: null, scope: "wallet", activity: ACTIVITY });

    const more = ledger({ listJobsByProvider: async () => ({ chainId: 56, jobs: [], nextBefore: "56600" }) });
    await expect(new ListAgentHireJobs(more).execute({ agent: agent({ agentWallet: WALLET, owner: null }) }))
      .resolves.toMatchObject({ nextBefore: "56600" });

    await expect(new ListAgentHireJobs(ledger({ listJobsByProvider: async () => null })).execute({ agent: agent({ agentWallet: WALLET, owner: null }) }))
      .resolves.toBeNull();
    await expect(new ListAgentHireJobs(ledger({ listJobsByProvider: async () => { throw new Error("offline"); } })).execute({ agent: agent({ agentWallet: WALLET, owner: null }) }))
      .resolves.toBeNull();
  });

  // The activity window is a decoration on the jobs list: when it cannot be
  // read the jobs still render, and it never turns an available ledger into
  // an unavailable one.
  it("keeps the jobs when the activity window is unavailable or throws", async () => {
    const missing = ledger({ activity: vi.fn(async () => null) });
    await expect(new ListAgentHireJobs(missing).execute({ agent: agent({ agentWallet: WALLET, owner: null }) }))
      .resolves.toEqual({ jobs: [{ jobId: "56696" }], nextBefore: null, scope: "wallet", activity: null });

    const failing = ledger({ activity: vi.fn(async () => { throw new Error("offline"); }) });
    await expect(new ListAgentHireJobs(failing).execute({ agent: agent({ agentWallet: null, owner: null }) }))
      .resolves.toEqual({ jobs: [{ jobId: "56696" }], nextBefore: null, scope: "agent", activity: null });
  });

  it("still answers null for an unavailable jobs list even when the activity window reads fine", async () => {
    const jobsDown = ledger({ listJobsByProvider: vi.fn(async () => null) });
    await expect(new ListAgentHireJobs(jobsDown).execute({ agent: agent({ agentWallet: WALLET, owner: null }) }))
      .resolves.toBeNull();
  });
});
