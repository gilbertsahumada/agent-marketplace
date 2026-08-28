import { describe, expect, it, vi } from "vitest";

import { BscProbeError } from "../src/lib/chain";
import { QuoteValidationError } from "../src/lib/quote";
import { SellerProbeError } from "../src/lib/seller-client";
import { runProbePhase, type ProbeTarget } from "../src/phases/probe";

const TARGET: ProbeTarget = {
  agentId: "303779",
  chainId: 56,
  transport: "a2a",
  endpoint: "https://bnb-agent-marketplace-ruby.vercel.app/grid",
  categoriesJson: '["grid_trading"]',
  currentMetadataUpdatedAt: 1_999_999_000_000,
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    selectTarget: vi.fn(async () => TARGET),
    refreshTarget: vi.fn(async () => ({
      status: "current" as const,
      metadataUpdatedAt: 2_000_000_000_000,
    })),
    readChainContext: vi.fn(async () => ({ provider: "0xprovider" })),
    probeSeller: vi.fn(async () => ({ quote: { signed: true } })),
    validateQuote: vi.fn(async () => ({
      outcome: "quote_verified" as const,
      provider: "0xprovider",
      signer: "0xprovider",
      signatureMethod: "eip191" as const,
      requestHash: "0xrequest",
      negotiationHash: "0xnegotiation",
      priceRaw: "1",
      currency: "0xtoken",
      decimals: 18,
      quoteNegotiatedAt: 2_000_000_000_000,
      quoteExpiresAt: 2_000_000_900_000,
    })),
    commit: vi.fn(async () => undefined),
    ...overrides,
  };
}

const input = {
  agentAllowlist: ["303779"],
  endpointAllowlist: [TARGET.endpoint],
  limit: 1,
  nowMs: 2_000_000_000_000,
  startedAtMs: 2_000_000_000_000,
  now: () => 2_000_000_000_010,
};

describe("WP3 PROBE phase", () => {
  it("reconciles Grid 303779 before producing one sanitized verified observation", async () => {
    const deps = dependencies();
    const summary = await runProbePhase(input, deps as never);

    expect(deps.selectTarget).toHaveBeenCalledWith({
      agentAllowlist: ["303779"],
      endpointAllowlist: [TARGET.endpoint],
      limit: 1,
    });
    expect(deps.refreshTarget).toHaveBeenCalledBefore(deps.readChainContext);
    expect(deps.readChainContext).toHaveBeenCalledBefore(deps.probeSeller);
    expect(deps.probeSeller).toHaveBeenCalledBefore(deps.validateQuote);
    expect(deps.commit).toHaveBeenCalledWith(expect.objectContaining({
      target: TARGET,
      reconciliation: expect.objectContaining({ status: "current" }),
      observation: expect.objectContaining({
        outcome: "quote_verified",
        probeCategory: "grid_trading",
        observedMetadataUpdatedAt: 2_000_000_000_000,
        signer: "0xprovider",
        providerSig: undefined,
      }),
      nextPriority: 0,
    }));
    expect(summary).toMatchObject({
      phase: "probe",
      status: "ok",
      processedTargets: 1,
      outcome: "quote_verified",
      requests: 0,
    });
  });

  it.each(["metadata_unavailable", "removed"] as const)(
    "does not contact seller or chain when reconciliation is %s",
    async (status) => {
      const deps = dependencies({
        refreshTarget: vi.fn(async () => ({ status })),
      });
      await runProbePhase(input, deps as never);
      expect(deps.readChainContext).not.toHaveBeenCalled();
      expect(deps.probeSeller).not.toHaveBeenCalled();
      expect(deps.validateQuote).not.toHaveBeenCalled();
      expect(deps.commit).toHaveBeenCalledWith(expect.objectContaining({
        observation: null,
        reconciliation: { status },
      }));
    },
  );

  it.each([
    [new SellerProbeError("SELLER_UNSAFE_URL"), "unsafe_url"],
    [new SellerProbeError("SELLER_TIMEOUT"), "unreachable"],
    [new SellerProbeError("SELLER_UNREACHABLE"), "unreachable"],
    [new SellerProbeError("SELLER_INVALID_JSON"), "reachable"],
    [new QuoteValidationError("QUOTE_SIGNATURE"), "quote_invalid"],
    [new BscProbeError("BSC_RPC_UNREACHABLE"), "error"],
  ] as const)("maps sanitized failure %s to %s", async (error, outcome) => {
    const sellerFailure = error instanceof SellerProbeError;
    const chainFailure = error instanceof BscProbeError;
    const deps = dependencies({
      ...(chainFailure ? { readChainContext: vi.fn(async () => { throw error; }) } : {}),
      ...(sellerFailure ? { probeSeller: vi.fn(async () => { throw error; }) } : {}),
      ...(!sellerFailure && !chainFailure
        ? { validateQuote: vi.fn(async () => { throw error; }) }
        : {}),
    });
    await runProbePhase(input, deps as never);
    expect(deps.commit).toHaveBeenCalledWith(expect.objectContaining({
      observation: expect.objectContaining({ outcome, errorCode: error.code }),
    }));
  });

  it("rotates without network when no allowlisted target exists", async () => {
    const deps = dependencies({ selectTarget: vi.fn(async () => null) });
    const summary = await runProbePhase(input, deps as never);
    expect(deps.refreshTarget).not.toHaveBeenCalled();
    expect(deps.readChainContext).not.toHaveBeenCalled();
    expect(deps.commit).toHaveBeenCalledWith(expect.objectContaining({ target: null }));
    expect(summary).toMatchObject({ processedTargets: 0, outcome: "no_candidate" });
  });
});
