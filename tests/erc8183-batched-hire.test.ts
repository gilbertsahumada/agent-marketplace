import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import type { Erc8183HirePlan } from "../src/business/entities/erc8183-browser-spike.ts";
import { Erc8183JobNotReadyError } from "../src/business/errors/erc8183-spike-errors.ts";
import {
  buildHireCalls,
  extractBatchJobId,
  isBatchUnsupportedError,
  predictNextJobId,
  receiptForCall,
  supportsAtomicBatch,
  type BatchCallReceipt,
} from "../src/data/erc8183/batched-hire.ts";
import { agenticCommerceBrowserAbi, ERC8183_TESTNET, evaluatorRouterBrowserAbi, paymentTokenBrowserAbi } from "../src/data/erc8183/contracts.ts";

const BUYER = getAddress("0x1111111111111111111111111111111111111111");
const NOW = 2_000_000_000;

function plan(overrides: Partial<Erc8183HirePlan> = {}): Erc8183HirePlan {
  return {
    quote: {
      envelope: {},
      agentId: 1866,
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
    },
    buyer: BUYER,
    seller: ERC8183_TESTNET.seller,
    nativeBalanceRaw: "1",
    tokenBalanceRaw: "1",
    allowanceRaw: "0",
    approvalRequired: true,
    approvalAmountRaw: "1",
    deadline: String(NOW + 4_500),
    disputeWindowSeconds: "900",
    executeBefore: NOW + 900,
    maximumSignatures: 5,
    guardrails: {
      custody: "injected_wallet",
      buyerPrivateKeyReceivedByServer: false,
      spendCeilingRaw: "1",
      approvalMode: "exact_if_required",
      approvalSpender: ERC8183_TESTNET.commerce,
      cancellationAvailableAfterFunding: false,
    },
    transactions: [],
    ...overrides,
  };
}

function receipt(overrides: Partial<BatchCallReceipt> & { jobId?: bigint; commerce?: `0x${string}` } = {}): BatchCallReceipt {
  const { jobId, commerce = ERC8183_TESTNET.commerce, ...rest } = overrides;
  const logs = jobId === undefined ? [] : [{
    address: commerce,
    topics: encodeEventTopics({ abi: agenticCommerceBrowserAbi, eventName: "JobCreated", args: { jobId, client: BUYER, provider: ERC8183_TESTNET.seller } }),
    data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "address" }], [ERC8183_TESTNET.router, BigInt(NOW + 4_500), ERC8183_TESTNET.router]),
  }];
  return {
    status: "success",
    transactionHash: `0x${"ab".repeat(32)}`,
    blockNumber: 70_000_001n,
    logs: logs as unknown as BatchCallReceipt["logs"],
    ...rest,
  };
}

describe("batched hire helpers", () => {
  it("encodes the five intents in order against the pinned contracts, four without an approval", () => {
    const calls = buildHireCalls({ plan: plan(), deployment: ERC8183_TESTNET, jobId: 939n, budget: 1n });
    expect(calls.map(({ kind, to }) => `${kind}@${to}`)).toEqual([
      `createJob@${ERC8183_TESTNET.commerce}`,
      `registerJob@${ERC8183_TESTNET.router}`,
      `setBudget@${ERC8183_TESTNET.commerce}`,
      `approve@${ERC8183_TESTNET.token}`,
      `fund@${ERC8183_TESTNET.commerce}`,
    ]);
    expect(calls[0]?.data).toBe(encodeFunctionData({
      abi: agenticCommerceBrowserAbi,
      functionName: "createJob",
      args: [ERC8183_TESTNET.seller, ERC8183_TESTNET.router, BigInt(NOW + 4_500), "signed description", ERC8183_TESTNET.router],
    }));
    expect(calls[1]?.data).toBe(encodeFunctionData({ abi: evaluatorRouterBrowserAbi, functionName: "registerJob", args: [939n, ERC8183_TESTNET.policy] }));
    expect(calls[3]?.data).toBe(encodeFunctionData({ abi: paymentTokenBrowserAbi, functionName: "approve", args: [ERC8183_TESTNET.commerce, 1n] }));
    expect(calls[4]?.data).toBe(encodeFunctionData({ abi: agenticCommerceBrowserAbi, functionName: "fund", args: [939n, 1n, "0x"] }));

    const withoutApproval = buildHireCalls({ plan: plan({ approvalRequired: false }), deployment: ERC8183_TESTNET, jobId: 939n, budget: 1n });
    expect(withoutApproval.map(({ kind }) => kind)).toEqual(["createJob", "registerJob", "setBudget", "fund"]);
  });

  it("predicts the next job id as the counter plus one and rejects an invalid counter", () => {
    expect(predictNextJobId(938n)).toBe(939n);
    expect(predictNextJobId(0n)).toBe(1n);
    expect(() => predictNextJobId(-1n)).toThrow(Erc8183JobNotReadyError);
  });

  it("requires supported or ready atomic capabilities", () => {
    expect(supportsAtomicBatch({ atomic: { status: "supported" } })).toBe(true);
    expect(supportsAtomicBatch({ atomic: { status: "ready" } })).toBe(true);
    for (const value of [{ atomic: { status: "unsupported" } }, { atomic: {} }, {}, null, undefined, "supported"]) {
      expect(supportsAtomicBatch(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("reads the confirmed job id from whichever successful receipt carries JobCreated", () => {
    expect(extractBatchJobId([receipt(), receipt({ jobId: 939n })], ERC8183_TESTNET.commerce)).toBe(939n);
    expect(extractBatchJobId([receipt({ jobId: 940n })], ERC8183_TESTNET.commerce)).toBe(940n);
    expect(() => extractBatchJobId([receipt({ jobId: 939n, status: "reverted" })], ERC8183_TESTNET.commerce)).toThrow(Erc8183JobNotReadyError);
    expect(() => extractBatchJobId([receipt({ jobId: 939n, commerce: getAddress("0x2222222222222222222222222222222222222222") })], ERC8183_TESTNET.commerce)).toThrow(Erc8183JobNotReadyError);
    expect(() => extractBatchJobId([], ERC8183_TESTNET.commerce)).toThrow(Erc8183JobNotReadyError);
  });

  it("maps calls to receipts whether the wallet answered one per call or one per batch", () => {
    const perCall = [receipt({ transactionHash: `0x${"01".repeat(32)}` }), receipt({ transactionHash: `0x${"02".repeat(32)}` })];
    expect(receiptForCall(perCall, 2, 1).transactionHash).toBe(`0x${"02".repeat(32)}`);
    const single = [receipt({ transactionHash: `0x${"03".repeat(32)}` })];
    expect(receiptForCall(single, 5, 4).transactionHash).toBe(`0x${"03".repeat(32)}`);
    expect(() => receiptForCall([], 5, 0)).toThrow(Erc8183JobNotReadyError);
  });

  it("classifies only capability errors as a reason to fall back", () => {
    expect(isBatchUnsupportedError({ code: -32601, message: "Method not found" })).toBe(true);
    expect(isBatchUnsupportedError({ code: 4200 })).toBe(true);
    expect(isBatchUnsupportedError({ code: 5740 })).toBe(true);
    expect(isBatchUnsupportedError(new Error("wallet_sendCalls is not supported by this wallet"))).toBe(true);
    expect(isBatchUnsupportedError(Object.assign(new Error("User rejected the request."), { code: 4001 }))).toBe(false);
    expect(isBatchUnsupportedError(new Error("insufficient funds"))).toBe(false);
  });
});
