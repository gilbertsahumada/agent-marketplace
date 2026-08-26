import { DeliverableManifest } from "@bnbagent/sdk/erc8183";
import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { buildGridPlan, gridTaskDescription, parseGridTaskDescription } from "../src/business/policies/grid-plan-policy.ts";
import { ERC1967_IMPLEMENTATION_SLOT, ERC8183_MAINNET } from "../src/mainnet/contracts.ts";
import { MainnetGridSellerRepository, mainnetGridNetwork } from "../src/mainnet/grid-seller-repository.ts";
import { mainnetImplementationPinsMatch } from "../src/mainnet/implementation-pins.ts";
import { areMainnetWritesEnabled } from "../src/mainnet/mainnet-write-gate.ts";

const SELLER = getAddress("0x1111111111111111111111111111111111111111");

function implementationStorage(address: string): `0x${string}` {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function publicClient(balance = 2_000_000_000_000_000n) {
  return {
    getBalance: vi.fn(async () => balance),
    getBlock: vi.fn(async () => ({ timestamp: BigInt(Math.floor(Date.now() / 1_000)) })),
    getBlockNumber: vi.fn(async () => 123n),
    getStorageAt: vi.fn(async ({ address, slot }: { address: string; slot: string; blockNumber: bigint }) => {
      expect(slot).toBe(ERC1967_IMPLEMENTATION_SLOT);
      return implementationStorage(address.toLowerCase() === ERC8183_MAINNET.commerce.toLowerCase()
        ? ERC8183_MAINNET.commerceImplementation
        : ERC8183_MAINNET.routerImplementation);
    }),
  };
}

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

function terminalDeliverable(jobId: number, jobDescription: string) {
  const parsed = JSON.parse(jobDescription) as { task: string };
  const plan = buildGridPlan(parseGridTaskDescription(parsed.task));
  return new DeliverableManifest({
    version: 1,
    jobId,
    chainId: 56,
    contracts: {
      commerce: ERC8183_MAINNET.commerce,
      router: ERC8183_MAINNET.router,
      policy: ERC8183_MAINNET.policy,
    },
    response: { content: JSON.stringify(plan), contentType: "application/json" },
    metadata: { sellerType: "marketplace-operated-grid-seller", execution: "none" },
  }).manifestHash();
}

describe("Mainnet Grid seller security", () => {
  it("uses the fixed RPC that can verify the bounded JobFunded quote window", () => {
    const network = mainnetGridNetwork();
    expect(network).toMatchObject({
      chainId: 56,
      rpcUrl: "https://bsc-rpc.publicnode.com",
      commerceContract: ERC8183_MAINNET.commerce.toLowerCase(),
      routerContract: ERC8183_MAINNET.router.toLowerCase(),
      policyContract: ERC8183_MAINNET.policy.toLowerCase(),
    });
  });

  it("keeps Mainnet writes disabled by default and requires the exact explicit flag", () => {
    expect(areMainnetWritesEnabled({})).toBe(false);
    expect(areMainnetWritesEnabled({ ERC8183_MAINNET_SELLER_ENABLED: "true" })).toBe(false);
    expect(areMainnetWritesEnabled({ ERC8183_MAINNET_DEMO_ENABLED: "true" })).toBe(false);
    expect(areMainnetWritesEnabled({ ERC8183_MAINNET_WRITES_ENABLED: "TRUE" })).toBe(false);
    expect(areMainnetWritesEnabled({ ERC8183_MAINNET_WRITES_ENABLED: "true" })).toBe(true);
  });

  it("re-pins both ERC-1967 implementations at one block", async () => {
    const matching = publicClient();
    await expect(mainnetImplementationPinsMatch(matching)).resolves.toBe(true);
    expect(matching.getStorageAt).toHaveBeenCalledTimes(2);
    expect(matching.getStorageAt.mock.calls.every(([request]) => request.blockNumber === 123n)).toBe(true);

    const changed = publicClient();
    changed.getStorageAt.mockResolvedValue(implementationStorage(SELLER));
    await expect(mainnetImplementationPinsMatch(changed)).resolves.toBe(false);

    const temporal = publicClient();
    temporal.getStorageAt.mockImplementation(async ({ address, blockNumber }) =>
      implementationStorage(blockNumber === 122n
        ? SELLER
        : address.toLowerCase() === ERC8183_MAINNET.commerce.toLowerCase()
          ? ERC8183_MAINNET.commerceImplementation
          : ERC8183_MAINNET.routerImplementation));
    await expect(mainnetImplementationPinsMatch(temporal)).resolves.toBe(true);
    await expect(mainnetImplementationPinsMatch(temporal, 122n)).resolves.toBe(false);
  });

  it("rejects a funded job when the SDK signed-quote verifier rejects it", async () => {
    const verifyJob = vi.fn(async () => ({ valid: false, error_code: "quote_invalid" }));
    const getJob = vi.fn(async () => fundedJob());
    const repository = new MainnetGridSellerRepository(async () => ({
      seller: SELLER,
      origin: "https://bnb-agent-marketplace-ruby.vercel.app",
      jobOps: { verifyJob },
      client: { getJob },
    }) as never, () => true);

    await expect(repository.handleMessage({ skill: "notify_funded", jobId: 91 }))
      .rejects.toThrow(/signed-quote verification/);
    expect(verifyJob).toHaveBeenCalledWith(91);
    expect(getJob).toHaveBeenCalledOnce();
  });

  it("acknowledges a repeated notification only from the terminal onchain state", async () => {
    const verifyJob = vi.fn();
    const base = fundedJob();
    const getJob = vi.fn(async () => ({ ...base, deliverable: terminalDeliverable(95, base.description), status: 2 }));
    const repository = new MainnetGridSellerRepository(async () => ({
      seller: SELLER,
      origin: "https://bnb-agent-marketplace-ruby.vercel.app",
      jobOps: { verifyJob },
      client: { getJob, router: { jobPolicy: vi.fn(async () => ERC8183_MAINNET.policy) } },
    }) as never, () => true);

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
        publicClient: publicClient(),
      },
    }) as never, () => true);

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
        publicClient: publicClient(balance),
      },
    }) as never, () => true);

    const now = Math.floor(Date.now() / 1_000);
    await expect(createRepository(fundedJob(undefined, BigInt(now + 604_800)), 2_000_000_000_000_000n)
      .handleMessage({ skill: "notify_funded", jobId: 93 }))
      .rejects.toThrow(/ten minutes/);
    await expect(createRepository(fundedJob(), 1_999_999_999_999_999n)
      .handleMessage({ skill: "notify_funded", jobId: 94 }))
      .rejects.toThrow(/gas reserve/);
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects a terminal repeat whose deterministic deliverable or policy does not bind", async () => {
    const base = fundedJob(`0x${"44".repeat(32)}`);
    const repository = new MainnetGridSellerRepository(async () => ({
      seller: SELLER,
      origin: "https://bnb-agent-marketplace-ruby.vercel.app",
      jobOps: { verifyJob: vi.fn() },
      client: {
        getJob: vi.fn(async () => ({ ...base, status: 2 })),
        router: { jobPolicy: vi.fn(async () => ERC8183_MAINNET.policy) },
      },
    }) as never, () => true);
    await expect(repository.handleMessage({ skill: "notify_funded", jobId: 96 }))
      .rejects.toThrow(/deterministic result/);
  });

  it("keeps negotiation available but blocks submit while Mainnet writes are disabled", async () => {
    const negotiate = vi.fn(async () => ({ toDict: () => ({ accepted: true }) }));
    const submit = vi.fn();
    const repository = new MainnetGridSellerRepository(async () => ({
      seller: SELLER,
      origin: "https://bnb-agent-marketplace-ruby.vercel.app",
      negotiation: { negotiate },
      jobOps: { verifyJob: vi.fn(async () => ({ valid: true })) },
      client: {
        getJob: vi.fn(async () => fundedJob()),
        submit,
      },
    }) as never, () => false);

    await expect(repository.handleMessage({
      skill: "negotiate-erc8183-job",
      taskDescription: gridTaskDescription({
        pair: "BNB/USDT",
        lowerPrice: "700",
        upperPrice: "900",
        capital: "1000",
        gridCount: 9,
      }),
      terms: {
        deliverables: "Deterministic Grid plan JSON with levels, allocation, triggers and assumptions",
        quality_standards: "Deterministic output, no order execution and no custody",
      },
    })).resolves.toMatchObject({ accepted: true, provider_address: SELLER });
    await expect(repository.handleMessage({ skill: "notify_funded", jobId: 97 }))
      .rejects.toThrow(/writes are disabled/);
    expect(negotiate).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it("rechecks the write gate at the final submit boundary", async () => {
    const submit = vi.fn();
    const writesEnabled = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const repository = new MainnetGridSellerRepository(async () => ({
      seller: SELLER,
      origin: "https://bnb-agent-marketplace-ruby.vercel.app",
      negotiation: {},
      jobOps: { verifyJob: vi.fn(async () => ({ valid: true })) },
      client: {
        getJob: vi.fn(async () => fundedJob()),
        submit,
        router: { jobPolicy: vi.fn(async () => ERC8183_MAINNET.policy) },
        policy: { disputeWindow: vi.fn(async () => 604_800n) },
        publicClient: publicClient(),
      },
    }) as never, writesEnabled);

    await expect(repository.handleMessage({ skill: "notify_funded", jobId: 98 }))
      .rejects.toThrow(/writes are disabled/);
    expect(writesEnabled).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
  });
});
