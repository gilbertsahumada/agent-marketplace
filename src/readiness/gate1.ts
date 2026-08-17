import { ERC8183Client, JobStatus, type Job } from "@bnbagent/sdk/erc8183";
import {
  decodeEventLog,
  getAddress,
  hexToString,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { TESTNET_REGISTRY } from "../identity.js";
import { GATE1_NETWORK } from "../network.js";
import type { VerificationError } from "../verification/types.js";
import type { Gate1Proof, TransactionEvidence } from "./types.js";

const AGENT_ID = 1815n;
const JOB_ID = 514n;
const EXPECTED = {
  buyer: getAddress("0x8bdC9Bc2a2de68715e181b72603Bb9A61eff7ddB"),
  provider: getAddress("0xa0166a1c586f85Db39798ee311BAA7831C4Dc65b"),
  paymentToken: getAddress("0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565"),
  budget: 1n,
  deliverableHash: "0x2ed47b2d41add5f9cef468b6748a1d52b3d6e753fac9c7e1de14766e6e315066" as Hash,
  transactions: {
    createJob: "0x8767e5163c208d18ec4282d2a37c519b29fa03b6f6141e4f0458be8d64a243ce",
    registerJob: "0x843a8e9de35389942f04226c1b8322a0dc05ce3698aafea0fd8b2f13ad578f3f",
    setBudget: "0x1414750595ef9bc36f9b83c85f7345f9da74af4ad2b0a114152d94c1d7b62232",
    approve: "0x11bf5cd1de0a0a97547d39955c32eb4d890af2b38beb8dfaee5de21c71308885",
    fund: "0x7a3e76c1f11449264e89b7589e72d6c5acae804fba7142d26a6009edfa5ee227",
    submit: "0xe64f43b0a4daa7a60e2d0708d5851765be206da55563d601fa3c2dd2e5451a32",
  } satisfies Record<string, Hash>,
} as const;

const agentWalletAbi = [{
  type: "function",
  name: "getAgentWallet",
  stateMutability: "view",
  inputs: [{ name: "agentId", type: "uint256" }],
  outputs: [{ name: "", type: "address" }],
}] as const;

const jobInitialisedAbi = [{
  type: "event",
  name: "JobInitialised",
  anonymous: false,
  inputs: [
    { indexed: true, name: "jobId", type: "uint256" },
    { indexed: false, name: "deliverable", type: "bytes32" },
    { indexed: false, name: "submittedAt", type: "uint64" },
    { indexed: false, name: "optParams", type: "bytes" },
  ],
}] as const;

export interface Gate1ProofReader {
  assertChain(): Promise<void>;
  getJob(jobId: bigint): Promise<Job>;
  getPaymentToken(): Promise<Address>;
  getAgentWallet(agentId: bigint): Promise<Address>;
  getDeliverableUrl(jobId: bigint, submitHash: Hash): Promise<string | null>;
  getTransaction(hash: Hash): Promise<TransactionEvidence>;
}

class SdkGate1ProofReader implements Gate1ProofReader {
  constructor(
    private readonly client: ERC8183Client,
    private readonly publicClient: PublicClient,
  ) {}

  async assertChain(): Promise<void> {
    const chainId = await this.publicClient.getChainId();
    if (chainId !== 97) throw new Error(`RPC chain mismatch: expected 97, received ${chainId}`);
  }

  getJob(jobId: bigint): Promise<Job> {
    return this.client.getJob(jobId);
  }

  async getPaymentToken(): Promise<Address> {
    return getAddress(await this.client.paymentToken());
  }

  async getAgentWallet(agentId: bigint): Promise<Address> {
    return this.publicClient.readContract({
      address: TESTNET_REGISTRY,
      abi: agentWalletAbi,
      functionName: "getAgentWallet",
      args: [agentId],
    });
  }

  async getDeliverableUrl(jobId: bigint, submitHash: Hash): Promise<string | null> {
    const receipt = await this.publicClient.getTransactionReceipt({ hash: submitHash });
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== getAddress(GATE1_NETWORK.policyContract)) continue;
      try {
        const decoded = decodeEventLog({ abi: jobInitialisedAbi, data: log.data, topics: log.topics });
        if (decoded.args.jobId !== jobId) continue;
        const params = JSON.parse(hexToString(decoded.args.optParams)) as unknown;
        if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
        const url = (params as Record<string, unknown>).deliverable_url;
        return typeof url === "string" ? url : null;
      } catch {
        continue;
      }
    }
    return null;
  }

  async getTransaction(hash: Hash): Promise<TransactionEvidence> {
    const receipt = await this.publicClient.getTransactionReceipt({ hash });
    return { hash, status: receipt.status, blockNumber: receipt.blockNumber.toString() };
  }
}

export async function createGate1ProofReader(): Promise<Gate1ProofReader> {
  const client = await ERC8183Client.create({ network: GATE1_NETWORK });
  return new SdkGate1ProofReader(client, client.publicClient);
}

function sanitizedError(error: unknown): VerificationError {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
    .replace(/(bearer|token|password|secret)=?\s*[^\s]+/gi, "$1=[redacted]")
    .slice(0, 300);
  return { code: "GATE1_PROOF_READ_FAILED", message: message || "Gate 1 proof read failed." };
}

export async function verifyGate1Proof(
  reader: Gate1ProofReader,
  now: () => number = Date.now,
): Promise<Gate1Proof> {
  const observedAt = new Date(now()).toISOString();
  try {
    await reader.assertChain();
    const [job, paymentToken, agentWallet] = await Promise.all([
      reader.getJob(JOB_ID),
      reader.getPaymentToken(),
      reader.getAgentWallet(AGENT_ID),
    ]);
    const transactions: Record<string, TransactionEvidence> = {};
    for (const [name, hash] of Object.entries(EXPECTED.transactions)) {
      transactions[name] = await reader.getTransaction(hash);
    }
    if (!transactions.submit) throw new Error("Submit transaction receipt is missing");
    const deliverableUrl = await reader.getDeliverableUrl(JOB_ID, EXPECTED.transactions.submit);
    const observedState = JobStatus[job.status] ?? `UNKNOWN_${job.status}`;
    const checks = {
      stateMatches: job.status === JobStatus.SUBMITTED,
      buyerMatches: getAddress(job.client) === EXPECTED.buyer,
      providerMatches: getAddress(job.provider) === EXPECTED.provider,
      agentWalletMatches: getAddress(agentWallet) === EXPECTED.provider,
      paymentTokenMatches: getAddress(paymentToken) === EXPECTED.paymentToken,
      budgetMatches: job.budget === EXPECTED.budget,
      deliverableHashMatches: job.deliverable.toLowerCase() === EXPECTED.deliverableHash,
      deliverableUrlPresent: typeof deliverableUrl === "string" && deliverableUrl.length > 0,
      transactionsSucceeded: Object.values(transactions).every((transaction) => transaction.status === "success"),
    };
    return {
      status: Object.values(checks).every(Boolean) ? "verified" : "mismatch",
      network: "bsc-testnet",
      chainId: 97,
      agentId: "1815",
      jobId: "514",
      expectedState: "SUBMITTED",
      observedState,
      buyer: getAddress(job.client),
      provider: getAddress(job.provider),
      agentWallet: getAddress(agentWallet),
      paymentToken: getAddress(paymentToken),
      budget: job.budget.toString(),
      deliverableHash: job.deliverable,
      deliverableUrl,
      transactions,
      checks,
      observedAt,
      provenance: "onchain:bsc-testnet-rpc",
      error: null,
    };
  } catch (error) {
    return {
      status: "read_error",
      network: "bsc-testnet",
      chainId: 97,
      agentId: "1815",
      jobId: "514",
      expectedState: "SUBMITTED",
      observedState: null,
      buyer: null,
      provider: null,
      agentWallet: null,
      paymentToken: null,
      budget: null,
      deliverableHash: null,
      deliverableUrl: null,
      transactions: {},
      checks: {
        stateMatches: null,
        buyerMatches: null,
        providerMatches: null,
        agentWalletMatches: null,
        paymentTokenMatches: null,
        budgetMatches: null,
        deliverableHashMatches: null,
        deliverableUrlPresent: null,
        transactionsSucceeded: null,
      },
      observedAt,
      provenance: "onchain:bsc-testnet-rpc",
      error: sanitizedError(error),
    };
  }
}
