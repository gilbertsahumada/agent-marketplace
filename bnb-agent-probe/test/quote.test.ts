import {
  NegotiationResponse,
  ReasonCode,
  TermSpecification,
} from "@bnbagent/sdk/erc8183";
import { describe, expect, it, vi } from "vitest";
import type { Address, PublicClient } from "viem";

import { validateProbeQuote } from "../src/lib/quote";
import { BscProbeError } from "../src/lib/chain";
import { buildGridProbeRequest, GRID_PROBE_REQUEST_HASH } from "../src/lib/terms";

const PROVIDER = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x9999999999999999999999999999999999999999" as Address;
const COMMERCE = "0xEa4DAa3100A767e86FDed867729ae7446476EBA6" as Address;
const ROUTER = "0x51895229E12F9876011789B04f8698af06cCD6DA" as Address;
const POLICY = "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5" as Address;
const TOKEN = "0xcE24439F2D9C6a2289F741120FE202248B666666" as Address;
const NOW = 2_000_000_000;

function acceptedEnvelope(): Record<string, unknown> {
  const request = buildGridProbeRequest().toDict();
  const response = new NegotiationResponse({
    accepted: true,
    terms: new TermSpecification({
      deliverables: "Deterministic Grid plan JSON with levels, allocation, triggers and assumptions",
      qualityStandards: "Deterministic output, no order execution and no custody",
      price: "10000000000000000",
      currency: TOKEN,
    }),
    quoteExpiresAt: NOW + 900,
  }).toDict();
  response.negotiated_at = NOW;
  return {
    request,
    request_hash: GRID_PROBE_REQUEST_HASH,
    response,
    response_hash: NegotiationResponse.fromDict(response).computeHash(),
    negotiation_hash: `0x${"c".repeat(64)}`,
    provider_sig: `0x${"d".repeat(130)}`,
    provider_address: PROVIDER,
    chain_id: 56,
    verifying_contract: COMMERCE,
  };
}

function context() {
  return {
    provider: PROVIDER,
    blockNumber: 123n,
    publicClient: {} as PublicClient,
    commerce: COMMERCE,
    router: ROUTER,
    policy: POLICY,
    paymentToken: TOKEN,
    tokenDecimals: 18,
    policyAllowlisted: true,
    nowSeconds: NOW,
  } as const;
}

function validVerifier() {
  return vi.fn(async () => ({
    valid: true as const,
    method: "eip191" as const,
    signer: PROVIDER,
  }));
}

describe("WP3 quote validation", () => {
  it("verifies every canonical field and pins signature verification to one block", async () => {
    const verify = validVerifier();
    const result = await validateProbeQuote(acceptedEnvelope(), context(), verify);

    expect(result).toMatchObject({
      outcome: "quote_verified",
      provider: PROVIDER,
      signer: PROVIDER,
      signatureMethod: "eip191",
      requestHash: GRID_PROBE_REQUEST_HASH,
      priceRaw: "10000000000000000",
      currency: TOKEN,
      decimals: 18,
      quoteNegotiatedAt: NOW * 1_000,
      quoteExpiresAt: (NOW + 900) * 1_000,
    });
    expect(verify).toHaveBeenCalledWith({
      envelope: expect.any(Object),
      provider: PROVIDER,
      publicClient: context().publicClient,
      expectedVerifyingContract: COMMERCE,
      blockNumber: 123n,
    });
  });

  it("accepts a structured SDK rejection bound to the exact request", async () => {
    const request = buildGridProbeRequest().toDict();
    const response = new NegotiationResponse({
      accepted: false,
      reasonCode: ReasonCode.BUSY,
      reason: "retry later",
    }).toDict();
    const envelope = {
      request,
      request_hash: GRID_PROBE_REQUEST_HASH,
      response,
      response_hash: NegotiationResponse.fromDict(response).computeHash(),
    };

    await expect(validateProbeQuote(envelope, context(), validVerifier())).resolves.toEqual({
      outcome: "quote_rejected",
      errorCode: ReasonCode.BUSY,
      requestHash: GRID_PROBE_REQUEST_HASH,
    });
  });

  it("rejects SDK-coercible non-boolean accepted values", async () => {
    const quote = acceptedEnvelope();
    const response = quote.response as Record<string, unknown>;
    response.accepted = "yes";
    quote.response_hash = NegotiationResponse.fromDict(response).computeHash();

    await expect(validateProbeQuote(quote, context(), validVerifier()))
      .rejects.toMatchObject({ code: "QUOTE_RESPONSE" });
  });

  it("rejects a non-string rejection reason without leaking a TypeError", async () => {
    const quote = acceptedEnvelope();
    const response = quote.response as Record<string, unknown>;
    response.accepted = false;
    response.reason_code = ReasonCode.BUSY;
    response.reason = 123;
    delete response.terms;
    quote.response_hash = NegotiationResponse.fromDict(response).computeHash();

    await expect(validateProbeQuote(quote, context(), validVerifier()))
      .rejects.toMatchObject({ code: "QUOTE_REJECTION" });
  });

  it.each([
    ["request hash", (quote: Record<string, unknown>) => { quote.request_hash = `0x${"a".repeat(64)}`; }],
    ["response hash", (quote: Record<string, unknown>) => { quote.response_hash = `0x${"a".repeat(64)}`; }],
    ["negotiation hash", (quote: Record<string, unknown>) => { quote.negotiation_hash = "0x01"; }],
    ["provider", (quote: Record<string, unknown>) => { quote.provider_address = OTHER; }],
    ["missing provider", (quote: Record<string, unknown>) => { delete quote.provider_address; }],
    ["chain", (quote: Record<string, unknown>) => { quote.chain_id = 97; }],
    ["Commerce", (quote: Record<string, unknown>) => { quote.verifying_contract = OTHER; }],
    ["price", (quote: Record<string, unknown>) => {
      ((quote.response as Record<string, unknown>).terms as Record<string, unknown>).price = "0";
    }],
    ["currency", (quote: Record<string, unknown>) => {
      ((quote.response as Record<string, unknown>).terms as Record<string, unknown>).currency = OTHER;
    }],
    ["stale", (quote: Record<string, unknown>) => {
      (quote.response as Record<string, unknown>).negotiated_at = NOW - 61;
    }],
    ["future", (quote: Record<string, unknown>) => {
      (quote.response as Record<string, unknown>).negotiated_at = NOW + 61;
    }],
    ["expired", (quote: Record<string, unknown>) => {
      (quote.response as Record<string, unknown>).quote_expires_at = NOW;
    }],
    ["TTL", (quote: Record<string, unknown>) => {
      (quote.response as Record<string, unknown>).quote_expires_at = NOW + 901;
    }],
  ])("rejects an invalid %s", async (_name, mutate) => {
    const quote = acceptedEnvelope();
    mutate(quote);
    await expect(validateProbeQuote(quote, context(), validVerifier())).rejects.toMatchObject({
      code: expect.stringMatching(/^QUOTE_/),
    });
  });

  it("requires the recovered signer to equal the onchain wallet", async () => {
    await expect(validateProbeQuote(acceptedEnvelope(), context(), async () => ({
      valid: true,
      method: "erc1271",
      signer: OTHER,
    }))).rejects.toMatchObject({ code: "QUOTE_SIGNER" });
  });

  it("accepts an ERC-1271 account signature only when the account verifier passes", async () => {
    await expect(validateProbeQuote(acceptedEnvelope(), context(), async () => ({
      valid: true,
      method: "erc1271",
      signer: PROVIDER,
    }))).resolves.toMatchObject({
      outcome: "quote_verified",
      signatureMethod: "erc1271",
      signer: PROVIDER,
    });
    await expect(validateProbeQuote(acceptedEnvelope(), context(), async () => ({
      valid: false,
      reason: "ERC1271_INVALID",
    }))).rejects.toMatchObject({ code: "QUOTE_SIGNATURE" });
  });

  it("normalizes a viem-wrapped RPC failure during signature verification", async () => {
    const wrapped = new Error("Unknown RPC error", {
      cause: new BscProbeError("BSC_RPC_TIMEOUT"),
    });
    await expect(validateProbeQuote(acceptedEnvelope(), context(), async () => {
      throw wrapped;
    })).rejects.toMatchObject({ code: "BSC_SIGNATURE_RPC", message: "BSC_SIGNATURE_RPC" });
  });

  it("fails closed when the policy or configured payment token is not valid", async () => {
    await expect(validateProbeQuote(acceptedEnvelope(), {
      ...context(),
      policyAllowlisted: false,
    }, validVerifier())).rejects.toMatchObject({ code: "QUOTE_CONTRACT_CONTEXT" });
    await expect(validateProbeQuote(acceptedEnvelope(), {
      ...context(),
      paymentToken: OTHER,
    }, validVerifier())).rejects.toMatchObject({ code: "QUOTE_CURRENCY" });
  });
});
