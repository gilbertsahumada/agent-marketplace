import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MarketplaceRateLimitError } from "../src/business/errors/marketplace-errors.js";
import { RateLimitedAgentValidationRepository } from "../src/data/repositories/rate-limited-agent-validation-repository.js";

describe("agent validation admission control", () => {
  it("shares one trust8004 scheduler between catalogue and validation", () => {
    const composition = readFileSync("src/data/composition.ts", "utf8");
    expect(composition.match(/provider: trust8004Provider/g)).toHaveLength(2);
  });

  it("rejects excess work before invoking the upstream repository", async () => {
    const validate = vi.fn(async () => null);
    const repository = new RateLimitedAgentValidationRepository(
      { validate },
      { maxRequests: 2, windowMs: 60_000, maxConcurrent: 1, now: () => 1_000 },
    );

    await repository.validate("1");
    await repository.validate("2");
    await expect(repository.validate("3")).rejects.toBeInstanceOf(MarketplaceRateLimitError);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("rejects concurrent excess work before invoking the upstream repository", async () => {
    let release!: () => void;
    const pending = new Promise<null>((resolve) => { release = () => resolve(null); });
    const validate = vi.fn(() => pending);
    const repository = new RateLimitedAgentValidationRepository(
      { validate },
      { maxRequests: 10, windowMs: 60_000, maxConcurrent: 1, now: () => 1_000 },
    );

    const first = repository.validate("1");
    await expect(repository.validate("2")).rejects.toBeInstanceOf(MarketplaceRateLimitError);
    expect(validate).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it("deduplicates the same Agent ID without consuming extra admission slots", async () => {
    let release!: () => void;
    const pending = new Promise<null>((resolve) => { release = () => resolve(null); });
    const validate = vi.fn(() => pending);
    const repository = new RateLimitedAgentValidationRepository(
      { validate },
      { maxRequests: 1, windowMs: 60_000, maxConcurrent: 1, now: () => 1_000 },
    );

    const first = repository.validate("303779");
    const duplicate = repository.validate("303779");
    expect(validate).toHaveBeenCalledTimes(1);
    release();
    await expect(Promise.all([first, duplicate])).resolves.toEqual([null, null]);
    await expect(repository.validate("303779")).resolves.toBeNull();
    expect(validate).toHaveBeenCalledTimes(2);
  });
});
