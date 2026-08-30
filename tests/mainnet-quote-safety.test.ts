import { describe, expect, it, vi } from "vitest";
import {
  assertAcceptableQuoteWindow,
  withQuoteDeadline,
} from "../src/mainnet/mainnet-erc8183-repository.ts";

describe("on-demand Mainnet quote safety", () => {
  it("accepts a quote negotiated 61 seconds ago when it is still sufficiently valid", () => {
    expect(() => assertAcceptableQuoteWindow({
      negotiatedAt: 1_999_999_939,
      quoteExpiresAt: 2_000_000_120,
      now: 2_000_000_000,
      minRemainingSeconds: 120,
    })).not.toThrow();
  });

  it("rejects quotes too far in the future, expired, or beyond the SDK TTL", () => {
    expect(() => assertAcceptableQuoteWindow({
      negotiatedAt: 2_000_000_061,
      quoteExpiresAt: 2_000_000_500,
      now: 2_000_000_000,
      minRemainingSeconds: 120,
    })).toThrow(/stale|validity/i);
    expect(() => assertAcceptableQuoteWindow({
      negotiatedAt: 1_999_999_999,
      quoteExpiresAt: 2_000_000_119,
      now: 2_000_000_000,
      minRemainingSeconds: 120,
    })).toThrow(/stale|validity/i);
    expect(() => assertAcceptableQuoteWindow({
      negotiatedAt: 1_999_999_000,
      quoteExpiresAt: 2_000_000_121,
      now: 2_000_000_000,
      minRemainingSeconds: 120,
    })).toThrow(/stale|validity/i);
  });

  it("fails closed on one end-to-end deadline even when a dependency cannot be cancelled", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => undefined);
    const result = withQuoteDeadline(() => never, 5_000);
    const rejection = expect(result).rejects.toThrow(/deadline/i);
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
    vi.useRealTimers();
  });
});
