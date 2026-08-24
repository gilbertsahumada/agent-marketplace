import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { gridTaskDescription } from "../src/business/policies/grid-plan-policy.js";
import { ERC8183_MAINNET } from "../src/mainnet/contracts.js";
import { MainnetGridSellerRepository } from "../src/mainnet/grid-seller-repository.js";

const SELLER = getAddress("0x1111111111111111111111111111111111111111");

function description(now = Math.floor(Date.now() / 1_000)): string {
  return JSON.stringify({
    version: 1,
    negotiated_at: now,
    task: gridTaskDescription({
      pair: "BNB/USDT",
      lowerPrice: "700",
      upperPrice: "900",
      capital: "1000",
      gridCount: 9,
    }),
    terms: {},
    price: ERC8183_MAINNET.maximumDemoBudgetRaw.toString(),
    currency: ERC8183_MAINNET.token,
    quote_expires_at: now + 900,
    negotiation_hash: `0x${"11".repeat(32)}`,
    provider_sig: `0x${"22".repeat(65)}`,
  });
}

function fundedJob(
  deliverable = `0x${"0".repeat(64)}`,
  expiredAt = BigInt(Math.floor(Date.now() / 1_000) + 604_800 + 3_600),
) {
  return {
    status: 1,
    provider: SELLER,
    evaluator: ERC8183_MAINNET.router,
    hook: ERC8183_MAINNET.router,
    budget: ERC8183_MAINNET.maximumDemoBudgetRaw,
    expiredAt,
    description: description(),
    deliverable,
  };
}

describe("Mainnet Grid seller security", () => {
  it("rejects a funded job when the SDK signed-quote verifier rejects it", async () => {
    const verifyJob = vi.fn(async () => ({ valid: false, error_code: "quote_invalid" }));
    const getJob = vi.fn(async () => fundedJob());
    const repository = new MainnetGridSellerRepository(async () => ({
      seller: SELLER,
      origin: "https://bnb-agent-marketplace-ruby.vercel.app",
      jobOps: { verifyJob },
      client: { getJob },
    }) as never);

    await expect(repository.handleMessage({ skill: "notify_funded", jobId: 91 }))
      .rejects.toThrow(/signed-quote verification/);
    expect(verifyJob).toHaveBeenCalledWith(91);
    expect(getJob).toHaveBeenCalledOnce();
  });

  it("acknowledges a repeated notification only from the terminal onchain state", async () => {
    const verifyJob = vi.fn();
    const getJob = vi.fn(async () => ({ ...fundedJob(`0x${"44".repeat(32)}`), status: 2 }));
    const repository = new MainnetGridSellerRepository(async () => ({
      seller: SELLER,
      origin: "https://bnb-agent-marketplace-ruby.vercel.app",
      jobOps: { verifyJob },
      client: { getJob },
    }) as never);

    await expect(repository.handleMessage({ skill: "notify_funded", jobId: 95 }))
      .resolves.toEqual({ acknowledged: true, already_submitted: true, job_id: 95 });
    expect(getJob).toHaveBeenCalledOnce();
    expect(verifyJob).not.toHaveBeenCalled();
  });

  it("reconciles a concurrent submit failure against confirmed chain state", async () => {
    let submittedHash = `0x${"0".repeat(64)}`;
    let reads = 0;
    const getJob = vi.fn(async () => {
      reads += 1;
      return reads <= 2
        ? fundedJob()
        : { ...fundedJob(submittedHash), status: 2 };
    });
    const submit = vi.fn(async (_jobId: bigint, hash: `0x${string}`) => {
      submittedHash = hash;
      throw new Error("another instance submitted first");
    });
    const repository = new MainnetGridSellerRepository(async () => ({
      seller: SELLER,
      origin: "https://bnb-agent-marketplace-ruby.vercel.app",
      negotiation: {},
      jobOps: { verifyJob: vi.fn(async () => ({ valid: true })) },
      client: {
        getJob,
        submit,
        router: { jobPolicy: vi.fn(async () => ERC8183_MAINNET.policy) },
        policy: { disputeWindow: vi.fn(async () => 604_800n) },
        publicClient: { getBalance: vi.fn(async () => 2_000_000_000_000_000n) },
      },
    }) as never);

    await expect(repository.handleMessage({ skill: "notify_funded", jobId: 92 }))
      .resolves.toMatchObject({ acknowledged: true, already_submitted: true, job_id: 92 });
    expect(submit).toHaveBeenCalledOnce();
    expect(getJob).toHaveBeenCalledTimes(3);
  });

  it("refuses signing after the submit deadline or below the gas reserve", async () => {
    const submit = vi.fn();
    const createRepository = (job: ReturnType<typeof fundedJob>, balance: bigint) => new MainnetGridSellerRepository(async () => ({
      seller: SELLER,
      origin: "https://bnb-agent-marketplace-ruby.vercel.app",
      negotiation: {},
      jobOps: { verifyJob: vi.fn(async () => ({ valid: true })) },
      client: {
        getJob: vi.fn(async () => job),
        submit,
        router: { jobPolicy: vi.fn(async () => ERC8183_MAINNET.policy) },
        policy: { disputeWindow: vi.fn(async () => 604_800n) },
        publicClient: { getBalance: vi.fn(async () => balance) },
      },
    }) as never);

    const now = Math.floor(Date.now() / 1_000);
    await expect(createRepository(fundedJob(undefined, BigInt(now + 604_800)), 2_000_000_000_000_000n)
      .handleMessage({ skill: "notify_funded", jobId: 93 }))
      .rejects.toThrow(/outside the Mainnet allowlist/);
    await expect(createRepository(fundedJob(), 1_999_999_999_999_999n)
      .handleMessage({ skill: "notify_funded", jobId: 94 }))
      .rejects.toThrow(/gas reserve/);
    expect(submit).not.toHaveBeenCalled();
  });
});
