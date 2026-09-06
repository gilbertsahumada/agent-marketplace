import "server-only";

import {
  buildJobDescription,
  ERC8183Client,
  JobStatus,
  NegotiationRequest,
  parseJobDescription,
  verifyQuoteSignature,
} from "@bnbagent/sdk/erc8183";
import { resolveNetwork } from "@bnbagent/sdk";
import { formatUnits, getAddress, isAddressEqual, maxUint256, type Address } from "viem";
import { fetchAgentCard, notifyFunded } from "../a2a.ts";
import type {
  Erc8183BuyerFacts,
  Erc8183JobFacts,
  Erc8183QuoteEnvelope,
  NormalizedErc8183Quote,
  NotifyFundedResult,
} from "../business/entities/erc8183-browser-spike.ts";
import type { Erc8183SpikeRepository } from "../data/repositories/erc8183-spike-repository.ts";
import type { Erc8183SpikeAllowlist } from "../business/policies/erc8183-spike-policy.ts";
import { Erc8183SpikeUnavailableError } from "../business/errors/erc8183-spike-errors.ts";
import { createSafeEndpointTransport } from "../verification/safe-http.ts";
import { ERC8183_MAINNET } from "./contracts.ts";
import { mainnetImplementationPinsMatch } from "./implementation-pins.ts";
import { quoteProvider } from "../shared/quote-provider.ts";

const ZERO_ADDRESS = getAddress("0x0000000000000000000000000000000000000000");
const MAX_QUOTE_TTL_SECONDS = 900;
const MIN_QUOTE_REMAINING_SECONDS = 1;
const registryAbi = [
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

type CatalogHireTarget = {
  agentId: number;
  endpoint: string;
  transport: string;
  requestHash: string;
  provider: Address;
};

function sameAddress(left: string, right: string): boolean {
  try { return isAddressEqual(getAddress(left), getAddress(right)); } catch { return false; }
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Erc8183SpikeUnavailableError(`Seller quote has an invalid ${field}`);
  }
  return value;
}

function networkConfig() {
  const base = resolveNetwork("bsc-mainnet");
  return {
    ...base,
    // Contract addresses are immutable marketplace pins. Only the RPC may be
    // selected by the deployment environment, and the implementation slots
    // are checked before any buyer facts or job state are trusted.
    rpcUrl: process.env.BSC_RPC_URL?.trim() || ERC8183_MAINNET.rpcUrl,
    registryContract: ERC8183_MAINNET.registry,
    commerceContract: ERC8183_MAINNET.commerce,
    routerContract: ERC8183_MAINNET.router,
    policyContract: ERC8183_MAINNET.policy,
  };
}

/**
 * Read-only ERC-8183 repository for any catalog seller with a verified buyer
 * quote. It deliberately owns no signer: all writes are built by the browser
 * and only signed by the connected buyer wallet.
 */
export class CatalogErc8183Repository implements Erc8183SpikeRepository {
  private seller: Address;
  // Historical reads use the contract range; payment preparation binds the verified price.
  private maximumBudgetRaw = maxUint256;
  private clientPromise: Promise<ERC8183Client> | null = null;

  constructor(private readonly target: CatalogHireTarget) {
    this.seller = target.provider;
  }

  get allowlist(): Erc8183SpikeAllowlist {
    return {
      chainId: 56,
      agentId: this.target.agentId,
      maximumBudgetRaw: this.maximumBudgetRaw,
      networkLabel: ERC8183_MAINNET.networkName,
      commerce: ERC8183_MAINNET.commerce,
      router: ERC8183_MAINNET.router,
      policy: ERC8183_MAINNET.policy,
      token: ERC8183_MAINNET.token,
      seller: this.seller,
    };
  }

  private async client(): Promise<ERC8183Client> {
    this.clientPromise ??= (async () => {
      const client = await ERC8183Client.create({ network: networkConfig() });
      if ((await client.publicClient.getChainId()) !== 56) {
        throw new Erc8183SpikeUnavailableError("RPC is not connected to BSC Mainnet");
      }
      if (!await mainnetImplementationPinsMatch(client.publicClient)) {
        throw new Erc8183SpikeUnavailableError("The Mainnet Commerce or Router implementation is not allowlisted");
      }
      return client;
    })();
    try { return await this.clientPromise; } catch (error) {
      this.clientPromise = null;
      throw error;
    }
  }

  async requestQuote(): Promise<NormalizedErc8183Quote> {
    throw new Erc8183SpikeUnavailableError("A buyer quote must be requested through the catalog transport");
  }

  async validateQuote(envelope: Erc8183QuoteEnvelope): Promise<NormalizedErc8183Quote> {
    try {
      const client = await this.client();
      const request = NegotiationRequest.fromDict(envelope.request as Record<string, unknown>);
      const requestHash = typeof envelope.request_hash === "string" ? envelope.request_hash.toLowerCase() : "";
      if (requestHash !== this.target.requestHash.toLowerCase() || request.computeHash().toLowerCase() !== requestHash) {
        throw new Erc8183SpikeUnavailableError("Quote request does not match the registered buyer quote");
      }
      const response = envelope.response as {
        accepted?: unknown;
        terms?: { price?: unknown; currency?: unknown; deliverables?: unknown; quality_standards?: unknown; evaluation_required?: unknown; evaluator_type?: unknown };
        negotiated_at?: unknown;
        quote_expires_at?: unknown;
      } | undefined;
      const price = response?.terms?.price;
      const currency = response?.terms?.currency;
      if (
        response?.accepted !== true ||
        typeof price !== "string" || price.length > 78 || !/^[1-9]\d*$/.test(price) || BigInt(price) > maxUint256 ||
        typeof currency !== "string" ||
        envelope.chain_id !== 56 ||
        typeof envelope.verifying_contract !== "string" ||
        !sameAddress(envelope.verifying_contract, ERC8183_MAINNET.commerce) ||
        response.terms?.deliverables !== request.terms.deliverables ||
        response.terms?.quality_standards !== request.terms.qualityStandards ||
        response.terms?.evaluation_required !== true ||
        response.terms?.evaluator_type !== "uma_oov3" ||
        !sameAddress(currency, ERC8183_MAINNET.token)
      ) throw new Erc8183SpikeUnavailableError("Seller quote does not match the marketplace contract policy");
      const provider = quoteProvider(envelope.provider_address, this.target.provider);
      if (!sameAddress(provider, this.target.provider)) {
        throw new Erc8183SpikeUnavailableError("Seller quote provider does not match the quote request");
      }

      const [agentWallet, owner, paymentToken, policyAllowed, tokenSymbol, tokenDecimals] = await Promise.all([
        client.publicClient.readContract({ address: ERC8183_MAINNET.registry, abi: registryAbi, functionName: "getAgentWallet", args: [BigInt(this.target.agentId)] }),
        client.publicClient.readContract({ address: ERC8183_MAINNET.registry, abi: registryAbi, functionName: "ownerOf", args: [BigInt(this.target.agentId)] }),
        client.paymentToken(),
        client.router.policyWhitelist(ERC8183_MAINNET.policy),
        client.tokenSymbol(),
        client.tokenDecimals(),
      ]);
      const wallet = getAddress(agentWallet);
      const registeredProvider = isAddressEqual(wallet, ZERO_ADDRESS) ? getAddress(owner) : wallet;
      if (isAddressEqual(registeredProvider, ZERO_ADDRESS) || !isAddressEqual(registeredProvider, provider)) {
        throw new Erc8183SpikeUnavailableError("Seller quote provider is not the ERC-8004 agent wallet");
      }
      if (!isAddressEqual(paymentToken, ERC8183_MAINNET.token) || !policyAllowed || tokenDecimals !== 18) {
        throw new Erc8183SpikeUnavailableError("The Mainnet Commerce allowlist is not active");
      }
      const signature = await verifyQuoteSignature({
        envelope,
        provider,
        publicClient: client.publicClient,
        expectedVerifyingContract: ERC8183_MAINNET.commerce,
      });
      if (!signature.valid || !isAddressEqual(signature.signer, provider)) {
        throw new Erc8183SpikeUnavailableError("Seller quote signature is invalid");
      }
      const negotiatedAt = integer(envelope.negotiated_at ?? response.negotiated_at, "negotiated_at");
      const quoteExpiresAt = integer(envelope.quote_expires_at ?? response.quote_expires_at, "quote_expires_at");
      const now = Math.floor(Date.now() / 1_000);
      if (
        negotiatedAt > now + 60 ||
        quoteExpiresAt <= now + MIN_QUOTE_REMAINING_SECONDS ||
        quoteExpiresAt <= negotiatedAt ||
        quoteExpiresAt - negotiatedAt > MAX_QUOTE_TTL_SECONDS
      ) throw new Erc8183SpikeUnavailableError("Seller quote is stale or has an invalid expiry");
      this.seller = provider;
      this.maximumBudgetRaw = BigInt(price);
      return {
        envelope,
        agentId: this.target.agentId,
        chainId: 56,
        provider,
        endpoint: this.target.endpoint,
        commerce: ERC8183_MAINNET.commerce,
        router: ERC8183_MAINNET.router,
        policy: ERC8183_MAINNET.policy,
        token: ERC8183_MAINNET.token,
        tokenSymbol,
        tokenDecimals,
        priceRaw: price,
        priceDisplay: formatUnits(BigInt(price), tokenDecimals),
        negotiatedAt,
        quoteExpiresAt,
        description: buildJobDescription(envelope),
      };
    } catch (error) {
      if (error instanceof Erc8183SpikeUnavailableError) throw error;
      throw new Erc8183SpikeUnavailableError("The seller quote could not be verified on BSC Mainnet");
    }
  }

  async getBuyerFacts(buyer: Address): Promise<Erc8183BuyerFacts> {
    try {
      const client = await this.client();
      const [nativeBalance, tokenBalance, allowance, disputeWindow, policyAllowlisted] = await Promise.all([
        client.publicClient.getBalance({ address: buyer }),
        client.tokenBalance(buyer),
        client.tokenAllowance(buyer, ERC8183_MAINNET.commerce),
        client.policy.disputeWindow(),
        client.router.policyWhitelist(ERC8183_MAINNET.policy),
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
      if (error instanceof Erc8183SpikeUnavailableError) throw error;
      throw new Erc8183SpikeUnavailableError("Buyer balances are temporarily unavailable");
    }
  }

  async getJob(jobId: bigint): Promise<Erc8183JobFacts> {
    try {
      const client = await this.client();
      const [job, policy] = await Promise.all([
        client.getJob(jobId),
        client.router.jobPolicy(jobId),
      ]);
      const parsed = parseJobDescription(job.description);
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
        deliverableUrl: null,
        result: null,
        quotedToken: parsed && typeof parsed.currency === "string" ? getAddress(parsed.currency) : null,
        quotedPriceRaw: parsed?.price ?? null,
        quoteExpiresAt: parsed?.quoteExpiresAt ?? null,
      };
    } catch (error) {
      if (error instanceof Erc8183SpikeUnavailableError) throw error;
      throw new Erc8183SpikeUnavailableError("The onchain job state is temporarily unavailable");
    }
  }

  async notifyFunded(jobId: bigint): Promise<NotifyFundedResult> {
    const before = await this.getJob(jobId);
    if (before.status === "SUBMITTED" || before.status === "COMPLETED") {
      return { acknowledged: true, alreadySubmitted: true, job: before };
    }
    if (before.status !== "FUNDED") {
      throw new Erc8183SpikeUnavailableError("notify_funded requires an onchain FUNDED job");
    }

    // HTTP and MCP sellers may watch the chain themselves. We cannot invent a
    // notification method for them, so leave the job honestly in “Waiting for
    // seller” instead of claiming that a result was submitted.
    if (this.target.transport !== "a2a") {
      return { acknowledged: true, alreadySubmitted: false, job: before };
    }

    const origin = new URL(this.target.endpoint).origin;
    const transport = await createSafeEndpointTransport(origin, { timeoutMs: 30_000, maxResponseBytes: 64 * 1024 });
    try {
      const card = await fetchAgentCard(this.target.endpoint, null, transport.fetch);
      if (!card.skills.some((skill: { id: string }) => skill.id === "notify_funded")) {
        return { acknowledged: true, alreadySubmitted: false, job: before };
      }
      const response = await notifyFunded(card.url, jobId, null, transport.fetch);
      const after = await this.getJob(jobId);
      const transactionHash = typeof response.transaction_hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(response.transaction_hash)
        ? response.transaction_hash as `0x${string}`
        : undefined;
      return {
        acknowledged: true,
        alreadySubmitted: after.status === "SUBMITTED" || after.status === "COMPLETED",
        ...(transactionHash ? { sellerTransactionHash: transactionHash } : {}),
        job: after,
      };
    } catch (error) {
      // A notification can time out after the seller has already submitted.
      try {
        const current = await this.getJob(jobId);
        if (current.status === "SUBMITTED" || current.status === "COMPLETED") {
          return { acknowledged: true, alreadySubmitted: true, job: current };
        }
      } catch { /* Keep the original failure if the chain is unavailable too. */ }
      if (error instanceof Erc8183SpikeUnavailableError) throw error;
      throw new Erc8183SpikeUnavailableError("The seller notification could not be completed; the funded job remains onchain");
    } finally {
      await transport.close();
    }
  }
}

export type { CatalogHireTarget };
