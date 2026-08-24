import "server-only";
import {
  DeliverableManifest,
  ERC8183Client,
  ERC8183JobOps,
  JobStatus,
  NegotiationHandler,
  excErrorFields,
  parseJobDescription,
} from "@bnbagent/sdk/erc8183";
import { resolveNetwork } from "@bnbagent/sdk";
import { EVMWalletProvider } from "@bnbagent/sdk/wallets";
import { isAddress, isAddressEqual } from "viem";
import type {
  HostedSellerAgentCard,
  HostedSellerDeliverable,
  HostedSellerMessage,
  HostedSellerReply,
} from "../business/entities/hosted-erc8183-seller.js";
import { HostedSellerJobNotReadyError, HostedSellerUnavailableError } from "../business/errors/hosted-seller-errors.js";
import { gridSellerAgentCard } from "../business/policies/grid-seller-policy.js";
import { buildGridPlan, parseGridTaskDescription } from "../business/policies/grid-plan-policy.js";
import type { HostedErc8183SellerRepository } from "../data/repositories/hosted-erc8183-seller-repository.js";
import { ERC8183_MAINNET } from "./contracts.js";
import { loadMainnetGridSellerConfig } from "./grid-seller-config.js";

interface MainnetGridRuntime {
  client: ERC8183Client;
  jobOps: ERC8183JobOps;
  negotiation: NegotiationHandler;
  origin: string;
  seller: `0x${string}`;
}

const inflight = new Map<string, Promise<HostedSellerReply>>();
let runtimePromise: Promise<MainnetGridRuntime> | null = null;
let signerBusy = false;
const requestTimes: number[] = [];
const MAX_REQUESTS_PER_MINUTE = 60;
const MINIMUM_SIGNER_GAS_BALANCE = 2_000_000_000_000_000n;

function assertRequestBudget(now = Date.now()): void {
  while (requestTimes.length > 0 && requestTimes[0]! <= now - 60_000) requestTimes.shift();
  if (requestTimes.length >= MAX_REQUESTS_PER_MINUTE) {
    throw new HostedSellerUnavailableError("The Mainnet Grid seller request limit was reached");
  }
  requestTimes.push(now);
}

function planForDescription(description: string) {
  const parsed = parseJobDescription(description);
  if (!parsed || !parsed.providerSig || !parsed.negotiationHash) {
    throw new HostedSellerJobNotReadyError("The job has no signed Grid quote");
  }
  return { parsed, plan: buildGridPlan(parseGridTaskDescription(parsed.task)) };
}

function manifest(jobId: bigint, description: string): DeliverableManifest {
  const { plan } = planForDescription(description);
  return new DeliverableManifest({
    version: 1,
    jobId: Number(jobId),
    chainId: ERC8183_MAINNET.chainId,
    contracts: {
      commerce: ERC8183_MAINNET.commerce,
      router: ERC8183_MAINNET.router,
      policy: ERC8183_MAINNET.policy,
    },
    response: {
      content: JSON.stringify(plan),
      contentType: "application/json",
    },
    metadata: { sellerType: "marketplace-operated-grid-seller", execution: "none" },
  });
}

async function createRuntime(): Promise<MainnetGridRuntime> {
  const config = loadMainnetGridSellerConfig(process.env, { requireAgentId: true });
  const wallet = new EVMWalletProvider({ password: "in-memory-only", privateKey: config.privateKey, persist: false });
  const client = await ERC8183Client.create({ walletProvider: wallet, network: resolveNetwork("bsc-mainnet") });
  const [chainId, token, policyAllowed] = await Promise.all([
    client.publicClient.getChainId(),
    client.paymentToken(),
    client.router.policyWhitelist(ERC8183_MAINNET.policy),
  ]);
  if (chainId !== 56 || !isAddressEqual(token, ERC8183_MAINNET.token) || !policyAllowed) {
    throw new HostedSellerUnavailableError("The Mainnet APEX allowlist is not active");
  }
  const negotiation = await NegotiationHandler.fromErc8183Client(client, {
    servicePrice: ERC8183_MAINNET.maximumDemoBudgetRaw.toString(),
    walletProvider: wallet,
    quoteTtlSeconds: 900,
  });
  const jobOps = await ERC8183JobOps.create({
    walletProvider: wallet,
    network: resolveNetwork("bsc-mainnet"),
    servicePrice: ERC8183_MAINNET.maximumDemoBudgetRaw,
    agentUrl: config.origin,
    allowUnsignedJobs: false,
  });
  return { client, jobOps, negotiation, origin: config.origin, seller: config.address };
}

async function runtime(): Promise<MainnetGridRuntime> {
  runtimePromise ??= createRuntime();
  try {
    return await runtimePromise;
  } catch (error) {
    runtimePromise = null;
    throw error;
  }
}

export class MainnetGridSellerRepository implements HostedErc8183SellerRepository {
  constructor(private readonly loadRuntime: () => Promise<MainnetGridRuntime> = runtime) {}

  async getAgentCard(): Promise<HostedSellerAgentCard> {
    const config = loadMainnetGridSellerConfig(process.env, { requireAgentId: false });
    return gridSellerAgentCard(config.origin);
  }

  async handleMessage(message: HostedSellerMessage): Promise<HostedSellerReply> {
    assertRequestBudget();
    const current = await this.loadRuntime();
    if (message.skill === "negotiate-erc8183-job") {
      parseGridTaskDescription(message.taskDescription);
      if (
        message.terms.deliverables !== "Deterministic Grid plan JSON with levels, allocation, triggers and assumptions" ||
        message.terms.quality_standards !== "Deterministic output, no order execution and no custody"
      ) throw new HostedSellerJobNotReadyError("The Grid negotiation terms are not supported");
      const quote = await current.negotiation.negotiate({
        task_description: message.taskDescription,
        terms: message.terms,
      });
      return { ...quote.toDict(), provider_address: current.seller };
    }
    const key = message.jobId.toString();
    const existing = inflight.get(key);
    if (existing) return existing;
    const operation = this.submit(current, BigInt(message.jobId));
    inflight.set(key, operation);
    try {
      return await operation;
    } finally {
      inflight.delete(key);
    }
  }

  private async submit(current: MainnetGridRuntime, jobId: bigint): Promise<HostedSellerReply> {
    if (signerBusy) throw new HostedSellerUnavailableError("The Mainnet Grid seller signer is busy; retry shortly");
    signerBusy = true;
    try {
      return await this.submitWithSigner(current, jobId);
    } finally {
      signerBusy = false;
    }
  }

  private async submitWithSigner(current: MainnetGridRuntime, jobId: bigint): Promise<HostedSellerReply> {
    if (jobId > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new HostedSellerJobNotReadyError("The funded Grid Job ID is outside the supported range");
    }
    const existingJob = await current.client.getJob(jobId);
    if (existingJob.status === JobStatus.SUBMITTED || existingJob.status === JobStatus.COMPLETED) {
      if (!isAddressEqual(existingJob.provider, current.seller)) {
        throw new HostedSellerJobNotReadyError("The Grid job belongs to another provider");
      }
      return { acknowledged: true, already_submitted: true, job_id: Number(jobId) };
    }
    const verification = await current.jobOps.verifyJob(Number(jobId));
    if (verification.valid !== true) {
      throw new HostedSellerJobNotReadyError("The funded Grid job failed signed-quote verification");
    }
    const [job, policy] = await Promise.all([
      current.client.getJob(jobId),
      current.client.router.jobPolicy(jobId),
    ]);
    if (job.status !== JobStatus.FUNDED) throw new HostedSellerJobNotReadyError("notify_funded requires an onchain FUNDED job");
    const { parsed } = planForDescription(job.description);
    const disputeWindow = await current.client.policy.disputeWindow();
    const now = BigInt(Math.floor(Date.now() / 1_000));
    if (
      !isAddressEqual(job.provider, current.seller) ||
      !isAddressEqual(job.evaluator, ERC8183_MAINNET.router) ||
      !isAddressEqual(job.hook, ERC8183_MAINNET.router) ||
      !isAddressEqual(policy, ERC8183_MAINNET.policy) ||
      job.budget !== ERC8183_MAINNET.maximumDemoBudgetRaw ||
      parsed.price !== ERC8183_MAINNET.maximumDemoBudgetRaw.toString() ||
      !isAddress(parsed.currency) ||
      !isAddressEqual(parsed.currency, ERC8183_MAINNET.token) ||
      job.expiredAt <= now + disputeWindow
    ) throw new HostedSellerJobNotReadyError("The funded Grid job is outside the Mainnet allowlist");
    const signerBalance = await current.client.publicClient.getBalance({ address: current.seller });
    if (signerBalance < MINIMUM_SIGNER_GAS_BALANCE) {
      throw new HostedSellerUnavailableError("The Mainnet Grid seller gas reserve is below its safety floor");
    }
    const deliverable = manifest(jobId, job.description);
    const deliverableHash = deliverable.manifestHash();
    try {
      const result = await current.client.submit(jobId, deliverableHash, {
        deliverable_url: `${current.origin}/api/sellers/grid/job/${jobId}/response`,
      });
      return { acknowledged: true, already_submitted: false, job_id: Number(jobId), transaction_hash: result.transactionHash };
    } catch (error) {
      const errorFields = excErrorFields(error);
      const pendingHash = typeof errorFields.tx_hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(errorFields.tx_hash)
        ? errorFields.tx_hash as `0x${string}`
        : null;
      if (pendingHash) {
        try {
          await current.client.publicClient.waitForTransactionReceipt({ hash: pendingHash, timeout: 60_000 });
        } catch {
          // The authoritative job reread below decides whether another
          // instance completed the transition; a pending hash is never
          // treated as success by itself.
        }
      }
      const reconciled = await current.client.getJob(jobId);
      if (
        (reconciled.status === JobStatus.SUBMITTED || reconciled.status === JobStatus.COMPLETED) &&
        isAddressEqual(reconciled.provider, current.seller) &&
        reconciled.deliverable.toLowerCase() === deliverableHash.toLowerCase()
      ) {
        return { acknowledged: true, already_submitted: true, job_id: Number(jobId) };
      }
      throw new HostedSellerUnavailableError("The Mainnet Grid submission could not be reconciled onchain");
    }
  }

  async getDeliverable(jobId: bigint): Promise<HostedSellerDeliverable> {
    const current = await this.loadRuntime();
    const job = await current.client.getJob(jobId);
    if (!isAddressEqual(job.provider, current.seller) || (job.status !== JobStatus.SUBMITTED && job.status !== JobStatus.COMPLETED)) {
      throw new HostedSellerJobNotReadyError("The Grid deliverable is not available");
    }
    const deliverable = manifest(jobId, job.description);
    if (!deliverable.verify(job.deliverable)) throw new HostedSellerUnavailableError("The Grid deliverable does not match chain state");
    return { success: true, ...deliverable.toDict() };
  }
}
