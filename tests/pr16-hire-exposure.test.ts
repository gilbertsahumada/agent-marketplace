import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { MainnetDemoPublicConfig } from "../src/business/entities/mainnet-browser-demo.ts";
import { GetMainnetHiringExposure } from "../src/business/use-cases/get-mainnet-hiring-exposure.ts";
import { NotifyQualifiedMainnetFundedJob, PrepareQualifiedMainnetHire, RequestQualifiedMainnetQuote } from "../src/business/use-cases/qualified-mainnet-hire.ts";
import { AsyncTtlCache } from "../src/data/cache/async-ttl-cache.ts";
import { Trust8004MarketplaceAgentRepository } from "../src/data/repositories/trust8004-marketplace-agent-repository.ts";
import type { Trust8004Provider } from "../src/trust8004/provider.ts";

const demoConfig: MainnetDemoPublicConfig = {
  agentId: 9001,
  seller: "0x1111111111111111111111111111111111111111",
  commerce: "0x2222222222222222222222222222222222222222",
  router: "0x3333333333333333333333333333333333333333",
  policy: "0x4444444444444444444444444444444444444444",
  token: "0x5555555555555555555555555555555555555555",
  maximumBudgetRaw: "1",
  rpcUrl: "https://bsc-dataseed.bnbchain.org",
  explorerUrl: "https://bscscan.com",
};

function observations(overrides: Record<string, unknown> = {}) {
  return {
    getObservations: async () => ({
      status: "available" as const,
      feed: {
        schemaVersion: 1 as const,
        generatedAt: Date.parse("2026-08-24T12:01:00.000Z"),
        targets: [{
          agentId: "9001",
          name: "Marketplace Grid planner",
          categories: ["grid_trading" as const],
          declarationState: "current" as const,
          latest: {
            probedAt: Date.parse("2026-08-24T12:00:30.000Z"),
            probeCategory: "grid_trading" as const,
            outcome: "quote_verified" as const,
            quoteExpiresAt: Date.parse("2026-08-24T12:02:00.000Z"),
            errorCode: null,
          },
          latestByCategory: {},
          ...overrides,
        }],
      },
    }),
  };
}

describe("PR 16 Mainnet exposure", () => {
  it("requires a current Worker observation before exposing the demo", async () => {
    const getPublicConfig = vi.fn(() => demoConfig);
    const unqualified = new GetMainnetHiringExposure(
      { getObservations: async () => ({ status: "unavailable", feed: null }) },
      { getPublicConfig },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    await expect(unqualified.execute()).resolves.toEqual({ qualifiedSeller: null, demoConfig: null });
    expect(getPublicConfig).not.toHaveBeenCalled();

    const stale = new GetMainnetHiringExposure(
      observations({ latest: {
        probedAt: Date.parse("2026-08-24T11:59:00.000Z"), probeCategory: "grid_trading",
        outcome: "quote_verified", quoteExpiresAt: Date.parse("2026-08-24T12:02:00.000Z"), errorCode: null,
      } }),
      { getPublicConfig },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    await expect(stale.execute()).resolves.toMatchObject({ demoConfig: null });

    const current = new GetMainnetHiringExposure(
      observations(),
      { getPublicConfig },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    await expect(current.execute()).resolves.toMatchObject({
      qualifiedSeller: { agentId: "9001" },
      demoConfig: { agentId: 9001 },
    });

    const explicitOnly = new GetMainnetHiringExposure(
      observations({ agentId: "9002" }),
      { getPublicConfig },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    await expect(explicitOnly.execute()).resolves.toEqual({ qualifiedSeller: null, demoConfig: null });
  });

  it("blocks quote and prepare before current qualification reaches business composition", async () => {
    const exposure = new GetMainnetHiringExposure(
      { getObservations: async () => ({ status: "unavailable", feed: null }) },
      { getPublicConfig: vi.fn(() => demoConfig) },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    const quoteDelegate = { execute: vi.fn() };
    const prepareDelegate = { execute: vi.fn() };
    const quote = new RequestQualifiedMainnetQuote(exposure, quoteDelegate as never);
    const prepare = new PrepareQualifiedMainnetHire(exposure, () => true, prepareDelegate as never);

    await expect(quote.execute()).rejects.toThrow(/disabled/);
    await expect(prepare.execute({} as never)).rejects.toThrow(/disabled/);
    expect(quoteDelegate.execute).not.toHaveBeenCalled();
    expect(prepareDelegate.execute).not.toHaveBeenCalled();
  });

  it("does not return a fundable Mainnet plan while the write gate is disabled", async () => {
    const exposure = new GetMainnetHiringExposure(
      observations(),
      { getPublicConfig: () => demoConfig },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    const prepareDelegate = { execute: vi.fn() };
    const prepare = new PrepareQualifiedMainnetHire(exposure, () => false, prepareDelegate as never);

    await expect(prepare.execute({} as never)).rejects.toThrow(/disabled/);
    expect(prepareDelegate.execute).not.toHaveBeenCalled();
  });

  it("requires the independent write gate before marketplace notify", async () => {
    const exposure = new GetMainnetHiringExposure(
      observations(),
      { getPublicConfig: () => demoConfig },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    const notifyDelegate = { execute: vi.fn(async () => ({ acknowledged: true })) };
    const getFunded = { execute: vi.fn(async () => ({ status: "FUNDED" })) };
    const disabled = new NotifyQualifiedMainnetFundedJob(exposure, () => false, getFunded as never, notifyDelegate as never);
    const enabled = new NotifyQualifiedMainnetFundedJob(exposure, () => true, getFunded as never, notifyDelegate as never);
    const input = { jobId: "97", buyer: "0x1111111111111111111111111111111111111111" } as const;

    await expect(disabled.execute(input)).rejects.toThrow(/disabled/);
    expect(notifyDelegate.execute).not.toHaveBeenCalled();
    await expect(enabled.execute(input)).resolves.toEqual({ acknowledged: true });
    expect(notifyDelegate.execute).toHaveBeenCalledWith(input);
  });

  it("preserves terminal notify idempotency after qualification or the write gate expires", async () => {
    const staleExposure = new GetMainnetHiringExposure(
      { getObservations: async () => ({ status: "unavailable", feed: null }) },
      { getPublicConfig: () => demoConfig },
      () => Date.parse("2026-08-27T12:00:00.001Z"),
    );
    const terminal = { status: "SUBMITTED", jobId: "97" };
    const getStatus = { execute: vi.fn(async () => terminal) };
    const notifyDelegate = { execute: vi.fn(async () => ({ acknowledged: true, alreadySubmitted: true, job: terminal })) };
    const notify = new NotifyQualifiedMainnetFundedJob(staleExposure, () => false, getStatus as never, notifyDelegate as never);
    const input = { jobId: "97", buyer: "0x1111111111111111111111111111111111111111" } as const;

    await expect(notify.execute(input)).resolves.toMatchObject({ acknowledged: true, alreadySubmitted: true });
    expect(notifyDelegate.execute).toHaveBeenCalledWith(input);
  });

  it("does not bypass the notify gate from a non-terminal status read", async () => {
    const exposure = new GetMainnetHiringExposure(
      observations(),
      { getPublicConfig: () => demoConfig },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    const getStatus = { execute: vi.fn(async () => ({ status: "OPEN" })) };
    const notifyDelegate = { execute: vi.fn() };
    const notify = new NotifyQualifiedMainnetFundedJob(exposure, () => false, getStatus as never, notifyDelegate as never);

    await expect(notify.execute({ jobId: "97", buyer: "0x1111111111111111111111111111111111111111" }))
      .rejects.toThrow(/disabled/);
    expect(notifyDelegate.execute).not.toHaveBeenCalled();
  });

  it("keeps env flags out of landing, hire and Mainnet demo controllers", () => {
    for (const file of [
      "app/page.tsx",
      "app/hire/[agentId]/page.tsx",
      "app/demo/erc8183-mainnet/page.tsx",
      "components/marketplace/landing-page.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toContain("ERC8183_MAINNET_DEMO_ENABLED");
    }
  });

  it("monitors Mainnet quote and read-only prepare only after public exposure", () => {
    const workflow = readFileSync(".github/workflows/submission-uptime.yml", "utf8");
    expect(workflow).not.toContain("MAINNET_GRID_SELLER_ENABLED");
    expect(workflow).toContain('if [ "$quote_status" = "404" ]');
    expect(workflow).toContain('if [ "$proof_status" = "200" ]');
    expect(workflow).toContain("/api/marketplace/demo/erc8183-mainnet/quote");
    expect(workflow).toContain("/api/marketplace/demo/erc8183-mainnet/prepare");
  });

  it("does not attach release-snapshot qualification to a live profile", async () => {
    const provider = {
      getAgent: vi.fn(async () => ({
        chainId: 56,
        agentId: "45650",
        name: "Cached agent",
        description: null,
        owner: "0x1111111111111111111111111111111111111111",
        metadataUri: null,
        services: [],
        endpoints: [],
        tools: [],
        capabilities: [],
        endpointObservation: {
          status: "not_observed",
          protocol: null,
          endpoint: null,
          lastTestedAt: null,
          httpStatus: null,
          capabilitiesCount: 0,
          requiresAuth: null,
          error: null,
        },
        reputation: { totalFeedbacks: 0, averageScore: null, uniqueReviewers: null },
        trustScore: { total: null, tier: null, dimensions: {}, calculatedAt: null, expiresAt: null },
        categories: [],
        freshness: { fetchedAt: "2026-08-24T12:00:00.000Z", metadataUpdatedAt: null, indexedUpdatedAt: null },
        catalogCoverage: "partial",
        provenance: {},
      })),
    } as unknown as Trust8004Provider;
    const repository = new Trust8004MarketplaceAgentRepository({
      provider,
      cache: new AsyncTtlCache(() => 0),
    });

    expect((await repository.getById("45650"))?.verification).toBeNull();
    expect((await repository.getById("45650"))?.verification).toBeNull();
    expect(provider.getAgent).toHaveBeenCalledTimes(1);
  });
});
