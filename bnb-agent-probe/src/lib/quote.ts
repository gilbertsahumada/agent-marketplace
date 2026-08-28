import {
  NegotiationRequest,
  NegotiationResponse,
  ReasonCode,
  verifyQuoteSignature,
  type QuoteSigVerdict,
  type VerifyQuoteSignatureOpts,
} from "@bnbagent/sdk/erc8183";
import {
  getAddress,
  isAddress,
  type Address,
  type PublicClient,
} from "viem";

import { GRID_PROBE_REQUEST_HASH } from "./terms";

const MAX_QUOTE_AGE_SECONDS = 60;
const MAX_QUOTE_FUTURE_SECONDS = 60;
const MAX_QUOTE_TTL_SECONDS = 900;
const GRID_DELIVERABLES =
  "Deterministic Grid plan JSON with levels, allocation, triggers and assumptions";
const GRID_QUALITY_STANDARDS =
  "Deterministic output, no order execution and no custody";
const REJECTION_CODES = new Set<string>(Object.values(ReasonCode));

export class QuoteValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "QuoteValidationError";
  }
}

export interface ProbeQuoteContext {
  readonly provider: Address;
  readonly blockNumber: bigint;
  readonly publicClient: PublicClient;
  readonly commerce: Address;
  readonly router: Address;
  readonly policy: Address;
  readonly paymentToken: Address;
  readonly tokenDecimals: number;
  readonly policyAllowlisted: boolean;
  readonly nowSeconds: number;
}

export type ProbeQuoteVerdict =
  | {
      readonly outcome: "quote_rejected";
      readonly errorCode: string;
      readonly requestHash: string;
    }
  | {
      readonly outcome: "quote_verified";
      readonly provider: Address;
      readonly signer: Address;
      readonly signatureMethod: "eip191" | "erc1271";
      readonly requestHash: string;
      readonly negotiationHash: string;
      readonly priceRaw: string;
      readonly currency: Address;
      readonly decimals: number;
      readonly quoteNegotiatedAt: number;
      readonly quoteExpiresAt: number;
    };

type QuoteVerifier = (options: VerifyQuoteSignatureOpts) => Promise<QuoteSigVerdict>;

export async function validateProbeQuote(
  envelope: Record<string, unknown>,
  context: ProbeQuoteContext,
  verify: QuoteVerifier = verifyQuoteSignature,
): Promise<ProbeQuoteVerdict> {
  const request = record(envelope.request, "QUOTE_REQUEST");
  let computedRequestHash: string;
  try {
    computedRequestHash = NegotiationRequest.fromDict(request).computeHash().toLowerCase();
  } catch {
    throw new QuoteValidationError("QUOTE_REQUEST");
  }
  const requestHash = hash(envelope.request_hash, "QUOTE_REQUEST_HASH");
  if (requestHash !== GRID_PROBE_REQUEST_HASH || computedRequestHash !== GRID_PROBE_REQUEST_HASH) {
    throw new QuoteValidationError("QUOTE_REQUEST_HASH");
  }

  const responseData = record(envelope.response, "QUOTE_RESPONSE");
  let response: NegotiationResponse;
  try {
    response = NegotiationResponse.fromDict(responseData);
  } catch {
    throw new QuoteValidationError("QUOTE_RESPONSE");
  }
  const responseHash = hash(envelope.response_hash, "QUOTE_RESPONSE_HASH");
  if (response.computeHash().toLowerCase() !== responseHash) {
    throw new QuoteValidationError("QUOTE_RESPONSE_HASH");
  }

  if (!response.accepted) {
    if (
      !response.reasonCode
      || !REJECTION_CODES.has(response.reasonCode)
      || !response.reason
      || response.reason.trim().length === 0
    ) throw new QuoteValidationError("QUOTE_REJECTION");
    return {
      outcome: "quote_rejected",
      errorCode: response.reasonCode,
      requestHash,
    };
  }

  if (!context.policyAllowlisted) throw new QuoteValidationError("QUOTE_CONTRACT_CONTEXT");
  if (envelope.chain_id !== 56) throw new QuoteValidationError("QUOTE_CHAIN");
  const provider = address(envelope.provider_address, "QUOTE_PROVIDER");
  if (provider !== getAddress(context.provider)) throw new QuoteValidationError("QUOTE_PROVIDER");
  const commerce = address(envelope.verifying_contract, "QUOTE_COMMERCE");
  if (commerce !== getAddress(context.commerce)) throw new QuoteValidationError("QUOTE_COMMERCE");
  const negotiationHash = hash(envelope.negotiation_hash, "QUOTE_NEGOTIATION_HASH");
  if (typeof envelope.provider_sig !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(envelope.provider_sig)) {
    throw new QuoteValidationError("QUOTE_SIGNATURE");
  }

  const terms = response.terms;
  if (
    !terms
    || terms.deliverables !== GRID_DELIVERABLES
    || terms.qualityStandards !== GRID_QUALITY_STANDARDS
    || terms.evaluationRequired !== true
    || terms.evaluatorType !== "uma_oov3"
  ) throw new QuoteValidationError("QUOTE_TERMS");
  if (!terms.price || !/^[1-9]\d*$/.test(terms.price)) {
    throw new QuoteValidationError("QUOTE_PRICE");
  }
  const currency = address(terms.currency, "QUOTE_CURRENCY");
  if (currency !== getAddress(context.paymentToken)) throw new QuoteValidationError("QUOTE_CURRENCY");
  if (!Number.isSafeInteger(context.tokenDecimals) || context.tokenDecimals < 0) {
    throw new QuoteValidationError("QUOTE_DECIMALS");
  }

  const negotiatedAt = timestamp(
    envelope.negotiated_at ?? responseData.negotiated_at,
    "QUOTE_NEGOTIATED_AT",
  );
  const quoteExpiresAt = timestamp(
    envelope.quote_expires_at ?? responseData.quote_expires_at,
    "QUOTE_EXPIRES_AT",
  );
  if (
    negotiatedAt > context.nowSeconds + MAX_QUOTE_FUTURE_SECONDS
    || context.nowSeconds - negotiatedAt > MAX_QUOTE_AGE_SECONDS
  ) throw new QuoteValidationError("QUOTE_FRESHNESS");
  if (
    quoteExpiresAt <= context.nowSeconds
    || quoteExpiresAt <= negotiatedAt
    || quoteExpiresAt - negotiatedAt > MAX_QUOTE_TTL_SECONDS
  ) throw new QuoteValidationError("QUOTE_EXPIRY");

  const signature = await verify({
    envelope,
    provider,
    publicClient: context.publicClient,
    expectedVerifyingContract: commerce,
    blockNumber: context.blockNumber,
  });
  if (!signature.valid) throw new QuoteValidationError("QUOTE_SIGNATURE");
  const signer = getAddress(signature.signer);
  if (signer !== provider) throw new QuoteValidationError("QUOTE_SIGNER");

  return {
    outcome: "quote_verified",
    provider,
    signer,
    signatureMethod: signature.method,
    requestHash,
    negotiationHash,
    priceRaw: terms.price,
    currency,
    decimals: context.tokenDecimals,
    quoteNegotiatedAt: negotiatedAt * 1_000,
    quoteExpiresAt: quoteExpiresAt * 1_000,
  };
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new QuoteValidationError(code);
  }
  return value as Record<string, unknown>;
}

function hash(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new QuoteValidationError(code);
  }
  return value.toLowerCase();
}

function address(value: unknown, code: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new QuoteValidationError(code);
  return getAddress(value);
}

function timestamp(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new QuoteValidationError(code);
  }
  return value;
}
