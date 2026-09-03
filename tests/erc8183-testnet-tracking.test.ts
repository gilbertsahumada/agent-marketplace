import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { DEMO_AGENT_BUYER } from "../src/business/entities/demo-agent-buyer.ts";
import type { Erc8183JobFacts } from "../src/business/entities/erc8183-browser-spike.ts";
import type { VerifiedHireEvent } from "../src/business/entities/verified-hire-event.ts";
import { Erc8183DemoJobNotFoundError, Erc8183SpikeDisabledError } from "../src/business/errors/erc8183-spike-errors.ts";
import { GetErc8183TestnetJobTracking } from "../src/business/use-cases/get-erc8183-testnet-job-tracking.ts";
import { ERC8183_TESTNET } from "../src/data/erc8183/contracts.ts";
import { GATE6A_JOB_551_MANIFEST } from "../src/data/proofs/gate6a-job-551.ts";
import type { PublicJobProofRepository } from "../src/data/proofs/public-job-proof-record.ts";
import type { Erc8183SpikeRepository } from "../src/data/repositories/erc8183-spike-repository.ts";

const BUYER = getAddress("0x1111111111111111111111111111111111111111");

function job(overrides: Partial<Erc8183JobFacts> = {}): Erc8183JobFacts {
  return {
    chainId: 97,
    jobId: "551",
    buyer: BUYER,
    provider: ERC8183_TESTNET.seller,
    evaluator: ERC8183_TESTNET.router,
    policy: ERC8183_TESTNET.policy,
    description: "signed fixture quote",
    budgetRaw: "1",
    deadline: "2000000000",
    status: "SUBMITTED",
    submittedAt: "1999999000",
    deliverableHash: GATE6A_JOB_551_MANIFEST.deliverable.hash,
    deliverableUrl: GATE6A_JOB_551_MANIFEST.deliverable.url,
    result: { content: GATE6A_JOB_551_MANIFEST.deliverable.content, contentType: "text/plain", hashVerified: true },
    quotedToken: ERC8183_TESTNET.token,
    quotedPriceRaw: "1",
    quoteExpiresAt: 2_000_000_000,
    ...overrides,
  };
}

function jobs(
  getJob: Erc8183SpikeRepository["getJob"],
  readAgentWallet?: Erc8183SpikeRepository["readAgentWallet"],
): Erc8183SpikeRepository {
  return {
    allowlist: {
      chainId: 97,
      agentId: ERC8183_TESTNET.agentId,
      maximumBudgetRaw: ERC8183_TESTNET.maximumBudgetRaw,
      networkLabel: "BSC Testnet",
      commerce: ERC8183_TESTNET.commerce,
      router: ERC8183_TESTNET.router,
      policy: ERC8183_TESTNET.policy,
      token: ERC8183_TESTNET.token,
      seller: ERC8183_TESTNET.seller,
    },
    getJob,
    requestQuote: async () => { throw new Error("unused"); },
    validateQuote: async () => { throw new Error("unused"); },
    getBuyerFacts: async () => { throw new Error("unused"); },
    notifyFunded: async () => { throw new Error("unused"); },
    ...(readAgentWallet ? { readAgentWallet } : {}),
  };
}

function proofs(snapshot = GATE6A_JOB_551_MANIFEST): PublicJobProofRepository {
  return {
    findSnapshotByJobId: async (jobId) => jobId === snapshot.jobId ? structuredClone(snapshot) : null,
    findByJobId: async () => null,
  };
}

describe("GetErc8183TestnetJobTracking", () => {
  it("returns direct-chain state with optional versioned evidence", async () => {
    const result = await new GetErc8183TestnetJobTracking(
      jobs(async () => job()),
      proofs(),
    ).execute({ jobId: "551" });
    expect(result).toMatchObject({
      liveStatus: "verified",
      job: { jobId: "551", status: "SUBMITTED" },
      snapshot: { source: "snapshot:gate6a-job-551" },
      buyerIdentity: { kind: "unknown", agentId: null, verified: false, registry: null },
    });
  });

  describe("buyer identity", () => {
    const REGISTRY = ERC8183_TESTNET.registry;

    it("labels the declared demo agent-buyer wallet without claiming an identity it has not declared", async () => {
      const result = await new GetErc8183TestnetJobTracking(
        jobs(async () => job({ buyer: DEMO_AGENT_BUYER.address }), async () => { throw new Error("must not read"); }),
        proofs(),
        undefined,
        { address: DEMO_AGENT_BUYER.address, agentId: null },
      ).execute({ jobId: "551" });
      expect(result.buyerIdentity).toEqual({ kind: "demo_agent", agentId: null, verified: false, registry: null });
    });

    it("verifies a declared agent id against the registry wallet or owner read from chain", async () => {
      const reads: bigint[] = [];
      const tracker = (agentWallet: string, owner: string) => new GetErc8183TestnetJobTracking(
        jobs(async () => job({ buyer: DEMO_AGENT_BUYER.address }), async (agentId) => {
          reads.push(agentId);
          return { registry: REGISTRY, agentWallet: getAddress(agentWallet), owner: getAddress(owner) };
        }),
        proofs(),
        undefined,
        { address: DEMO_AGENT_BUYER.address, agentId: 7 },
      );
      const byWallet = await tracker(DEMO_AGENT_BUYER.address, "0x3333333333333333333333333333333333333333").execute({ jobId: "551" });
      expect(byWallet.buyerIdentity).toEqual({ kind: "demo_agent", agentId: "7", verified: true, registry: REGISTRY });
      const byOwner = await tracker("0x3333333333333333333333333333333333333333", DEMO_AGENT_BUYER.address.toLowerCase()).execute({ jobId: "551" });
      expect(byOwner.buyerIdentity.verified).toBe(true);
      const mismatch = await tracker("0x3333333333333333333333333333333333333333", "0x4444444444444444444444444444444444444444").execute({ jobId: "551" });
      expect(mismatch.buyerIdentity).toEqual({ kind: "demo_agent", agentId: "7", verified: false, registry: REGISTRY });
      expect(reads).toEqual([7n, 7n, 7n]);
    });

    it("never fails the page on a registry read error and never verifies without a chain read", async () => {
      const failing = await new GetErc8183TestnetJobTracking(
        jobs(async () => job({ buyer: DEMO_AGENT_BUYER.address }), async () => { throw new Error("rpc down"); }),
        proofs(),
        undefined,
        { address: DEMO_AGENT_BUYER.address, agentId: 7 },
      ).execute({ jobId: "551" });
      expect(failing.buyerIdentity).toEqual({ kind: "demo_agent", agentId: "7", verified: false, registry: null });
      const noReader = await new GetErc8183TestnetJobTracking(
        jobs(async () => job({ buyer: DEMO_AGENT_BUYER.address })),
        proofs(),
        undefined,
        { address: DEMO_AGENT_BUYER.address, agentId: 7 },
      ).execute({ jobId: "551" });
      expect(noReader.buyerIdentity).toEqual({ kind: "demo_agent", agentId: "7", verified: false, registry: null });
    });

    it("resolves the buyer from the snapshot when the live read is unavailable", async () => {
      const result = await new GetErc8183TestnetJobTracking(
        jobs(async () => { throw new Erc8183SpikeDisabledError(); }),
        proofs(),
        undefined,
        { address: GATE6A_JOB_551_MANIFEST.buyer, agentId: null },
      ).execute({ jobId: "551" });
      expect(result).toMatchObject({ liveStatus: "unavailable", buyerIdentity: { kind: "demo_agent", verified: false } });
    });
  });

  it("rejects a job belonging to another seller", async () => {
    const useCase = new GetErc8183TestnetJobTracking(
      jobs(async () => job({ provider: getAddress("0x2222222222222222222222222222222222222222") })),
      proofs(),
    );
    await expect(useCase.execute({ jobId: "551" })).rejects.toBeInstanceOf(Erc8183DemoJobNotFoundError);
  });

  it("keeps the versioned proof available when live Testnet reads are disabled", async () => {
    const useCase = new GetErc8183TestnetJobTracking(
      jobs(async () => { throw new Erc8183SpikeDisabledError(); }),
      proofs(),
    );
    await expect(useCase.execute({ jobId: "551" })).resolves.toMatchObject({
      liveStatus: "unavailable",
      job: null,
      snapshot: { jobId: "551" },
    });
  });

  it("does not invent a fallback for an unversioned job", async () => {
    const useCase = new GetErc8183TestnetJobTracking(
      jobs(async () => { throw new Erc8183SpikeDisabledError(); }),
      proofs(),
    );
    await expect(useCase.execute({ jobId: "552" })).rejects.toBeInstanceOf(Erc8183SpikeDisabledError);
  });

  it("attaches only this job's chain-verified phases for the allowlisted seller agent", async () => {
    const requests: Array<{ chainId: number; agentId: string }> = [];
    const event = (jobId: string, phase: VerifiedHireEvent["phase"]): VerifiedHireEvent => ({
      chainId: 97, agentId: "1866", phase, jobId, txHash: `0x${"ab".repeat(32)}`,
      blockNumber: "70000000", occurredAt: "2026-09-01T12:00:00.000Z", verifiedAt: null,
    });
    const result = await new GetErc8183TestnetJobTracking(jobs(async () => job()), proofs(), {
      listByAgent: async (input) => {
        requests.push(input);
        return [event("551", "funded"), event("552", "created"), event("551", "created")];
      },
    }).execute({ jobId: "551" });
    expect(requests).toEqual([{ chainId: 97, agentId: String(ERC8183_TESTNET.agentId) }]);
    expect(result.verifiedPhases.map(({ jobId, phase }) => `${jobId}:${phase}`)).toEqual(["551:funded", "551:created"]);
  });

  it("renders without verified phases when the feed is absent, null or failing", async () => {
    const absent = await new GetErc8183TestnetJobTracking(jobs(async () => job()), proofs()).execute({ jobId: "551" });
    expect(absent.verifiedPhases).toEqual([]);
    const missing = await new GetErc8183TestnetJobTracking(jobs(async () => job()), proofs(), {
      listByAgent: async () => null,
    }).execute({ jobId: "551" });
    expect(missing.verifiedPhases).toEqual([]);
    const failing = await new GetErc8183TestnetJobTracking(
      jobs(async () => { throw new Erc8183SpikeDisabledError(); }),
      proofs(),
      { listByAgent: async () => { throw new Error("feed down"); } },
    ).execute({ jobId: "551" });
    expect(failing).toMatchObject({ liveStatus: "unavailable", verifiedPhases: [] });
  });
});
