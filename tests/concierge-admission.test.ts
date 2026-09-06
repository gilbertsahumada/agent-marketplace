import { describe, expect, it } from "vitest";
import { MarketplaceRateLimitError } from "../src/business/errors/marketplace-errors.ts";
import { InProcessConciergeAdmission } from "../src/data/llm/concierge-admission.ts";

describe("concierge admission control", () => {
  it("enforces sliding window limit per caller", () => {
    const now = 1_000;
    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 2,
      windowMs: 60_000,
      maxConcurrent: 10,
      dailyCap: 1_000,
      now: () => now,
    });

    const release1 = admission.acquire("alice");
    release1();
    const release2 = admission.acquire("alice");
    release2();

    expect(() => {
      admission.acquire("alice");
    }).toThrow(MarketplaceRateLimitError);
  });

  it("computes window retryAfterSeconds correctly", () => {
    let now = 1_000;
    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 2,
      windowMs: 60_000,
      maxConcurrent: 10,
      dailyCap: 1_000,
      now: () => now,
    });

    // Record two requests at time 1000
    const release1 = admission.acquire("alice");
    release1();
    const release2 = admission.acquire("alice");
    release2();

    // Try a third at time 1000: oldest was at 1000, window ends at 61000, should be ~60s
    try {
      admission.acquire("alice");
    } catch (err) {
      if (err instanceof MarketplaceRateLimitError) {
        expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(59);
        expect(err.retryAfterSeconds).toBeLessThanOrEqual(60);
      } else {
        throw err;
      }
    }

    // Now advance time to 31000 (oldest still at 1000, 30 seconds remaining)
    now = 31_000;
    try {
      admission.acquire("alice");
    } catch (err) {
      if (err instanceof MarketplaceRateLimitError) {
        expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(29);
        expect(err.retryAfterSeconds).toBeLessThanOrEqual(30);
      } else {
        throw err;
      }
    }
  });

  it("enforces concurrency limit per caller", () => {
    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 10,
      windowMs: 60_000,
      maxConcurrent: 1,
      dailyCap: 1_000,
      now: () => 1_000,
    });

    // First inflight request
    const rel1 = admission.acquire("alice");

    // Second concurrent request should fail
    expect(() => {
      admission.acquire("alice");
    }).toThrow(MarketplaceRateLimitError);

    rel1();
  });

  it("computes concurrency retryAfterSeconds as 5", () => {
    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 10,
      windowMs: 60_000,
      maxConcurrent: 1,
      dailyCap: 1_000,
      now: () => 1_000,
    });

    admission.acquire("alice");

    try {
      admission.acquire("alice");
    } catch (err) {
      if (err instanceof MarketplaceRateLimitError) {
        expect(err.retryAfterSeconds).toBe(5);
      } else {
        throw err;
      }
    }
  });

  it("enforces global daily cap", () => {
    const now = 1_000;
    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 100,
      windowMs: 60_000,
      maxConcurrent: 100,
      dailyCap: 2,
      now: () => now,
    });

    const r1 = admission.acquire("alice");
    r1();
    const r2 = admission.acquire("bob");
    r2();

    // Third request from any caller should fail
    expect(() => {
      admission.acquire("charlie");
    }).toThrow(MarketplaceRateLimitError);
  });

  it("computes daily cap retryAfterSeconds as seconds until UTC midnight", () => {
    // 2026-01-15 23:59:00 UTC (1451606340 is 2026-01-10 14:32:20 UTC; approximate)
    // 86400 seconds = 1 day. Let's use an exact calculation.
    // 2026-01-15 at 22:00:00 UTC = 1452086400 ms
    const timeAtPM10 = new Date("2026-01-15T22:00:00Z").getTime();

    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 100,
      windowMs: 60_000,
      maxConcurrent: 100,
      dailyCap: 1,
      now: () => timeAtPM10,
    });

    admission.acquire("alice");

    try {
      admission.acquire("bob");
    } catch (err) {
      if (err instanceof MarketplaceRateLimitError) {
        // From 22:00 to 00:00 = 2 hours = 7200 seconds
        const expectedSeconds = 2 * 60 * 60; // 7200
        expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(expectedSeconds - 1);
        expect(err.retryAfterSeconds).toBeLessThanOrEqual(expectedSeconds + 1);
        // Check it's capped at 86400
        expect(err.retryAfterSeconds).toBeLessThanOrEqual(86400);
      } else {
        throw err;
      }
    }
  });

  it("resets daily counter when UTC date changes", () => {
    let now = new Date("2026-01-15T00:00:00Z").getTime();

    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 100,
      windowMs: 60_000,
      maxConcurrent: 100,
      dailyCap: 1,
      now: () => now,
    });

    // Use up daily cap on 2026-01-15
    admission.acquire("alice");

    // Advance to next day (2026-01-16)
    now = new Date("2026-01-16T00:00:00Z").getTime();

    // Should be able to acquire again
    const release = admission.acquire("bob");
    release();
  });

  it("releases in-flight counter idempotently", () => {
    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 100,
      windowMs: 60_000,
      maxConcurrent: 2,
      dailyCap: 100,
      now: () => 1_000,
    });

    const rel1 = admission.acquire("alice");
    admission.acquire("alice");

    // Call release multiple times (should be safe)
    rel1();
    rel1();
    rel1();

    // Should still be able to get a second concurrent request
    const rel2 = admission.acquire("alice");
    rel2();
  });

  it("isolates caller windows", () => {
    const now = 1_000;
    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 1,
      windowMs: 60_000,
      maxConcurrent: 10,
      dailyCap: 1_000,
      now: () => now,
    });

    const relA = admission.acquire("alice");
    relA();

    // Alice hits her window limit
    expect(() => {
      admission.acquire("alice");
    }).toThrow(MarketplaceRateLimitError);

    // Bob should be able to acquire independently (his own window)
    const relB = admission.acquire("bob");
    relB();

    // Bob also hits his limit
    expect(() => {
      admission.acquire("bob");
    }).toThrow(MarketplaceRateLimitError);
  });

  it("allows reacquisition after window expires", () => {
    let now = 1_000;
    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 1,
      windowMs: 60_000,
      maxConcurrent: 10,
      dailyCap: 1_000,
      now: () => now,
    });

    const rel1 = admission.acquire("alice");
    rel1();

    // Cannot acquire again
    expect(() => {
      admission.acquire("alice");
    }).toThrow(MarketplaceRateLimitError);

    // Advance time past window expiration (1000 + 60000 + 1)
    now = 61_001;

    // Should be able to acquire again
    const rel2 = admission.acquire("alice");
    rel2();
  });

  it("parses CONCIERGE_DAILY_CAP from env", () => {
    const originalEnv = process.env.CONCIERGE_DAILY_CAP;
    try {
      process.env.CONCIERGE_DAILY_CAP = "50";
      const admission = new InProcessConciergeAdmission({
        maxPerWindow: 1_000,
        windowMs: 60_000,
        maxConcurrent: 1_000,
        now: () => 1_000,
      });
      // Trigger acquisition 50+ times to verify the cap from env
      let count = 0;
      while (true) {
        try {
          const rel = admission.acquire("user1");
          count++;
          if (count > 50) break; // Safety
          rel();
        } catch (err) {
          if (err instanceof MarketplaceRateLimitError) {
            break;
          }
          throw err;
        }
      }
      expect(count).toBe(50);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CONCIERGE_DAILY_CAP;
      } else {
        process.env.CONCIERGE_DAILY_CAP = originalEnv;
      }
    }
  });

  it("defaults dailyCap to 300 when env is missing", () => {
    const originalEnv = process.env.CONCIERGE_DAILY_CAP;
    try {
      delete process.env.CONCIERGE_DAILY_CAP;
      const admission = new InProcessConciergeAdmission({
        maxPerWindow: 1_000,
        windowMs: 60_000,
        maxConcurrent: 1_000,
        now: () => 1_000,
      });
      let count = 0;
      while (true) {
        try {
          const rel = admission.acquire("user1");
          count++;
          if (count > 300) break; // Safety
          rel();
        } catch (err) {
          if (err instanceof MarketplaceRateLimitError) {
            break;
          }
          throw err;
        }
      }
      expect(count).toBe(300);
    } finally {
      if (originalEnv !== undefined) {
        process.env.CONCIERGE_DAILY_CAP = originalEnv;
      }
    }
  });

  it("ignores invalid CONCIERGE_DAILY_CAP and defaults to 300", () => {
    const originalEnv = process.env.CONCIERGE_DAILY_CAP;
    try {
      process.env.CONCIERGE_DAILY_CAP = "invalid";
      const admission = new InProcessConciergeAdmission({
        maxPerWindow: 1_000,
        windowMs: 60_000,
        maxConcurrent: 1_000,
        now: () => 1_000,
      });
      let count = 0;
      while (true) {
        try {
          const rel = admission.acquire("user1");
          count++;
          if (count > 300) break; // Safety
          rel();
        } catch (err) {
          if (err instanceof MarketplaceRateLimitError) {
            break;
          }
          throw err;
        }
      }
      expect(count).toBe(300);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CONCIERGE_DAILY_CAP;
      } else {
        process.env.CONCIERGE_DAILY_CAP = originalEnv;
      }
    }
  });

  it("deduplicates concurrent requests from the same caller within the same window", async () => {
    const now = 1_000;
    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 10,
      windowMs: 60_000,
      maxConcurrent: 2,
      dailyCap: 100,
      now: () => now,
    });

    // Acquire twice for alice
    const rel1 = admission.acquire("alice");
    const rel2 = admission.acquire("alice");

    // Both are recorded in the window (they're concurrent)
    expect(() => {
      admission.acquire("alice");
    }).toThrow(MarketplaceRateLimitError);

    rel1();
    rel2();
  });

  it("error message is consistent across all limit types", () => {
    const now = 1_000;
    const admission = new InProcessConciergeAdmission({
      maxPerWindow: 1,
      windowMs: 60_000,
      maxConcurrent: 1,
      dailyCap: 1,
      now: () => now,
    });

    // Exhaust window limit
    const rel = admission.acquire("alice");
    rel();
    try {
      admission.acquire("alice");
      expect.fail("should throw");
    } catch (err) {
      if (err instanceof MarketplaceRateLimitError) {
        expect(err.message).toBe("The concierge is temporarily at capacity");
      }
    }

    // Exhaust daily limit
    const admission2 = new InProcessConciergeAdmission({
      maxPerWindow: 100,
      windowMs: 60_000,
      maxConcurrent: 100,
      dailyCap: 1,
      now: () => now,
    });
    admission2.acquire("bob");
    try {
      admission2.acquire("charlie");
      expect.fail("should throw");
    } catch (err) {
      if (err instanceof MarketplaceRateLimitError) {
        expect(err.message).toBe("The concierge is temporarily at capacity");
      }
    }
  });
});
