import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestQuoteWithObservationSync,
  syncBuyerQuoteObservation,
} from "../src/data/observation/on-demand-observation-sync.ts";
import type { NormalizedErc8183Quote } from "../src/business/entities/erc8183-browser-spike.ts";

const quote = {
  agentId: 303779,
  chainId: 56,
  provider: "0x1111111111111111111111111111111111111111",
  endpoint: "https://seller.example/grid",
  commerce: "0x2222222222222222222222222222222222222222",
  router: "0x3333333333333333333333333333333333333333",
  policy: "0x4444444444444444444444444444444444444444",
  token: "0x5555555555555555555555555555555555555555",
  tokenSymbol: "USDT",
  tokenDecimals: 18,
  priceRaw: "1000",
  priceDisplay: "0.000000000000001",
  negotiatedAt: 1_788_000_000,
  quoteExpiresAt: 1_788_000_900,
  description: "verified",
  envelope: {
    request_hash: `0x${"a".repeat(64)}`,
    negotiation_hash: `0x${"b".repeat(64)}`,
    provider_sig: "must-never-sync",
    response: { raw: "must-never-sync" },
  },
} satisfies NormalizedErc8183Quote;

afterEach(() => vi.unstubAllEnvs());

describe("buyer-triggered observation sync", () => {
  it("sends a bounded sanitized payload with the buyer-observation Bearer secret", async () => {
    vi.stubEnv("OBSERVATIONS_URL", "https://worker.example/observations");
    vi.stubEnv("BUYER_OBSERVATION_ALLOWED_ORIGIN", "https://worker.example");
    vi.stubEnv("BUYER_OBSERVATION_SECRET", "buyer-secret");
    vi.stubEnv("SHARED_SECRET", "different-admin-secret");
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer buyer-secret" });
      const raw = String(init?.body);
      expect(raw.length).toBeLessThan(8_192);
      expect(raw).not.toContain("provider_sig");
      expect(raw).not.toContain("must-never-sync");
      expect(JSON.parse(raw)).toMatchObject({
        schemaVersion: 1,
        source: "buyer_refresh",
        agentId: "303779",
        chainId: 56,
        transport: "a2a",
        endpoint: "https://seller.example/grid",
        probeCategory: "grid_trading",
        observedWallet: quote.provider,
        requestHash: quote.envelope.request_hash,
        negotiationHash: quote.envelope.negotiation_hash,
      });
      return Response.json({ status: "synced" }, { status: 201 });
    });

    await expect(syncBuyerQuoteObservation(quote, { fetchImpl, now: () => 1_788_000_125_000 }))
      .resolves.toEqual({ status: "synced" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://worker.example/__internal/on-demand-observation",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("returns the verified quote when sync fails and exposes only a safe sync status", async () => {
    const requestQuote = { execute: vi.fn(async () => quote) };
    const sync = vi.fn(async () => { throw new Error("secret internal D1 failure"); });

    await expect(requestQuoteWithObservationSync(requestQuote, sync, () => 1_788_000_125_000))
      .resolves.toEqual({ ...quote, observationSync: { status: "failed" } });
  });

  it("does not call the network when sync is not configured", async () => {
    vi.stubEnv("OBSERVATIONS_URL", "");
    vi.stubEnv("BUYER_OBSERVATION_ALLOWED_ORIGIN", "");
    vi.stubEnv("BUYER_OBSERVATION_SECRET", "");
    const fetchImpl = vi.fn();
    await expect(syncBuyerQuoteObservation(quote, { fetchImpl }))
      .resolves.toEqual({ status: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["non-HTTPS URL", "http://worker.example/observations", "http://worker.example"],
    ["URL userinfo", "https://user:password@worker.example/observations", "https://worker.example"],
    ["origin not explicitly allowed", "https://worker.example/observations", "https://other.example"],
  ])("fails closed for %s before sending the buyer secret", async (_name, observationsUrl, allowedOrigin) => {
    vi.stubEnv("OBSERVATIONS_URL", observationsUrl);
    vi.stubEnv("BUYER_OBSERVATION_ALLOWED_ORIGIN", allowedOrigin);
    vi.stubEnv("BUYER_OBSERVATION_SECRET", "buyer-secret");
    const fetchImpl = vi.fn();

    await expect(syncBuyerQuoteObservation(quote, { fetchImpl }))
      .resolves.toEqual({ status: "failed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
