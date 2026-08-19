import "server-only";
import {
  DeliverableManifest,
  ERC8183Client,
  JobStatus,
  NegotiationHandler,
  parseJobDescription,
} from "@bnbagent/sdk/erc8183";
import { EVMWalletProvider } from "@bnbagent/sdk/wallets";
import { isAddress, isAddressEqual } from "viem";
import type {
  HostedSellerAgentCard,
  HostedSellerDeliverable,
  HostedSellerMessage,
  HostedSellerReply,
} from "../../business/entities/hosted-erc8183-seller.js";
import {
  HostedSellerJobNotReadyError,
  HostedSellerUnavailableError,
} from "../../business/errors/hosted-seller-errors.js";
import { hostedSellerAgentCard } from "../../business/policies/hosted-seller-policy.js";
import { GATE1_NETWORK } from "../../network.js";
import type { HostedErc8183SellerRepository } from "../repositories/hosted-erc8183-seller-repository.js";
import { ERC8183_TESTNET } from "./contracts.js";
import { loadHostedSellerConfig } from "./hosted-seller-config.js";

interface HostedSellerRuntime {
  client: ERC8183Client;
  negotiation: NegotiationHandler;
  origin: string;
}

const notificationInflight = new Map<string, Promise<HostedSellerReply>>();
let runtimePromise: Promise<HostedSellerRuntime> | null = null;

function resultContent(jobId: bigint): string {
  return `Hosted ERC-8183 seller fixture completed job ${jobId}`;
}

function buildManifest(jobId: bigint): DeliverableManifest {
  return new DeliverableManifest({
    version: 1,
    jobId: Number(jobId),
    chainId: ERC8183_TESTNET.chainId,
    contracts: {
      commerce: ERC8183_TESTNET.commerce,
      router: ERC8183_TESTNET.router,
      policy: ERC8183_TESTNET.policy,
    },
    response: {
      content: resultContent(jobId),
      contentType: "text/plain",
    },
    metadata: {},
  });
}

async function createRuntime(): Promise<HostedSellerRuntime> {
  const config = loadHostedSellerConfig();
  if (!isAddressEqual(config.address, ERC8183_TESTNET.seller)) {
    throw new HostedSellerUnavailableError(
      "The configured seller key does not match the hosted fixture allowlist",
    );
  }
  const wallet = new EVMWalletProvider({
    password: "in-memory-only",
    privateKey: config.privateKey,
    persist: false,
  });
  const client = await ERC8183Client.create({
    walletProvider: wallet,
    network: GATE1_NETWORK,
  });
  if ((await client.publicClient.getChainId()) !== ERC8183_TESTNET.chainId) {
    throw new HostedSellerUnavailableError("The seller RPC is not on BSC Testnet");
  }
  const [token, policyAllowed] = await Promise.all([
    client.paymentToken(),
    client.router.policyWhitelist(ERC8183_TESTNET.policy),
  ]);
  if (!isAddressEqual(token, ERC8183_TESTNET.token) || !policyAllowed) {
    throw new HostedSellerUnavailableError(
      "The hosted seller contract allowlist is not active",
    );
  }
  const negotiation = await NegotiationHandler.fromErc8183Client(client, {
    servicePrice: ERC8183_TESTNET.maximumBudgetRaw.toString(),
    walletProvider: wallet,
  });
  return { client, negotiation, origin: config.origin };
}

async function runtime(): Promise<HostedSellerRuntime> {
  runtimePromise ??= createRuntime();
  try {
    return await runtimePromise;
  } catch (error) {
    runtimePromise = null;
    throw error;
  }
}

export class HostedErc8183Seller
  implements HostedErc8183SellerRepository
{
  async getAgentCard(): Promise<HostedSellerAgentCard> {
    const config = loadHostedSellerConfig();
    if (!isAddressEqual(config.address, ERC8183_TESTNET.seller)) {
      throw new HostedSellerUnavailableError();
    }
    return hostedSellerAgentCard(config.origin);
  }

  async handleMessage(message: HostedSellerMessage): Promise<HostedSellerReply> {
    const current = await runtime();
    if (message.skill === "negotiate-erc8183-job") {
      const quote = await current.negotiation.negotiate({
        task_description: message.taskDescription,
        terms: message.terms,
      });
      return {
        ...quote.toDict(),
        provider_address: ERC8183_TESTNET.seller,
      };
    }
    const key = message.jobId.toString();
    const existing = notificationInflight.get(key);
    if (existing) return existing;
    const operation = this.submitFundedJob(current, message.jobId);
    notificationInflight.set(key, operation);
    try {
      return await operation;
    } finally {
      notificationInflight.delete(key);
    }
  }

  private async submitFundedJob(
    current: HostedSellerRuntime,
    jobId: number,
  ): Promise<HostedSellerReply> {
    const [job, policy] = await Promise.all([
      current.client.getJob(BigInt(jobId)),
      current.client.router.jobPolicy(BigInt(jobId)),
    ]);
    const status = job.status;
    if (status === JobStatus.SUBMITTED || status === JobStatus.COMPLETED) {
      return { acknowledged: true, already_submitted: true, job_id: jobId };
    }
    if (status !== JobStatus.FUNDED) {
      throw new HostedSellerJobNotReadyError(
        "notify_funded requires an onchain FUNDED job",
      );
    }
    const description = parseJobDescription(job.description);
    if (
      !isAddressEqual(job.provider, ERC8183_TESTNET.seller) ||
      !isAddressEqual(job.evaluator, ERC8183_TESTNET.router) ||
      !isAddressEqual(job.hook, ERC8183_TESTNET.router) ||
      !isAddressEqual(policy, ERC8183_TESTNET.policy) ||
      job.budget !== ERC8183_TESTNET.maximumBudgetRaw ||
      !description ||
      description.price !== ERC8183_TESTNET.maximumBudgetRaw.toString() ||
      !isAddress(description.currency) ||
      !isAddressEqual(description.currency, ERC8183_TESTNET.token) ||
      !description.providerSig ||
      !description.negotiationHash
    ) {
      throw new HostedSellerJobNotReadyError(
        "The funded job does not match the hosted seller allowlist",
      );
    }
    const manifest = buildManifest(BigInt(jobId));
    const result = await current.client.submit(
      BigInt(jobId),
      manifest.manifestHash(),
      {
        deliverable_url: `${current.origin}/api/fixtures/erc8183/job/${jobId}/response`,
      },
    );
    return {
      acknowledged: true,
      already_submitted: false,
      job_id: jobId,
      transaction_hash: result.transactionHash,
    };
  }

  async getDeliverable(jobId: bigint): Promise<HostedSellerDeliverable> {
    const current = await runtime();
    const job = await current.client.getJob(jobId);
    if (
      !isAddressEqual(job.provider, ERC8183_TESTNET.seller) ||
      (job.status !== JobStatus.SUBMITTED && job.status !== JobStatus.COMPLETED)
    ) {
      throw new HostedSellerJobNotReadyError(
        "The deliverable is not available for this seller job",
      );
    }
    const manifest = buildManifest(jobId);
    if (!manifest.verify(job.deliverable)) {
      throw new HostedSellerUnavailableError(
        "The deterministic deliverable does not match the onchain hash",
      );
    }
    return { success: true, ...manifest.toDict() };
  }
}
