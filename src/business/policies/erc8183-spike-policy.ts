import { getAddress, isAddressEqual, type Address } from "viem";
import {
  ERC8183_SPIKE_AGENT_ID,
  ERC8183_SPIKE_CHAIN_ID,
  ERC8183_SPIKE_MAX_BUDGET,
  type Erc8183JobFacts,
  type NormalizedErc8183Quote,
} from "../entities/erc8183-browser-spike.js";
import {
  Erc8183JobNotReadyError,
  Erc8183QuoteRejectedError,
} from "../errors/erc8183-spike-errors.js";

export interface Erc8183SpikeAllowlist {
  commerce: Address;
  router: Address;
  policy: Address;
  token: Address;
  seller: Address;
}

function sameAddress(left: string, right: string): boolean {
  try {
    return isAddressEqual(getAddress(left), getAddress(right));
  } catch {
    return false;
  }
}

export function assertAllowedQuote(
  quote: NormalizedErc8183Quote,
  allowlist: Erc8183SpikeAllowlist,
  nowSeconds: number,
): void {
  if (quote.agentId !== ERC8183_SPIKE_AGENT_ID || quote.chainId !== ERC8183_SPIKE_CHAIN_ID) {
    throw new Erc8183QuoteRejectedError("Quote is not bound to the fixed Testnet fixture");
  }
  if (!sameAddress(quote.commerce, allowlist.commerce)) {
    throw new Erc8183QuoteRejectedError("Quote uses an unapproved Commerce contract");
  }
  if (!sameAddress(quote.router, allowlist.router) || !sameAddress(quote.policy, allowlist.policy)) {
    throw new Erc8183QuoteRejectedError("Quote uses an unapproved evaluator configuration");
  }
  if (!sameAddress(quote.token, allowlist.token)) {
    throw new Erc8183QuoteRejectedError("Quote uses an unapproved payment token");
  }
  if (!sameAddress(quote.provider, allowlist.seller)) {
    throw new Erc8183QuoteRejectedError("Quote uses an unapproved seller");
  }
  if (!/^\d+$/.test(quote.priceRaw) || BigInt(quote.priceRaw) <= 0n) {
    throw new Erc8183QuoteRejectedError("Quote budget must be a positive raw-unit integer");
  }
  if (BigInt(quote.priceRaw) > ERC8183_SPIKE_MAX_BUDGET) {
    throw new Erc8183QuoteRejectedError("Quote exceeds the browser-spike budget limit");
  }
  if (quote.quoteExpiresAt <= nowSeconds) {
    throw new Erc8183QuoteRejectedError("Quote has expired");
  }
}

export function assertExpectedJob(
  job: Erc8183JobFacts,
  expected: { buyer: Address; seller: Address; allowlist: Erc8183SpikeAllowlist },
  nowSeconds = Math.floor(Date.now() / 1_000),
): void {
  if (job.chainId !== ERC8183_SPIKE_CHAIN_ID) {
    throw new Erc8183JobNotReadyError("Job is not on BSC Testnet");
  }
  if (
    !sameAddress(job.buyer, expected.buyer) ||
    !sameAddress(job.provider, expected.seller) ||
    !sameAddress(job.provider, expected.allowlist.seller)
  ) {
    throw new Erc8183JobNotReadyError("Job buyer or seller does not match the prepared hire");
  }
  if (!sameAddress(job.evaluator, expected.allowlist.router) || !sameAddress(job.policy, expected.allowlist.policy)) {
    throw new Erc8183JobNotReadyError("Job evaluator policy is not allowlisted");
  }
  if (BigInt(job.budgetRaw) <= 0n || BigInt(job.budgetRaw) > ERC8183_SPIKE_MAX_BUDGET) {
    throw new Erc8183JobNotReadyError("Job budget is outside the spike limit");
  }
  if (
    job.quotedToken === null ||
    !sameAddress(job.quotedToken, expected.allowlist.token) ||
    job.quotedPriceRaw !== job.budgetRaw
  ) {
    throw new Erc8183JobNotReadyError("Job description does not match its allowlisted token and budget");
  }
  if (BigInt(job.deadline) <= BigInt(nowSeconds)) {
    throw new Erc8183JobNotReadyError("Job deadline has expired");
  }
}
