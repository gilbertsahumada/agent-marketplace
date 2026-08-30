import { describe, expect, it, vi } from "vitest";
import type { PublicVerificationSnapshot } from "../src/business/entities/public-verification-snapshot.ts";
import { ReleaseVerifiedMarketplaceAgentRepository } from "../src/data/repositories/release-verified-marketplace-agent-repository.ts";
import type {
  MarketplaceAgentData,
  MarketplaceAgentRepository,
} from "../src/data/repositories/marketplace-agent-repository.ts";

const GENERATED_AT = "2026-08-30T19:04:05.250Z";

function record(agentId: string): MarketplaceAgentData {
  return { agentId, verification: null } as MarketplaceAgentData;
}

function snapshot(): PublicVerificationSnapshot {
  return {
    schemaVersion: 2,
    generatedAt: GENERATED_AT,
    staleAfter: "2026-09-02T19:04:05.250Z",
    chainId: 56,
    blockNumber: "119010999",
    registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    source: "marketplace-verification-release-snapshot",
    agents: [{
      agentId: "45422",
      name: "Beefy powered by HeyAnon",
      categories: ["yield_optimisation"],
      selection: "curated",
      operator: "third_party",
      qualification: {
        status: "not_qualified",
        observedAt: GENERATED_AT,
        provenance: "derived:marketplace-seller-qualification",
      },
      identity: {
        status: "match",
        mismatchFields: [],
        observedAt: GENERATED_AT,
        provenance: ["declared", "onchain"],
      },
      tools: {
        status: "observed",
        probeOutcomes: ["protocol_valid"],
        reachability: "verified",
        declaredOnly: [],
        observedOnly: [],
        observedAt: "2026-08-30T19:04:07.736Z",
        provenance: "observed",
      },
    }],
  };
}

describe("ReleaseVerifiedMarketplaceAgentRepository", () => {
  it("attaches current release evidence to matching catalogue records", async () => {
    const source = {
      listRegisteredPage: vi.fn(async () => ({
        items: [record("45422"), record("45650")],
        total: 2,
        limit: 24,
        offset: 0,
        fetchedAt: GENERATED_AT,
        catalogCoverage: "partial" as const,
      })),
      getById: vi.fn(async (agentId: string) => record(agentId)),
      getOnchainIdentity: vi.fn(),
    } satisfies MarketplaceAgentRepository;
    const repository = new ReleaseVerifiedMarketplaceAgentRepository(
      source,
      { getSnapshot: snapshot },
      () => Date.parse("2026-08-30T20:00:00.000Z"),
    );

    const beefy = await repository.getById("45422");
    const page = await repository.listRegisteredPage({ page: 1, limit: 24 });

    expect(beefy?.verification).toMatchObject({
      freshness: "current",
      generatedAt: GENERATED_AT,
      blockNumber: "119010999",
      tools: { reachability: "verified", probeOutcomes: ["protocol_valid"] },
    });
    expect(page.items[0]?.verification?.freshness).toBe("current");
    expect(page.items[1]?.verification).toBeNull();
  });
});
