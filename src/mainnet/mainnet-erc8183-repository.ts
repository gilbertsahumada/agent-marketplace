import "server-only";
import {
  DeliverableManifest,
  ERC8183Client,
  JobStatus,
  NegotiationHandler,
  NegotiationRequest,
  TermSpecification,
  buildJobDescription,
  parseJobDescription,
  verifyQuoteSignature,
} from "@bnbagent/sdk/erc8183";
import { resolveNetwork } from "@bnbagent/sdk";
import { formatUnits, getAddress, isAddressEqual, type Address } from "viem";
import { fetchAgentCard, notifyFunded, sendSkill, type QuoteEnvelope } from "../a2a.ts";
import { hasErc8183SellerSkills, negotiationSkillForCard } from "../erc8183/skills.ts";
import type {
  Erc8183BuyerFacts,
  Erc8183JobFacts,
  Erc8183QuoteEnvelope,
  NormalizedErc8183Quote,
  NotifyFundedResult,
} from "../business/entities/erc8183-browser-spike.ts";
import { Erc8183SpikeDisabledError, Erc8183SpikeUnavailableError } from "../business/errors/erc8183-spike-errors.ts";
import { GRID_CANONICAL_INPUT, GRID_NEGOTIATION_TERMS, gridTaskDescription } from "../business/policies/grid-plan-policy.ts";
import type { Erc8183SpikeAllowlist } from "../business/policies/erc8183-spike-policy.ts";
import type { Erc8183SpikeRepository } from "../data/repositories/erc8183-spike-repository.ts";
import { resolveIdentity } from "../identity.ts";
import { readBoundedJson } from "../verification/bounded-json.ts";
import { createSafeEndpointTransport } from "../verification/safe-http.ts";
import { loadMainnetBrowserDemoConfig } from "./browser-demo-config.ts";
import { ERC8183_MAINNET } from "./contracts.ts";
import { mainnetImplementationPinsMatch } from "./implementation-pins.ts";

const GRID_TERMS = new TermSpecification({
  deliverables: GRID_NEGOTIATION_TERMS.deliverables,
  qualityStandards: GRID_NEGOTIATION_TERMS.qualityStandards,
});
const GRID_TASK = gridTaskDescription(GRID_CANONICAL_INPUT);
const GRID_REQUEST = new NegotiationRequest({ taskDescription: GRID_TASK, terms: GRID_TERMS });
const GRID_REQUEST_HASH = GRID_REQUEST.computeHash().toLowerCase();
const inflightNotifications = new Map<string, Promise<NotifyFundedResult>>();

type QuoteResponse = {
  accepted?: unknown;
  terms?: { price?: unknown; currency?: unknown; deliverables?: unknown; quality_standards?: unknown };
  negotiated_at?: unknown;
  quote_expires_at?: unknown;
};

function sameAddress(left: string, right: string): boolean {
  try { return isAddressEqual(getAddress(left), getAddress(right)); } catch { return false; }
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Erc8183SpikeUnavailableError(`Seller quote has an invalid ${field}`);
  }
  return value;
}

function publicFailure(error: unknown): never {
  if (error instanceof Erc8183SpikeDisabledError || error instanceof Erc8183SpikeUnavailableError) throw error;
  throw new Erc8183SpikeUnavailableError();
}

async function withSellerTransport<T>(origin: string, operation: (fetchImpl: typeof fetch) => Promise<T>): Promise<T> {
  const transport = await createSafeEndpointTransport(origin, { timeoutMs: 30_000, maxResponseBytes: 64 * 1024 });
  try { return await operation(transport.fetch); } finally { await transport.close(); }
}

async function verifiedResult(
  origin: string,
  job: { id: bigint; deliverable: `0x${string}` },
): Promise<Erc8183JobFacts["result"]> {
  const url = `${origin}/api/sellers/grid/job/${job.id}/response`;
  try {
    return await withSellerTransport(origin, async (fetchImpl) => {
      const response = await fetchImpl(url, { redirect: "error" });
      if (!response.ok) return null;
      const raw = await readBoundedJson(response, {
        maxBytes: 64 * 1024,
        tooLargeMessage: "Grid deliverable exceeded the allowed size",
        invalidJsonMessage: "Grid deliverable was not valid JSON",
      });
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || (raw as Record<string, unknown>).success !== true) return null;
      const manifest = DeliverableManifest.fromDict(raw as Record<string, unknown>);
      if (
        manifest.jobId !== Number(job.id) ||
        manifest.chainId !== 56 ||
        !sameAddress(manifest.contracts.commerce ?? "", ERC8183_MAINNET.commerce) ||
        !sameAddress(manifest.contracts.router ?? "", ERC8183_MAINNET.router) ||
        !sameAddress(manifest.contracts.policy ?? "", ERC8183_MAINNET.policy) ||
        !manifest.verify(job.deliverable) ||
        typeof manifest.response.content !== "string" ||
        manifest.response.content.length > 32_000
      ) return null;
      return { content: manifest.response.content, contentType: manifest.response.contentType ?? null, hashVerified: true };
    });
  } catch { return null; }
}

export class MainnetErc8183Repository implements Erc8183SpikeRepository {
  get allowlist(): Erc8183SpikeAllowlist {
    const { deployment } = loadMainnetBrowserDemoConfig();
    return {
      chainId: deployment.chainId,
      agentId: deployment.agentId,
      maximumBudgetRaw: deployment.maximumBudgetRaw,
      networkLabel: deployment.networkName,
      commerce: deployment.commerce,
      router: deployment.router,
      policy: deployment.policy,
      token: deployment.token,
      seller: deployment.seller,
    };
  }

  private async client(): Promise<ERC8183Client> {
    loadMainnetBrowserDemoConfig();
    const client = await ERC8183Client.create({ network: resolveNetwork("bsc-mainnet") });
    if ((await client.publicClient.getChainId()) !== 56) throw new Erc8183SpikeUnavailableError("RPC is not connected to BSC Mainnet");
    if (!await mainnetImplementationPinsMatch(client.publicClient)) {
      throw new Erc8183SpikeUnavailableError("The Mainnet Commerce or Router implementation is not allowlisted");
    }
    return client;
  }

  private async seller(client: ERC8183Client) {
    const config = loadMainnetBrowserDemoConfig();
    const identity = await resolveIdentity(client.publicClient, config.deployment.agentId, {
      chainId: 56,
      registry: ERC8183_MAINNET.registry,
    });
    if (!sameAddress(identity.agentWallet, config.deployment.seller)) {
      throw new Erc8183SpikeUnavailableError("The registered Mainnet Agent wallet does not match the allowlist");
    }
    if (new URL(identity.a2aEndpoint).origin !== config.sellerOrigin) {
      throw new Erc8183SpikeUnavailableError("The registered Mainnet Agent origin does not match the allowlist");
    }
    const card = await withSellerTransport(config.sellerOrigin, (fetchImpl) => fetchAgentCard(identity.a2aEndpoint, null, fetchImpl));
    if (new URL(card.url).origin !== config.sellerOrigin || !hasErc8183SellerSkills(card.skills)) {
      throw new Erc8183SpikeUnavailableError("The Mainnet Agent Card does not match the required seller protocol");
    }
    return { config, card, negotiationSkill: negotiationSkillForCard(card.skills)! };
  }

  async requestQuote(): Promise<NormalizedErc8183Quote> {
    try {
      const client = await this.client();
      const { config, card, negotiationSkill } = await this.seller(client);
      const envelope = await withSellerTransport(config.sellerOrigin, (fetchImpl) => sendSkill(card.url, {
        skill: negotiationSkill,
        task_description: GRID_TASK,
        terms: GRID_TERMS.toDict(),
      }, null, fetchImpl)) as QuoteEnvelope;
      return this.normalizeAndVerify(client, card.url, envelope);
    } catch (error) { return publicFailure(error); }
  }

  async validateQuote(envelope: Erc8183QuoteEnvelope): Promise<NormalizedErc8183Quote> {
    try {
      const client = await this.client();
      const { card } = await this.seller(client);
      return this.normalizeAndVerify(client, card.url, envelope as QuoteEnvelope);
    } catch (error) { return publicFailure(error); }
  }

  private async normalizeAndVerify(client: ERC8183Client, endpoint: string, envelope: QuoteEnvelope): Promise<NormalizedErc8183Quote> {
    const config = loadMainnetBrowserDemoConfig();
    const deployment = config.deployment;
    const response = envelope.response as QuoteResponse | undefined;
    const requestHash = typeof envelope.request_hash === "string" ? envelope.request_hash.toLowerCase() : "";
    let embeddedRequestHash = "";
    try { embeddedRequestHash = NegotiationRequest.fromDict(envelope.request as Record<string, unknown>).computeHash().toLowerCase(); } catch { /* rejected below */ }
    const price = response?.terms?.price;
    const currency = response?.terms?.currency;
    if (
      response?.accepted !== true ||
      requestHash !== GRID_REQUEST_HASH ||
      embeddedRequestHash !== GRID_REQUEST_HASH ||
      response.terms?.deliverables !== GRID_TERMS.deliverables ||
      response.terms?.quality_standards !== GRID_TERMS.qualityStandards ||
      typeof price !== "string" || !/^\d+$/.test(price) ||
      typeof currency !== "string" ||
      envelope.chain_id !== 56 ||
      typeof envelope.verifying_contract !== "string" ||
      !sameAddress(envelope.verifying_contract, deployment.commerce) ||
      !sameAddress(envelope.provider_address, deployment.seller) ||
      !sameAddress(currency, deployment.token)
    ) throw new Erc8183SpikeUnavailableError("Seller quote is not bound to the fixed Mainnet Grid request");
    const negotiatedAt = timestamp(envelope.negotiated_at ?? response.negotiated_at, "negotiated_at");
    const quoteExpiresAt = timestamp(envelope.quote_expires_at ?? response.quote_expires_at, "quote_expires_at");
    const now = Math.floor(Date.now() / 1_000);
    if (negotiatedAt > now + 60 || now - negotiatedAt > 60 || quoteExpiresAt <= now || quoteExpiresAt - negotiatedAt > NegotiationHandler.MAX_QUOTE_TTL_SECONDS) {
      throw new Erc8183SpikeUnavailableError("Seller quote is stale or exceeds the SDK validity window");
    }
    const [paymentToken, policyAllowed, signature, tokenSymbol, tokenDecimals] = await Promise.all([
      client.paymentToken(),
      client.router.policyWhitelist(deployment.policy),
      verifyQuoteSignature({ envelope, provider: deployment.seller, publicClient: client.publicClient, expectedVerifyingContract: deployment.commerce }),
      client.tokenSymbol(),
      client.tokenDecimals(),
    ]);
    if (!sameAddress(paymentToken, deployment.token) || !policyAllowed || !signature.valid || BigInt(price) > deployment.maximumBudgetRaw || BigInt(price) <= 0n) {
      throw new Erc8183SpikeUnavailableError("Seller quote failed the Mainnet contract allowlist");
    }
    return {
      envelope,
      agentId: deployment.agentId,
      chainId: 56,
      provider: deployment.seller,
      endpoint: new URL(endpoint).origin,
      commerce: deployment.commerce,
      router: deployment.router,
      policy: deployment.policy,
      token: deployment.token,
      tokenSymbol,
      tokenDecimals,
      priceRaw: price,
      priceDisplay: formatUnits(BigInt(price), tokenDecimals),
      negotiatedAt,
      quoteExpiresAt,
      description: buildJobDescription(envelope),
    };
  }

  async getBuyerFacts(buyer: Address): Promise<Erc8183BuyerFacts> {
    try {
      const client = await this.client();
      const deployment = loadMainnetBrowserDemoConfig().deployment;
      const [nativeBalance, tokenBalance, allowance, disputeWindow, policyAllowlisted] = await Promise.all([
        client.publicClient.getBalance({ address: buyer }),
        client.tokenBalance(buyer),
        client.tokenAllowance(buyer, deployment.commerce),
        client.policy.disputeWindow(),
        client.router.policyWhitelist(deployment.policy),
      ]);
      return { buyer, nativeBalanceRaw: nativeBalance.toString(), tokenBalanceRaw: tokenBalance.toString(), allowanceRaw: allowance.toString(), disputeWindowSeconds: disputeWindow.toString(), policyAllowlisted };
    } catch (error) { return publicFailure(error); }
  }

  async getJob(jobId: bigint): Promise<Erc8183JobFacts> {
    try {
      const client = await this.client();
      const config = loadMainnetBrowserDemoConfig();
      const job = await client.getJob(jobId);
      const policy = await client.router.jobPolicy(jobId);
      const parsed = parseJobDescription(job.description);
      const deliverableUrl = job.status === JobStatus.SUBMITTED || job.status === JobStatus.COMPLETED
        ? `${config.sellerOrigin}/api/sellers/grid/job/${jobId}/response`
        : null;
      return {
        chainId: 56,
        jobId: jobId.toString(),
        buyer: job.client,
        provider: job.provider,
        evaluator: job.evaluator,
        policy,
        description: job.description,
        budgetRaw: job.budget.toString(),
        deadline: job.expiredAt.toString(),
        status: JobStatus[job.status] as Erc8183JobFacts["status"],
        submittedAt: job.submittedAt.toString(),
        deliverableHash: job.deliverable,
        deliverableUrl,
        result: await verifiedResult(config.sellerOrigin, job),
        quotedToken: parsed ? getAddress(parsed.currency) : null,
        quotedPriceRaw: parsed?.price ?? null,
        quoteExpiresAt: parsed?.quoteExpiresAt ?? null,
      };
    } catch (error) { return publicFailure(error); }
  }

  async notifyFunded(jobId: bigint): Promise<NotifyFundedResult> {
    const key = jobId.toString();
    const existing = inflightNotifications.get(key);
    if (existing) return existing;
    const operation = (async () => {
      try {
        const client = await this.client();
        const { config, card } = await this.seller(client);
        const before = await this.getJob(jobId);
        if (before.status === "SUBMITTED" || before.status === "COMPLETED") return { acknowledged: true as const, alreadySubmitted: true, job: before };
        if (before.status !== "FUNDED") throw new Erc8183SpikeUnavailableError("notify_funded requires a FUNDED Mainnet job");
        let notification: Awaited<ReturnType<typeof notifyFunded>>;
        try {
          notification = await withSellerTransport(config.sellerOrigin, (fetchImpl) => notifyFunded(card.url, jobId, null, fetchImpl));
        } catch {
          const reconciled = await this.getJob(jobId);
          if (reconciled.status === "SUBMITTED" || reconciled.status === "COMPLETED") {
            return { acknowledged: true as const, alreadySubmitted: true, job: reconciled };
          }
          throw new Erc8183SpikeUnavailableError("The Mainnet seller notification could not be reconciled onchain");
        }
        const job = await this.getJob(jobId);
        if (job.status !== "SUBMITTED" && job.status !== "COMPLETED") throw new Erc8183SpikeUnavailableError("Seller acknowledged without an onchain submission");
        const transactionHash = notification.transaction_hash;
        return {
          acknowledged: true as const,
          alreadySubmitted: false,
          ...(typeof transactionHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(transactionHash)
            ? { sellerTransactionHash: transactionHash as `0x${string}` }
            : {}),
          job,
        };
      } catch (error) { return publicFailure(error); }
    })();
    inflightNotifications.set(key, operation);
    try { return await operation; } finally { inflightNotifications.delete(key); }
  }
}
