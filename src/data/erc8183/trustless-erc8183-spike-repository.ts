import {
  ERC8183Client,
  DeliverableManifest,
  JobStatus,
  buildJobDescription,
  parseJobDescription,
  verifyQuoteSignature,
} from "@bnbagent/sdk/erc8183";
import { formatUnits, getAddress, isAddressEqual, type Address } from "viem";
import { fetchAgentCard, negotiate, notifyFunded, type QuoteEnvelope } from "../../a2a.js";
import type {
  Erc8183BuyerFacts,
  Erc8183JobFacts,
  Erc8183QuoteEnvelope,
  NormalizedErc8183Quote,
  NotifyFundedResult,
} from "../../business/entities/erc8183-browser-spike.js";
import {
  Erc8183SpikeDisabledError,
  Erc8183SpikeUnavailableError,
} from "../../business/errors/erc8183-spike-errors.js";
import type { Erc8183SpikeAllowlist } from "../../business/policies/erc8183-spike-policy.js";
import { resolveIdentity } from "../../identity.js";
import { GATE1_NETWORK } from "../../network.js";
import type { Erc8183SpikeRepository } from "../repositories/erc8183-spike-repository.js";
import { ERC8183_TESTNET } from "./contracts.js";
import { loadErc8183BrowserSpikeConfig } from "./spike-config.js";

type QuoteResponse = {
  accepted?: unknown;
  terms?: { price?: unknown; currency?: unknown };
  negotiated_at?: unknown;
  quote_expires_at?: unknown;
};

const notificationInflight = new Map<string, Promise<NotifyFundedResult>>();

function publicFailure(error: unknown): never {
  if (error instanceof Erc8183SpikeDisabledError || error instanceof Erc8183SpikeUnavailableError) throw error;
  throw new Erc8183SpikeUnavailableError();
}

function sameAddress(left: string, right: string): boolean {
  try {
    return isAddressEqual(getAddress(left), getAddress(right));
  } catch {
    return false;
  }
}

function integerTimestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Erc8183SpikeUnavailableError(`Seller quote has an invalid ${field}`);
  }
  return value;
}

function publicDeliverableUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchVerifiedResult(
  urlValue: string | null,
  job: { id: bigint; deliverable: `0x${string}` },
): Promise<Erc8183JobFacts["result"]> {
  if (!urlValue) return null;
  const config = loadErc8183BrowserSpikeConfig();
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== config.sellerOrigin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) return null;
  try {
    const response = await fetch(url, {
      headers: config.bearerToken ? { authorization: `Bearer ${config.bearerToken}` } : {},
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 64 * 1024) return null;
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 64 * 1024) return null;
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const envelope = raw as Record<string, unknown>;
    if (envelope.success !== true) return null;
    const manifest = DeliverableManifest.fromDict(envelope);
    if (
      manifest.jobId !== Number(job.id) ||
      manifest.chainId !== ERC8183_TESTNET.chainId ||
      !sameAddress(manifest.contracts.commerce ?? "", ERC8183_TESTNET.commerce) ||
      !sameAddress(manifest.contracts.router ?? "", ERC8183_TESTNET.router) ||
      !sameAddress(manifest.contracts.policy ?? "", ERC8183_TESTNET.policy) ||
      !manifest.verify(job.deliverable) ||
      typeof manifest.response.content !== "string" ||
      manifest.response.content.length > 8_192
    ) return null;
    return {
      content: manifest.response.content,
      contentType: manifest.response.contentType ?? null,
      hashVerified: true,
    };
  } catch {
    return null;
  }
}

export class TrustlessErc8183SpikeRepository implements Erc8183SpikeRepository {
  readonly allowlist: Erc8183SpikeAllowlist = {
    commerce: ERC8183_TESTNET.commerce,
    router: ERC8183_TESTNET.router,
    policy: ERC8183_TESTNET.policy,
    token: ERC8183_TESTNET.token,
    seller: ERC8183_TESTNET.seller,
  };

  private async client(): Promise<ERC8183Client> {
    loadErc8183BrowserSpikeConfig();
    const client = await ERC8183Client.create({ network: GATE1_NETWORK });
    if ((await client.publicClient.getChainId()) !== ERC8183_TESTNET.chainId) {
      throw new Erc8183SpikeUnavailableError("RPC is not connected to BSC Testnet");
    }
    return client;
  }

  private async seller(client: ERC8183Client) {
    const config = loadErc8183BrowserSpikeConfig();
    const identity = await resolveIdentity(client.publicClient, ERC8183_TESTNET.agentId);
    if (!sameAddress(identity.agentWallet, ERC8183_TESTNET.seller)) {
      throw new Erc8183SpikeUnavailableError("The fixture Agent wallet no longer matches the allowlist");
    }
    if (new URL(identity.a2aEndpoint).origin !== config.sellerOrigin) {
      throw new Erc8183SpikeUnavailableError("The fixture Agent origin does not match the server allowlist");
    }
    const card = await fetchAgentCard(identity.a2aEndpoint, config.bearerToken);
    const skills = new Set(card.skills.map(({ id }) => id));
    if (!skills.has("negotiate-erc8183-job") || !skills.has("notify_funded")) {
      throw new Erc8183SpikeUnavailableError("Seller Agent Card does not advertise the required skills");
    }
    if (new URL(card.url).origin !== config.sellerOrigin) {
      throw new Erc8183SpikeUnavailableError("Seller message URL does not match the server allowlist");
    }
    return { config, identity, card };
  }

  async requestQuote(): Promise<NormalizedErc8183Quote> {
    try {
      const client = await this.client();
      const { config, card } = await this.seller(client);
      const envelope = await negotiate(card.url, config.bearerToken);
      return this.normalizeAndVerify(client, card.url, envelope);
    } catch (error) {
      return publicFailure(error);
    }
  }

  async validateQuote(envelope: Erc8183QuoteEnvelope): Promise<NormalizedErc8183Quote> {
    try {
      const client = await this.client();
      const { card } = await this.seller(client);
      return this.normalizeAndVerify(client, card.url, envelope as QuoteEnvelope);
    } catch (error) {
      return publicFailure(error);
    }
  }

  private async normalizeAndVerify(
    client: ERC8183Client,
    endpoint: string,
    envelope: QuoteEnvelope,
  ): Promise<NormalizedErc8183Quote> {
    const response = envelope.response as QuoteResponse | undefined;
    const price = response?.terms?.price;
    const currency = response?.terms?.currency;
    const chainId = envelope.chain_id;
    const verifyingContract = envelope.verifying_contract;
    if (
      response?.accepted !== true ||
      typeof price !== "string" ||
      !/^\d+$/.test(price) ||
      typeof currency !== "string" ||
      chainId !== ERC8183_TESTNET.chainId ||
      typeof verifyingContract !== "string" ||
      !sameAddress(verifyingContract, ERC8183_TESTNET.commerce)
    ) {
      throw new Erc8183SpikeUnavailableError("Seller quote is not bound to the allowlisted Testnet contract");
    }
    const provider = getAddress(envelope.provider_address);
    if (!sameAddress(provider, ERC8183_TESTNET.seller) || !sameAddress(currency, ERC8183_TESTNET.token)) {
      throw new Erc8183SpikeUnavailableError("Seller quote provider or token is not allowlisted");
    }
    const token = await client.paymentToken();
    if (!sameAddress(token, ERC8183_TESTNET.token)) {
      throw new Erc8183SpikeUnavailableError("Commerce payment token no longer matches the allowlist");
    }
    const signature = await verifyQuoteSignature({
      envelope,
      provider,
      publicClient: client.publicClient,
      expectedVerifyingContract: ERC8183_TESTNET.commerce,
    });
    if (!signature.valid) {
      throw new Erc8183SpikeUnavailableError("Seller quote signature is invalid");
    }
    const negotiatedAt = integerTimestamp(
      envelope.negotiated_at ?? response.negotiated_at,
      "negotiated_at",
    );
    const quoteExpiresAt = integerTimestamp(
      envelope.quote_expires_at ?? response.quote_expires_at,
      "quote_expires_at",
    );
    const [tokenSymbol, tokenDecimals] = await Promise.all([
      client.tokenSymbol(),
      client.tokenDecimals(),
    ]);
    return {
      envelope,
      agentId: ERC8183_TESTNET.agentId,
      chainId: ERC8183_TESTNET.chainId,
      provider,
      endpoint: new URL(endpoint).origin,
      commerce: ERC8183_TESTNET.commerce,
      router: ERC8183_TESTNET.router,
      policy: ERC8183_TESTNET.policy,
      token: ERC8183_TESTNET.token,
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
      const [nativeBalance, tokenBalance, allowance, disputeWindow, policyAllowlisted] = await Promise.all([
        client.publicClient.getBalance({ address: buyer }),
        client.tokenBalance(buyer),
        client.tokenAllowance(buyer, ERC8183_TESTNET.commerce),
        client.policy.disputeWindow(),
        client.router.policyWhitelist(ERC8183_TESTNET.policy),
      ]);
      return {
        buyer,
        nativeBalanceRaw: nativeBalance.toString(),
        tokenBalanceRaw: tokenBalance.toString(),
        allowanceRaw: allowance.toString(),
        disputeWindowSeconds: disputeWindow.toString(),
        policyAllowlisted,
      };
    } catch (error) {
      return publicFailure(error);
    }
  }

  async getJob(jobId: bigint): Promise<Erc8183JobFacts> {
    try {
      const client = await this.client();
      const job = await client.getJob(jobId);
      const policy = await client.router.jobPolicy(jobId);
      const parsedDescription = parseJobDescription(job.description);
      const deliverableUrl =
        job.status === JobStatus.SUBMITTED || job.status === JobStatus.COMPLETED
          ? await client.getDeliverableUrl(jobId)
          : null;
      const result = await fetchVerifiedResult(deliverableUrl, job);
      return {
        chainId: ERC8183_TESTNET.chainId,
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
        deliverableUrl: publicDeliverableUrl(deliverableUrl),
        result,
        quotedToken: parsedDescription ? getAddress(parsedDescription.currency) : null,
        quotedPriceRaw: parsedDescription?.price ?? null,
        quoteExpiresAt: parsedDescription?.quoteExpiresAt ?? null,
      };
    } catch (error) {
      return publicFailure(error);
    }
  }

  async notifyFunded(jobId: bigint): Promise<NotifyFundedResult> {
    const key = jobId.toString();
    const existing = notificationInflight.get(key);
    if (existing) return existing;
    const operation = (async () => {
      try {
        const client = await this.client();
        const { config, card } = await this.seller(client);
        await notifyFunded(card.url, jobId, config.bearerToken);
        const job = await this.getJob(jobId);
        if (job.status !== "SUBMITTED" && job.status !== "COMPLETED") {
          throw new Erc8183SpikeUnavailableError("Seller acknowledged without an onchain submission");
        }
        return { acknowledged: true as const, alreadySubmitted: false, job };
      } catch (error) {
        return publicFailure(error);
      }
    })();
    notificationInflight.set(key, operation);
    try {
      return await operation;
    } finally {
      notificationInflight.delete(key);
    }
  }
}
