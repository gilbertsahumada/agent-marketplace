import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import type {
  Erc8183BuyerFacts,
  Erc8183HirePlan,
  Erc8183JobFacts,
  NormalizedErc8183Quote,
} from "../src/business/entities/erc8183-browser-spike.js";
import { Erc8183JobNotReadyError, Erc8183QuoteRejectedError } from "../src/business/errors/erc8183-spike-errors.js";
import { assertAllowedQuote } from "../src/business/policies/erc8183-spike-policy.js";
import { NotifyFundedJob } from "../src/business/use-cases/notify-funded-job.js";
import { PrepareErc8183Hire } from "../src/business/use-cases/prepare-erc8183-hire.js";
import {
  assertBrowserSpikeChain,
  exactApprovalRequired,
  parseBrowserJournal,
  resumeRequirements,
  validateRecoveredJobForResume,
} from "../src/data/erc8183/browser-wallet-adapter.js";
import { agenticCommerceBrowserAbi, ERC8183_TESTNET } from "../src/data/erc8183/contracts.js";
import { loadErc8183BrowserSpikeConfig } from "../src/data/erc8183/spike-config.js";
import { assertSuccessfulReceipt, extractConfirmedJobId } from "../src/data/erc8183/receipt-parser.js";
import type { Erc8183SpikeRepository } from "../src/data/repositories/erc8183-spike-repository.js";

const BUYER = getAddress("0x1111111111111111111111111111111111111111");
const NOW = 2_000_000_000;

function quote(overrides: Partial<NormalizedErc8183Quote> = {}): NormalizedErc8183Quote {
  return {
    envelope: { response: { accepted: true } },
    agentId: 1815,
    chainId: 97,
    provider: ERC8183_TESTNET.seller,
    endpoint: "https://fixture.example",
    commerce: ERC8183_TESTNET.commerce,
    router: ERC8183_TESTNET.router,
    policy: ERC8183_TESTNET.policy,
    token: ERC8183_TESTNET.token,
    tokenSymbol: "$U",
    tokenDecimals: 18,
    priceRaw: "1",
    priceDisplay: "0.000000000000000001",
    negotiatedAt: NOW - 1,
    quoteExpiresAt: NOW + 900,
    description: "signed description",
    ...overrides,
  };
}

function buyerFacts(overrides: Partial<Erc8183BuyerFacts> = {}): Erc8183BuyerFacts {
  return {
    buyer: BUYER,
    nativeBalanceRaw: "1000000000000000",
    tokenBalanceRaw: "1",
    allowanceRaw: "0",
    disputeWindowSeconds: "900",
    policyAllowlisted: true,
    ...overrides,
  };
}

function hirePlan(): Erc8183HirePlan {
  return {
    quote: quote(),
    buyer: BUYER,
    seller: ERC8183_TESTNET.seller,
    nativeBalanceRaw: "1000000000000000",
    tokenBalanceRaw: "1",
    allowanceRaw: "0",
    approvalRequired: true,
    approvalAmountRaw: "1",
    deadline: String(NOW + 4_500),
    executeBefore: NOW + 900,
    maximumSignatures: 5,
    transactions: [],
  };
}

function job(overrides: Partial<Erc8183JobFacts> = {}): Erc8183JobFacts {
  return {
    chainId: 97,
    jobId: "900",
    buyer: BUYER,
    provider: ERC8183_TESTNET.seller,
    evaluator: ERC8183_TESTNET.router,
    policy: ERC8183_TESTNET.policy,
    description: "signed description",
    budgetRaw: "1",
    deadline: String(NOW + 4_500),
    status: "FUNDED",
    submittedAt: "0",
    deliverableHash: `0x${"00".repeat(32)}`,
    deliverableUrl: null,
    result: null,
    quotedToken: ERC8183_TESTNET.token,
    quotedPriceRaw: "1",
    quoteExpiresAt: NOW + 900,
    ...overrides,
  };
}

function repository(overrides: Partial<Erc8183SpikeRepository> = {}): Erc8183SpikeRepository {
  return {
    allowlist: {
      commerce: ERC8183_TESTNET.commerce,
      router: ERC8183_TESTNET.router,
      policy: ERC8183_TESTNET.policy,
      token: ERC8183_TESTNET.token,
      seller: ERC8183_TESTNET.seller,
    },
    requestQuote: async () => quote(),
    validateQuote: async () => quote(),
    getBuyerFacts: async () => buyerFacts(),
    getJob: async () => job(),
    notifyFunded: async () => ({ acknowledged: true, alreadySubmitted: false, job: job({ status: "SUBMITTED" }) }),
    ...overrides,
  };
}

describe("Gate 6A business policy", () => {
  it.each([
    ["wrong chain", { chainId: 56 }],
    ["expired quote", { quoteExpiresAt: NOW }],
    ["unapproved token", { token: getAddress("0x2222222222222222222222222222222222222222") }],
    ["unapproved seller", { provider: getAddress("0x3333333333333333333333333333333333333333") }],
    ["over-budget quote", { priceRaw: "2" }],
  ] as const)("rejects %s", (_label, override) => {
    expect(() => assertAllowedQuote(
      quote(override as Partial<NormalizedErc8183Quote>),
      repository().allowlist,
      NOW,
    )).toThrow(Erc8183QuoteRejectedError);
  });

  it("prepares an exact approval and a maximum of five signatures", async () => {
    const plan = await new PrepareErc8183Hire(repository(), () => NOW).execute({ buyer: BUYER, quote: {} });
    expect(plan.approvalRequired).toBe(true);
    expect(plan.approvalAmountRaw).toBe("1");
    expect(plan.maximumSignatures).toBe(5);
    expect(plan.transactions.find(({ kind }) => kind === "approve")).toMatchObject({ required: true });
  });

  it("skips approval when current allowance is sufficient", async () => {
    const plan = await new PrepareErc8183Hire(
      repository({ getBuyerFacts: async () => buyerFacts({ allowanceRaw: "1" }) }),
      () => NOW,
    ).execute({ buyer: BUYER, quote: {} });
    expect(plan.approvalRequired).toBe(false);
    expect(plan.approvalAmountRaw).toBe("0");
    expect(plan.maximumSignatures).toBe(4);
    expect(exactApprovalRequired("1", "1")).toBe(false);
  });

  it("refuses preparation without Testnet token or gas balance", async () => {
    await expect(new PrepareErc8183Hire(
      repository({ getBuyerFacts: async () => buyerFacts({ tokenBalanceRaw: "0" }) }),
      () => NOW,
    ).execute({ buyer: BUYER, quote: {} })).rejects.toThrow(Erc8183JobNotReadyError);
    await expect(new PrepareErc8183Hire(
      repository({ getBuyerFacts: async () => buyerFacts({ nativeBalanceRaw: "0" }) }),
      () => NOW,
    ).execute({ buyer: BUYER, quote: {} })).rejects.toThrow(/tBNB/);
  });

  it("blocks mainnet in browser infrastructure", () => {
    expect(() => assertBrowserSpikeChain(56)).toThrow(/chain 97/);
    expect(() => assertBrowserSpikeChain(97)).not.toThrow();
  });
});

describe("receipts and recovery", () => {
  const baseReceipt = {
    blockHash: `0x${"01".repeat(32)}` as Hash,
    blockNumber: 1n,
    contractAddress: null,
    cumulativeGasUsed: 1n,
    effectiveGasPrice: 1n,
    from: BUYER,
    gasUsed: 1n,
    logsBloom: `0x${"00".repeat(256)}` as Hash,
    transactionHash: `0x${"02".repeat(32)}` as Hash,
    transactionIndex: 0,
    type: "eip1559" as const,
    to: ERC8183_TESTNET.commerce,
  };

  it("rejects a reverted receipt", () => {
    expect(() => assertSuccessfulReceipt({ ...baseReceipt, status: "reverted", logs: [] } as TransactionReceipt)).toThrow(/reverted/);
  });

  it("extracts Job ID only from a confirmed Commerce event", () => {
    const topics = encodeEventTopics({
      abi: agenticCommerceBrowserAbi,
      eventName: "JobCreated",
      args: { jobId: 900n, client: BUYER, provider: ERC8183_TESTNET.seller },
    });
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "address" }],
      [ERC8183_TESTNET.router, BigInt(NOW + 4_500), ERC8183_TESTNET.router],
    );
    const receipt = {
      ...baseReceipt,
      status: "success",
      logs: [{
        address: ERC8183_TESTNET.commerce,
        blockHash: baseReceipt.blockHash,
        blockNumber: 1n,
        data,
        logIndex: 0,
        removed: false,
        topics,
        transactionHash: baseReceipt.transactionHash,
        transactionIndex: 0,
      }],
    } as TransactionReceipt;
    expect(extractConfirmedJobId(receipt)).toBe(900n);
  });

  it("restores only the minimal sanitized journal and derives remaining work from chain", () => {
    const hash = `0x${"12".repeat(32)}` as Hash;
    const restored = parseBrowserJournal({
      schemaVersion: 1,
      chainId: 97,
      buyer: BUYER,
      seller: ERC8183_TESTNET.seller,
      jobId: "900",
      transactions: { createJob: hash },
      lastConfirmedStep: "created",
      privateKey: "must-be-ignored",
    });
    expect(restored).toEqual({
      schemaVersion: 1,
      chainId: 97,
      buyer: BUYER,
      seller: ERC8183_TESTNET.seller,
      jobId: "900",
      transactions: { createJob: hash },
      lastConfirmedStep: "created",
    });
    expect(resumeRequirements(job({ status: "OPEN", budgetRaw: "0", policy: getAddress("0x0000000000000000000000000000000000000000") }), "1"))
      .toEqual({ registerJob: true, setBudget: true, fund: true });
    expect(resumeRequirements(job({ status: "SUBMITTED" }), "1"))
      .toEqual({ registerJob: false, setBudget: false, fund: false });
    expect(resumeRequirements(job({ status: "REJECTED" }), "1"))
      .toEqual({ registerJob: false, setBudget: false, fund: true });
    expect(() =>
      validateRecoveredJobForResume(
        job({ jobId: "901" }),
        hirePlan(),
        "900",
      ),
    ).toThrow(/does not match/);
    expect(() => validateRecoveredJobForResume(job(), hirePlan(), "900")).not.toThrow();
    expect(parseBrowserJournal({
      ...restored,
      lastConfirmedStep: "wallet_has_the_key",
    })).toBeNull();
  });
});

describe("notify_funded guard", () => {
  it("rejects notification before FUNDED", async () => {
    const notify = vi.fn();
    const useCase = new NotifyFundedJob(repository({ getJob: async () => job({ status: "OPEN" }), notifyFunded: notify }));
    await expect(useCase.execute({ jobId: "900", buyer: BUYER })).rejects.toThrow(/FUNDED/);
    expect(notify).not.toHaveBeenCalled();
  });

  it("is idempotent when chain already reports SUBMITTED", async () => {
    const notify = vi.fn();
    const useCase = new NotifyFundedJob(repository({ getJob: async () => job({ status: "SUBMITTED" }), notifyFunded: notify }));
    await expect(useCase.execute({ jobId: "900", buyer: BUYER })).resolves.toMatchObject({ alreadySubmitted: true });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("server-only configuration", () => {
  it("is disabled by default and rejects non-HTTPS or credentialed origins", () => {
    expect(() => loadErc8183BrowserSpikeConfig({})).toThrow(/disabled/);
    expect(() => loadErc8183BrowserSpikeConfig({
      ERC8183_BROWSER_SPIKE_ENABLED: "true",
      ERC8183_BROWSER_SPIKE_SELLER_ORIGIN: "http://fixture.example",
    })).toThrow(/bare HTTPS origin/);
    expect(() => loadErc8183BrowserSpikeConfig({
      ERC8183_BROWSER_SPIKE_ENABLED: "true",
      ERC8183_BROWSER_SPIKE_SELLER_ORIGIN: "https://user:secret@fixture.example",
    })).toThrow(/bare HTTPS origin/);
  });
});
