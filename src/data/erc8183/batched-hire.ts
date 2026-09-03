import {
  encodeFunctionData,
  getAddress,
  isAddressEqual,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import type { Erc8183HirePlan, Erc8183TransactionKind } from "../../business/entities/erc8183-browser-spike.ts";
import { Erc8183JobNotReadyError } from "../../business/errors/erc8183-spike-errors.ts";
import {
  agenticCommerceBrowserAbi,
  evaluatorRouterBrowserAbi,
  paymentTokenBrowserAbi,
} from "./contracts.ts";
import { extractConfirmedJobId } from "./receipt-parser.ts";

// P6 — one-confirmation hire. The five intents become one EIP-5792
// `wallet_sendCalls` batch that the wallet must execute atomically. Pure
// helpers live here so they are unit-testable without a wallet or an RPC; the
// orchestration (capabilities, send, wait, journal) stays in
// executeBrowserHire and falls back to the sequential path whenever the
// wallet cannot batch.

export interface HireCall {
  readonly kind: Erc8183TransactionKind;
  readonly to: Address;
  readonly data: Hex;
}

export interface BatchedHireDeployment {
  readonly commerce: Address;
  readonly router: Address;
  readonly policy: Address;
  readonly token: Address;
}

export interface BatchCallReceipt {
  readonly status: "success" | "reverted";
  readonly transactionHash: Hex;
  readonly blockNumber: bigint;
  readonly logs: TransactionReceipt["logs"];
}

// `wallet_getCapabilities` answers per chain; only `supported` and `ready`
// (EIP-7702 upgrade offered by the wallet) guarantee the whole batch lands or
// nothing does, which is the property the hire relies on.
export function supportsAtomicBatch(capabilities: unknown): boolean {
  if (capabilities === null || typeof capabilities !== "object") return false;
  const atomic = (capabilities as { atomic?: unknown }).atomic;
  if (atomic === null || typeof atomic !== "object") return false;
  const status = (atomic as { status?: unknown }).status;
  return status === "supported" || status === "ready";
}

// Commerce assigns `++jobCounter`: on BSC Testnet on 2026-09-03 `jobCounter()`
// answered 938 while job 938 existed and 939 was empty, so the next job is
// the counter plus one. A wrong prediction cannot damage anything: registerJob
// and setBudget are client-checked, so a foreign id reverts and the atomic
// batch rolls back, including createJob.
export function predictNextJobId(jobCounter: bigint): bigint {
  if (jobCounter < 0n) throw new Erc8183JobNotReadyError("Commerce job counter is invalid");
  return jobCounter + 1n;
}

export function buildHireCalls(input: {
  readonly plan: Erc8183HirePlan;
  readonly deployment: BatchedHireDeployment;
  readonly jobId: bigint;
  readonly budget: bigint;
}): readonly HireCall[] {
  const { plan, deployment, jobId, budget } = input;
  return [
    {
      kind: "createJob",
      to: deployment.commerce,
      data: encodeFunctionData({
        abi: agenticCommerceBrowserAbi,
        functionName: "createJob",
        args: [plan.seller, deployment.router, BigInt(plan.deadline), plan.quote.description, deployment.router],
      }),
    },
    {
      kind: "registerJob",
      to: deployment.router,
      data: encodeFunctionData({ abi: evaluatorRouterBrowserAbi, functionName: "registerJob", args: [jobId, deployment.policy] }),
    },
    {
      kind: "setBudget",
      to: deployment.commerce,
      data: encodeFunctionData({ abi: agenticCommerceBrowserAbi, functionName: "setBudget", args: [jobId, budget, "0x"] }),
    },
    ...(plan.approvalRequired ? [{
      kind: "approve" as const,
      to: deployment.token,
      data: encodeFunctionData({ abi: paymentTokenBrowserAbi, functionName: "approve", args: [deployment.commerce, budget] }),
    }] : []),
    {
      kind: "fund",
      to: deployment.commerce,
      data: encodeFunctionData({ abi: agenticCommerceBrowserAbi, functionName: "fund", args: [jobId, budget, "0x"] }),
    },
  ];
}

// A wallet may return one receipt for the whole batch or one per call; the
// JobCreated event is searched in every successful receipt.
export function extractBatchJobId(receipts: readonly BatchCallReceipt[], commerce: Address): bigint {
  for (const receipt of receipts) {
    if (receipt.status !== "success") continue;
    try {
      return extractConfirmedJobId(receipt as unknown as TransactionReceipt, commerce);
    } catch {
      // Not the receipt that carried createJob.
    }
  }
  throw new Erc8183JobNotReadyError("Batched hire receipts carry no Commerce JobCreated event");
}

// Maps each call to the receipt that executed it: index-aligned when the
// wallet answered one receipt per call, otherwise the single batch receipt.
export function receiptForCall(receipts: readonly BatchCallReceipt[], callCount: number, index: number): BatchCallReceipt {
  const receipt = receipts.length === callCount ? receipts[index] : receipts[0];
  if (!receipt) throw new Erc8183JobNotReadyError("Batched hire returned no receipt");
  return receipt;
}

// Errors that mean "this wallet cannot batch" rather than "the batch failed":
// unknown method (-32601), unsupported method (4200), atomic-ness unsupported
// (5740) and the provider-level rejections viem raises for them. Anything
// else, including the user's rejection (4001), propagates.
export function isBatchUnsupportedError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === -32601 || code === 4200 || code === 5740) return true;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /wallet_sendCalls|wallet_getCapabilities|does not support|not supported|unsupported|atomic/i.test(text)
    && !/rejected|denied/i.test(text);
}

export function sameContract(left: string, right: string): boolean {
  return isAddressEqual(getAddress(left), getAddress(right));
}
