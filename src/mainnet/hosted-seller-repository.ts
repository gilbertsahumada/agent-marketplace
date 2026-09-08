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
} from "../business/entities/hosted-erc8183-seller.ts";
import type { HostedSellerService } from "../business/entities/hosted-seller-service.ts";
import { HostedSellerJobNotReadyError, HostedSellerUnavailableError, InvalidHostedSellerRequestError } from "../business/errors/hosted-seller-errors.ts";
import { hostedSellerAgentCard, hostedSellerDeliverableUrl } from "../business/policies/hosted-seller-catalog.ts";
import type { HostedErc8183SellerRepository } from "../data/repositories/hosted-erc8183-seller-repository.ts";
import { ERC8183_MAINNET } from "./contracts.ts";
import { loadMainnetHostedSellerConfig } from "./hosted-seller-config.ts";
import { mainnetImplementationPinsMatch } from "./implementation-pins.ts";
import { areMainnetWritesEnabled } from "./mainnet-write-gate.ts";

export interface MainnetHostedSellerRuntime {
  client: ERC8183Client;
  jobOps: ERC8183JobOps;
  negotiation: NegotiationHandler;
  origin: string;
  seller: `0x${string}`;
}

// Module-level state is keyed by seller slug: each seller has its own signer,
// its own in-flight submissions and its own request budget.
const inflight = new Map<string, Promise<HostedSellerReply>>();
const runtimes = new Map<string, Promise<MainnetHostedSellerRuntime>>();
const busySigners = new Set<string>();
const requestTimes = new Map<string, number[]>();
const MAX_REQUESTS_PER_MINUTE = 60;
const MINIMUM_SIGNER_GAS_BALANCE = 2_000_000_000_000_000n;
const MINIMUM_SUBMIT_MARGIN_SECONDS = 600n;
const MAINNET_SELLER_RPC_URL = "https://bsc-rpc.publicnode.com";

export function mainnetHostedSellerNetwork() {
  return { ...resolveNetwork("bsc-mainnet"), rpcUrl: MAINNET_SELLER_RPC_URL };
}

function sellerLabel(service: HostedSellerService): string {
  return service.slug === "grid" ? "Grid" : service.slug;
}

async function createRuntime(service: HostedSellerService): Promise<MainnetHostedSellerRuntime> {
  const config = loadMainnetHostedSellerConfig(service.slug, process.env, { requireAgentId: true });
  const wallet = new EVMWalletProvider({ password: "in-memory-only", privateKey: config.privateKey, persist: false });
  const network = mainnetHostedSellerNetwork();
  const client = await ERC8183Client.create({ walletProvider: wallet, network });
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
    network,
    servicePrice: ERC8183_MAINNET.maximumDemoBudgetRaw,
    agentUrl: config.origin,
    allowUnsignedJobs: false,
  });
  return { client, jobOps, negotiation, origin: config.origin, seller: config.address };
}

export function sharedRuntimeLoader(service: HostedSellerService): () => Promise<MainnetHostedSellerRuntime> {
  return async () => {
    let pending = runtimes.get(service.slug);
    if (!pending) {
      pending = createRuntime(service);
      runtimes.set(service.slug, pending);
    }
    try {
      return await pending;
    } catch (error) {
      runtimes.delete(service.slug);
      throw error;
    }
  };
}

export class MainnetHostedSellerRepository implements HostedErc8183SellerRepository {
  constructor(
    protected readonly service: HostedSellerService,
    private readonly loadRuntime: () => Promise<MainnetHostedSellerRuntime> = sharedRuntimeLoader(service),
    private readonly writesEnabled: () => boolean = areMainnetWritesEnabled,
  ) {}

  private get label(): string {
    return sellerLabel(this.service);
  }

  private assertRequestBudget(now = Date.now()): void {
    const times = requestTimes.get(this.service.slug) ?? [];
    while (times.length > 0 && times[0]! <= now - 60_000) times.shift();
    if (times.length >= MAX_REQUESTS_PER_MINUTE) {
      throw new HostedSellerUnavailableError(`The Mainnet ${this.label} seller request limit was reached`);
    }
    times.push(now);
    requestTimes.set(this.service.slug, times);
  }

  private planForDescription(description: string) {
    const parsed = parseJobDescription(description);
    if (!parsed || !parsed.providerSig || !parsed.negotiationHash) {
      throw new HostedSellerJobNotReadyError(`The job has no signed ${this.label} quote`);
    }
    return { parsed, plan: this.service.planner.build(this.service.planner.parseTaskDescription(parsed.task)) };
  }

  private manifest(jobId: bigint, description: string): DeliverableManifest {
    const { plan } = this.planForDescription(description);
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
      metadata: { sellerType: `marketplace-operated-${this.service.slug}-seller`, execution: "none" },
    });
  }

  async getAgentCard(): Promise<HostedSellerAgentCard> {
    const config = loadMainnetHostedSellerConfig(this.service.slug, process.env, { requireAgentId: false });
    return hostedSellerAgentCard(this.service, config.origin);
  }

  async handleMessage(message: HostedSellerMessage): Promise<HostedSellerReply> {
    this.assertRequestBudget();
    if ("taskDescription" in message) {
      try {
        this.service.planner.parseTaskDescription(message.taskDescription);
      } catch {
        const required = Object.keys((this.service.planner.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
        throw new InvalidHostedSellerRequestError(`${this.label} requires ${this.service.planner.taskPrefix.replace(/:$/, "")} with ${required.join(", ")}.`);
      }
      if (
        message.terms.deliverables !== this.service.planner.terms.deliverables ||
        message.terms.quality_standards !== this.service.planner.terms.qualityStandards
      ) throw new HostedSellerJobNotReadyError(`The ${this.label} negotiation terms are not supported`);
      const current = await this.loadRuntime();
      const quote = await current.negotiation.negotiate({
        task_description: message.taskDescription,
        terms: message.terms,
      });
      return { ...quote.toDict(), provider_address: current.seller };
    }
    const current = await this.loadRuntime();
    const key = `${this.service.slug}:${message.jobId}`;
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

  private async submit(current: MainnetHostedSellerRuntime, jobId: bigint): Promise<HostedSellerReply> {
    if (busySigners.has(this.service.slug)) {
      throw new HostedSellerUnavailableError(`The Mainnet ${this.label} seller signer is busy; retry shortly`);
    }
    busySigners.add(this.service.slug);
    try {
      return await this.submitWithSigner(current, jobId);
    } finally {
      busySigners.delete(this.service.slug);
    }
  }

  private async submitWithSigner(current: MainnetHostedSellerRuntime, jobId: bigint): Promise<HostedSellerReply> {
    if (jobId > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new HostedSellerJobNotReadyError(`The funded ${this.label} Job ID is outside the supported range`);
    }
    const existingJob = await current.client.getJob(jobId);
    if (existingJob.status === JobStatus.SUBMITTED || existingJob.status === JobStatus.COMPLETED) {
      const policy = await current.client.router.jobPolicy(jobId);
      const deliverable = await this.assertBoundJob(current, jobId, existingJob, policy, false);
      if (!deliverable.verify(existingJob.deliverable)) {
        throw new HostedSellerJobNotReadyError(`The terminal ${this.label} deliverable does not match its deterministic result`);
      }
      return { acknowledged: true, already_submitted: true, job_id: Number(jobId) };
    }
    if (!this.writesEnabled()) {
      throw new HostedSellerUnavailableError(`Mainnet ${this.label} seller writes are disabled pending the recorded GO decision`);
    }
    const verification = await current.jobOps.verifyJob(Number(jobId));
    if (verification.valid !== true) {
      throw new HostedSellerJobNotReadyError(`The funded ${this.label} job failed signed-quote verification`);
    }
    const [job, policy] = await Promise.all([
      current.client.getJob(jobId),
      current.client.router.jobPolicy(jobId),
    ]);
    if (job.status !== JobStatus.FUNDED) throw new HostedSellerJobNotReadyError("notify_funded requires an onchain FUNDED job");
    const deliverable = await this.assertBoundJob(current, jobId, job, policy, true);
    if (!await mainnetImplementationPinsMatch(current.client.publicClient)) {
      throw new HostedSellerUnavailableError("The Mainnet Commerce or Router implementation is not allowlisted");
    }
    const signerBalance = await current.client.publicClient.getBalance({ address: current.seller });
    if (signerBalance < MINIMUM_SIGNER_GAS_BALANCE) {
      throw new HostedSellerUnavailableError(`The Mainnet ${this.label} seller gas reserve is below its safety floor`);
    }
    const deliverableHash = deliverable.manifestHash();
    if (!this.writesEnabled()) {
      throw new HostedSellerUnavailableError(`Mainnet ${this.label} seller writes are disabled pending the recorded GO decision`);
    }
    try {
      const result = await current.client.submit(jobId, deliverableHash, {
        deliverable_url: hostedSellerDeliverableUrl(current.origin, this.service.slug, jobId),
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
      throw new HostedSellerUnavailableError(`The Mainnet ${this.label} submission could not be reconciled onchain`);
    }
  }

  private async assertBoundJob(
    current: MainnetHostedSellerRuntime,
    jobId: bigint,
    job: Awaited<ReturnType<ERC8183Client["getJob"]>>,
    policy: `0x${string}`,
    requireSubmitWindow: boolean,
  ): Promise<DeliverableManifest> {
    const { parsed } = this.planForDescription(job.description);
    if (
      !isAddressEqual(job.provider, current.seller) ||
      !isAddressEqual(job.evaluator, ERC8183_MAINNET.router) ||
      !isAddressEqual(job.hook, ERC8183_MAINNET.router) ||
      !isAddressEqual(policy, ERC8183_MAINNET.policy) ||
      job.budget !== ERC8183_MAINNET.maximumDemoBudgetRaw ||
      parsed.price !== ERC8183_MAINNET.maximumDemoBudgetRaw.toString() ||
      !isAddress(parsed.currency) ||
      !isAddressEqual(parsed.currency, ERC8183_MAINNET.token)
    ) throw new HostedSellerJobNotReadyError(`The ${this.label} job is outside the Mainnet allowlist`);
    if (requireSubmitWindow) {
      const [disputeWindow, block] = await Promise.all([
        current.client.policy.disputeWindow(),
        current.client.publicClient.getBlock(),
      ]);
      if (job.expiredAt <= block.timestamp + disputeWindow + MINIMUM_SUBMIT_MARGIN_SECONDS) {
        throw new HostedSellerJobNotReadyError(`The funded ${this.label} job has less than ten minutes of submit margin`);
      }
    }
    return this.manifest(jobId, job.description);
  }

  async getDeliverable(jobId: bigint): Promise<HostedSellerDeliverable> {
    const current = await this.loadRuntime();
    const job = await current.client.getJob(jobId);
    if (!isAddressEqual(job.provider, current.seller) || (job.status !== JobStatus.SUBMITTED && job.status !== JobStatus.COMPLETED)) {
      throw new HostedSellerJobNotReadyError(`The ${this.label} deliverable is not available`);
    }
    const deliverable = this.manifest(jobId, job.description);
    if (!deliverable.verify(job.deliverable)) throw new HostedSellerUnavailableError(`The ${this.label} deliverable does not match chain state`);
    return { success: true, ...deliverable.toDict() };
  }
}
