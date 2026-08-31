// PR49 review — pins the ACTUAL code behavior contradicted by docs/HIRE-SPEC.md.
// Each test is labeled with the fidelity-review finding id (B1..B5). A passing
// test CONFIRMS the finding is real and anchors the corrected spec text.
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Erc8183HirePlan,
  NormalizedErc8183Quote,
} from "../src/business/entities/erc8183-browser-spike.ts";
import {
  Erc8183DemoJobNotFoundError,
  Erc8183QuoteRejectedError,
  Erc8183SpikeUnavailableError,
  InvalidErc8183SpikeInputError,
} from "../src/business/errors/erc8183-spike-errors.ts";
import { validateHirePlan } from "../src/data/erc8183/browser-wallet-adapter.ts";
import { ERC8183_TESTNET } from "../src/data/erc8183/contracts.ts";
import { requestQuoteWithObservationSync } from "../src/data/observation/on-demand-observation-sync.ts";
import { erc8183SpikeErrorResponse } from "../src/presentation/http/erc8183-spike-http.ts";

const executeTestnetTracking = vi.fn();
const executeMainnetStatus = vi.fn();

vi.mock("@/src/business/composition", () => ({
  getErc8183TestnetJobTracking: { execute: executeTestnetTracking },
  getMainnetErc8183JobStatus: { execute: executeMainnetStatus },
}));

const testnetJobRoute = await import("../app/api/marketplace/jobs/testnet/[jobId]/route.ts");
const mainnetJobRoute = await import("../app/api/marketplace/jobs/mainnet/[jobId]/route.ts");

describe("B1/B2 — status-code mapping of envelope re-validation failures", () => {
  it("maps Erc8183SpikeUnavailableError to 503 ERC8183_SPIKE_UNAVAILABLE, not 409", async () => {
    const response = erc8183SpikeErrorResponse(new Erc8183SpikeUnavailableError());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "ERC8183_SPIKE_UNAVAILABLE" } });
  });

  it("reserves 409 ERC8183_QUOTE_REJECTED for Erc8183QuoteRejectedError", async () => {
    const response = erc8183SpikeErrorResponse(new Erc8183QuoteRejectedError());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "ERC8183_QUOTE_REJECTED" } });
  });

  // Repository pre-emption: TrustlessErc8183SpikeRepository.normalizeAndVerify
  // (src/data/erc8183/trustless-erc8183-spike-repository.ts, throw sites at
  // ~lines 199-230: contract binding, provider/token allowlist, payment-token
  // drift, and "Seller quote signature is invalid") throws
  // Erc8183SpikeUnavailableError for every envelope re-validation failure, and
  // publicFailure (~lines 39-42) coerces any other error to the same class.
  // normalizeAndVerify is private and validateQuote requires a live
  // ERC8183Client, so there is no exported network-free seam to execute; the
  // source-scan below pins that a tampered/invalid-signature envelope can only
  // surface as Erc8183SpikeUnavailableError (503), never
  // Erc8183QuoteRejectedError (409).
  it("repository envelope re-validation can only throw Erc8183SpikeUnavailableError", () => {
    const source = readFileSync("src/data/erc8183/trustless-erc8183-spike-repository.ts", "utf8");
    expect(source).not.toContain("Erc8183QuoteRejectedError");
    expect(source).toMatch(
      /throw new Erc8183SpikeUnavailableError\("Seller quote signature is invalid"\)/,
    );
    expect(source).toMatch(
      /throw new Erc8183SpikeUnavailableError\("Seller quote is not bound to the allowlisted Testnet contract"\)/,
    );
  });
});

describe("B3 — tracking response shapes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("testnet route returns { liveStatus, job, snapshot } unwrapped", async () => {
    executeTestnetTracking.mockResolvedValue({
      liveStatus: "verified",
      job: { jobId: "551", status: "SUBMITTED" },
      snapshot: { jobId: "551", source: "snapshot:gate6a-job-551" },
    });
    const response = await testnetJobRoute.GET(new Request("http://local"), {
      params: Promise.resolve({ jobId: "551" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      liveStatus: "verified",
      job: { jobId: "551", status: "SUBMITTED" },
      snapshot: { jobId: "551", source: "snapshot:gate6a-job-551" },
    });
  });

  it("testnet route passes through the degraded job:null-with-snapshot shape", async () => {
    executeTestnetTracking.mockResolvedValue({
      liveStatus: "unavailable",
      job: null,
      snapshot: { jobId: "551", source: "snapshot:gate6a-job-551" },
    });
    const response = await testnetJobRoute.GET(new Request("http://local"), {
      params: Promise.resolve({ jobId: "551" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      liveStatus: "unavailable",
      job: null,
      snapshot: { jobId: "551", source: "snapshot:gate6a-job-551" },
    });
  });

  it("mainnet route wraps the job facts as { job }", async () => {
    executeMainnetStatus.mockResolvedValue({ jobId: "9", status: "COMPLETED" });
    const response = await mainnetJobRoute.GET(new Request("http://local"), {
      params: Promise.resolve({ jobId: "9" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: { jobId: "9", status: "COMPLETED" } });
  });

  // The testnet-route 404 pass-through is already pinned in
  // tests/erc8183-spike-controllers.test.ts; this pins the shared mapping.
  it("maps Erc8183DemoJobNotFoundError to 404 ERC8183_DEMO_JOB_NOT_FOUND", async () => {
    const response = erc8183SpikeErrorResponse(new Erc8183DemoJobNotFoundError());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "ERC8183_DEMO_JOB_NOT_FOUND", message: "The Testnet demo job was not found." },
    });
  });
});

describe("B4 — validateHirePlan pins to the local deployment constant", () => {
  function plan(commerce: `0x${string}`): Erc8183HirePlan {
    const now = Math.floor(Date.now() / 1_000);
    const quote: NormalizedErc8183Quote = {
      envelope: {},
      agentId: ERC8183_TESTNET.agentId,
      chainId: ERC8183_TESTNET.chainId,
      provider: ERC8183_TESTNET.seller,
      endpoint: "https://seller.example",
      commerce,
      router: ERC8183_TESTNET.router,
      policy: ERC8183_TESTNET.policy,
      token: ERC8183_TESTNET.token,
      tokenSymbol: "USDT",
      tokenDecimals: 18,
      priceRaw: "1",
      priceDisplay: "0.000000000000000001",
      negotiatedAt: now - 60,
      quoteExpiresAt: now + 900,
      description: "internally consistent quote",
    };
    return {
      quote,
      buyer: getAddress("0x1111111111111111111111111111111111111111"),
      seller: ERC8183_TESTNET.seller,
      nativeBalanceRaw: "1000000000000000000",
      tokenBalanceRaw: "5",
      allowanceRaw: "0",
      approvalRequired: true,
      approvalAmountRaw: "1",
      deadline: String(now + 3_600),
      disputeWindowSeconds: "600",
      executeBefore: quote.quoteExpiresAt,
      maximumSignatures: 5,
      guardrails: {
        custody: "injected_wallet",
        buyerPrivateKeyReceivedByServer: false,
        spendCeilingRaw: "1",
        approvalMode: "exact_if_required",
        // Internally consistent: the plan's spender is the quote's commerce.
        approvalSpender: commerce,
        cancellationAvailableAfterFunding: false,
      },
      transactions: [],
    };
  }

  it("rejects an internally consistent plan whose commerce differs from ERC8183_TESTNET", () => {
    const foreignCommerce = getAddress("0x000000000000000000000000000000000000dEaD");
    expect(foreignCommerce).not.toBe(ERC8183_TESTNET.commerce);
    expect(() => validateHirePlan(plan(foreignCommerce))).toThrowError(
      InvalidErc8183SpikeInputError,
    );
    expect(() => validateHirePlan(plan(foreignCommerce))).toThrowError(
      "Prepared hire is outside the browser-spike allowlist",
    );
  });

  it("accepts the identical plan when commerce matches the deployment constant", () => {
    expect(() => validateHirePlan(plan(ERC8183_TESTNET.commerce))).not.toThrow();
  });
});

describe("B5 — mainnet quote composition adds observationSync", () => {
  const quote = { agentId: 303779, chainId: 56, priceRaw: "1000" } as unknown as NormalizedErc8183Quote;

  it("returns the quote fields plus an observationSync.status field", async () => {
    const sync = vi.fn().mockResolvedValue({ status: "synced" });
    const result = await requestQuoteWithObservationSync(
      { execute: async () => quote },
      sync,
      () => 1_000,
    );
    expect(result).toEqual({ ...quote, observationSync: { status: "synced" } });
    expect(sync).toHaveBeenCalledWith(quote, { durationMs: 0 });
  });

  it("still returns the quote with observationSync.status failed when sync throws", async () => {
    const result = await requestQuoteWithObservationSync(
      { execute: async () => quote },
      async () => { throw new Error("drain"); },
    );
    expect(result).toEqual({ ...quote, observationSync: { status: "failed" } });
  });
});
