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

function snapshot(
  status: "qualified" | "not_qualified",
  staleAfter = "2026-08-27T12:00:00.000Z",
  selection: "marketplace_operated" | "operator_explicit" = "marketplace_operated",
) {
  return {
    schemaVersion: 2 as const,
    generatedAt: "2026-08-24T12:00:00.000Z",
    staleAfter,
    chainId: 56 as const,
    blockNumber: "123",
    registryAddress: "0x1111111111111111111111111111111111111111",
    source: "marketplace-verification-release-snapshot" as const,
    agents: [{
      agentId: "9001",
      name: "Marketplace Grid planner",
      categories: ["grid_trading" as const],
      selection,
      operator: selection === "marketplace_operated" ? "marketplace" as const : "third_party" as const,
      qualification: {
        status,
        observedAt: "2026-08-24T12:00:00.000Z",
        provenance: "derived:marketplace-seller-qualification" as const,
      },
      identity: {
        status: "match" as const,
        mismatchFields: [],
        observedAt: "2026-08-24T12:00:00.000Z",
        provenance: ["declared", "onchain"] as const,
      },
      tools: {
        status: "observed" as const,
        probeOutcomes: ["protocol_valid" as const],
        reachability: "verified" as const,
        declaredOnly: [],
        observedOnly: [],
        observedAt: "2026-08-24T12:00:00.000Z",
        provenance: "observed" as const,
      },
    }],
  };
}

describe("PR 16 Mainnet exposure", () => {
  it("requires current qualification before reading configuration or exposing the demo", () => {
    const getPublicConfig = vi.fn(() => demoConfig);
    const unqualified = new GetMainnetHiringExposure(
      { getSnapshot: () => snapshot("not_qualified") },
      { getPublicConfig },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    expect(unqualified.execute()).toEqual({ qualifiedSeller: null, demoConfig: null });
    expect(getPublicConfig).not.toHaveBeenCalled();

    const stale = new GetMainnetHiringExposure(
      { getSnapshot: () => snapshot("qualified") },
      { getPublicConfig },
      () => Date.parse("2026-08-27T12:00:00.001Z"),
    );
    expect(stale.execute()).toEqual({ qualifiedSeller: null, demoConfig: null });
    expect(getPublicConfig).not.toHaveBeenCalled();

    const current = new GetMainnetHiringExposure(
      { getSnapshot: () => snapshot("qualified") },
      { getPublicConfig },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    expect(current.execute()).toMatchObject({
      qualifiedSeller: { agentId: "9001" },
      demoConfig: { agentId: 9001 },
    });

    const explicitOnly = new GetMainnetHiringExposure(
      { getSnapshot: () => snapshot("qualified", "2026-08-27T12:00:00.000Z", "operator_explicit") },
      { getPublicConfig },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    expect(explicitOnly.execute()).toEqual({ qualifiedSeller: null, demoConfig: null });
  });

  it("blocks quote and prepare before current qualification reaches business composition", () => {
    const exposure = new GetMainnetHiringExposure(
      { getSnapshot: () => snapshot("not_qualified") },
      { getPublicConfig: vi.fn(() => demoConfig) },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    const quoteDelegate = { execute: vi.fn() };
    const prepareDelegate = { execute: vi.fn() };
    const quote = new RequestQualifiedMainnetQuote(exposure, quoteDelegate as never);
    const prepare = new PrepareQualifiedMainnetHire(exposure, () => true, prepareDelegate as never);

    expect(() => quote.execute()).toThrow(/disabled/);
    expect(() => prepare.execute({} as never)).toThrow(/disabled/);
    expect(quoteDelegate.execute).not.toHaveBeenCalled();
    expect(prepareDelegate.execute).not.toHaveBeenCalled();
  });

  it("does not return a fundable Mainnet plan while the write gate is disabled", () => {
    const exposure = new GetMainnetHiringExposure(
      { getSnapshot: () => snapshot("qualified") },
      { getPublicConfig: () => demoConfig },
      () => Date.parse("2026-08-24T12:01:00.000Z"),
    );
    const prepareDelegate = { execute: vi.fn() };
    const prepare = new PrepareQualifiedMainnetHire(exposure, () => false, prepareDelegate as never);

    expect(() => prepare.execute({} as never)).toThrow(/disabled/);
    expect(prepareDelegate.execute).not.toHaveBeenCalled();
  });

  it("requires the independent write gate before marketplace notify", async () => {
    const exposure = new GetMainnetHiringExposure(
      { getSnapshot: () => snapshot("qualified") },
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
      { getSnapshot: () => snapshot("qualified") },
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
      { getSnapshot: () => snapshot("qualified") },
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
