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
import { GATE1_JOB_514_MANIFEST } from "../data/proofs/gate1-job-514.js";
import type { VerificationError } from "../verification/types.js";
import type { Gate1Proof, TransactionEvidence } from "./types.js";

const AGENT_ID = BigInt(GATE1_JOB_514_MANIFEST.sellerAgentId);
const JOB_ID = BigInt(GATE1_JOB_514_MANIFEST.jobId);
const EXPECTED = {
  buyer: getAddress(GATE1_JOB_514_MANIFEST.buyer),
  provider: getAddress(GATE1_JOB_514_MANIFEST.seller),
  paymentToken: getAddress(GATE1_JOB_514_MANIFEST.payment.token),
  budget: BigInt(GATE1_JOB_514_MANIFEST.payment.budgetRaw),
  deadline: BigInt(GATE1_JOB_514_MANIFEST.lifecycle.deadline.unix),
  submittedAt: BigInt(GATE1_JOB_514_MANIFEST.lifecycle.submittedAt.unix),
  deliverableHash: GATE1_JOB_514_MANIFEST.deliverable.hash as Hash,
  transactions: GATE1_JOB_514_MANIFEST.transactions,
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
    const block = await this.publicClient.getBlock({ blockNumber: receipt.blockNumber });
    return {
      hash,
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      timestamp: new Date(Number(block.timestamp) * 1_000).toISOString(),
    };
  }
}

export async function createGate1ProofReader(): Promise<Gate1ProofReader> {
  const client = await ERC8183Client.create({ network: GATE1_NETWORK });
  return new SdkGate1ProofReader(client, client.publicClient);
}

export function sanitizeGate1ProofError(error: unknown): VerificationError {
  void error;
  return {
    code: "GATE1_PROOF_READ_FAILED",
    message: "Gate 1 proof verification did not complete successfully.",
  };
}

function timestamp(unix: bigint): { unix: string; iso: string } {
  return { unix: unix.toString(), iso: new Date(Number(unix) * 1_000).toISOString() };
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
    for (const [name, expected] of Object.entries(EXPECTED.transactions)) {
      transactions[name] = await reader.getTransaction(expected.hash);
    }
    if (!transactions.submit) throw new Error("Submit transaction receipt is missing");
    const deliverableUrl = await reader.getDeliverableUrl(JOB_ID, EXPECTED.transactions.submit.hash);
    const observedState = JobStatus[job.status] ?? `UNKNOWN_${job.status}`;
    const checks = {
      stateMatches: job.status === JobStatus.SUBMITTED,
      buyerMatches: getAddress(job.client) === EXPECTED.buyer,
      providerMatches: getAddress(job.provider) === EXPECTED.provider,
      agentWalletMatches: getAddress(agentWallet) === EXPECTED.provider,
      paymentTokenMatches: getAddress(paymentToken) === EXPECTED.paymentToken,
      budgetMatches: job.budget === EXPECTED.budget,
      deadlineMatches: job.expiredAt === EXPECTED.deadline,
      submittedAtMatches: job.submittedAt === EXPECTED.submittedAt,
      deliverableHashMatches: job.deliverable.toLowerCase() === EXPECTED.deliverableHash,
      deliverableUrlPresent: typeof deliverableUrl === "string" && deliverableUrl.length > 0,
      transactionsSucceeded: Object.values(transactions).every((transaction) => transaction.status === "success"),
      transactionEvidenceMatches: Object.entries(transactions).every(([name, transaction]) => {
        const expected = EXPECTED.transactions[name as keyof typeof EXPECTED.transactions];
        return expected !== undefined
          && transaction.hash.toLowerCase() === expected.hash
          && transaction.blockNumber === expected.blockNumber
          && transaction.timestamp === expected.timestamp;
      }),
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
      deadline: timestamp(job.expiredAt),
      submittedAt: timestamp(job.submittedAt),
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
      deadline: null,
      submittedAt: null,
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
        deadlineMatches: null,
        submittedAtMatches: null,
        deliverableHashMatches: null,
        deliverableUrlPresent: null,
        transactionsSucceeded: null,
        transactionEvidenceMatches: null,
      },
      observedAt,
      provenance: "onchain:bsc-testnet-rpc",
      error: sanitizeGate1ProofError(error),
    };
  }
}
