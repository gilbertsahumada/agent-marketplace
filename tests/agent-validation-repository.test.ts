import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { HireabilityAssessment } from "../src/readiness/types.ts";
import type { MarketplaceAgent } from "../src/trust8004/types.ts";
import type { BscVerificationReport } from "../src/verification/types.ts";
import type { BuildVerificationReportOptions } from "../src/verification/report.ts";
import type { BscCandidateInventory } from "../src/trust8004/types.ts";

vi.mock("server-only", () => ({}));

const { Trust8004AgentValidationRepository } = await import(
  "../src/data/repositories/trust8004-agent-validation-repository.ts"
);

const OBSERVED_AT = "2026-08-26T10:00:00.000Z";
const AGENT_WALLET = "0x2222222222222222222222222222222222222222" as Address;
const REGISTRY = "0x3333333333333333333333333333333333333333" as Address;
const CURRENCY = "0x4444444444444444444444444444444444444444" as Address;

const agent = {
  chainId: 56,
  agentId: "303779",
  name: "Marketplace Grid Planner",
  description: "Deterministic grid planning",
  owner: "0x1111111111111111111111111111111111111111",
  metadataUri: "ipfs://grid",
  services: [{ name: "A2A", endpoint: "https://seller.example/a2a?secret=redacted", version: null, tools: [], capabilities: [] }],
  endpoints: [],
  tools: [],
  capabilities: [],
  reputation: { totalFeedbacks: 0, averageScore: null, uniqueReviewers: 0 },
  trustScore: { total: 0, tier: "Unrated", dimensions: {}, calculatedAt: OBSERVED_AT, expiresAt: OBSERVED_AT },
  categories: [],
  endpointObservation: { status: "not_observed", protocol: null, endpoint: null, lastTestedAt: null, httpStatus: null, capabilitiesCount: 0, requiresAuth: null, error: null },
  freshness: { fetchedAt: OBSERVED_AT, metadataUpdatedAt: null, indexedUpdatedAt: OBSERVED_AT },
  catalogCoverage: "partial",
  provenance: {},
} as unknown as MarketplaceAgent;

const identity = {
  status: "match" as const,
  declared: { owner: agent.owner, metadataUri: agent.metadataUri, provenance: "declared:trust8004-public-api" as const },
  onchain: { owner: agent.owner as Address, agentWallet: AGENT_WALLET, metadataUri: agent.metadataUri, registryAddress: REGISTRY, blockNumber: "123", provenance: "onchain:bsc-rpc" as const },
  checks: { ownerMatches: true, metadataUriMatches: true },
  observedAt: OBSERVED_AT,
  error: null,
};

const verification = {
  schemaVersion: 2,
  generatedAt: OBSERVED_AT,
  chainId: 56,
  catalog: { source: "trust8004", coverage: "partial", snapshotGeneratedAt: OBSERVED_AT },
  onchain: { network: "bsc-mainnet", registryAddress: REGISTRY, blockNumber: "123" },
  categories: {},
  summary: { status: "complete", agentsTotal: 1, identityMatches: 1, identityAttention: 0, endpointsTotal: 0, endpointsValid: 0, endpointsNotProbed: 0, endpointAttention: 0, agentsWithoutMcpEndpoint: 1, toolDriftEndpoints: 0 },
  agents: [{ agentId: agent.agentId, name: agent.name, categories: [], identity, mcpEndpoints: [], hireability: "not_assessed" }],
} as unknown as BscVerificationReport;

const activation = {
  transport: "a2a",
  declaredSellerProtocols: ["a2a"],
  quoteStatus: "verified",
  hireability: "quote_verified",
  protocols: [{
    transport: "a2a",
    endpoint: "https://seller.example/a2a?secret=redacted",
    status: "quote_verified",
    quoteStatus: "verified",
    agentCardSkills: ["negotiate-erc8183-job", "notify_funded"],
    healthObserved: null,
    statusObserved: null,
    quote: {
      provider: AGENT_WALLET,
      price: "1",
      currency: CURRENCY,
      quoteExpiresAt: 1_787_741_400,
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    provenance: "declared:trust8004-public-api+observed:marketplace-probe",
    error: null,
  }],
  probe: { totalDeclaredEndpoints: 1, evaluatedEndpoints: 1, skippedEndpoints: 0, truncated: false },
  note: "Verified",
  provenance: "derived:marketplace-readiness",
} as unknown as HireabilityAssessment;

describe("Trust8004AgentValidationRepository", () => {
  it("deduplicates validation, evaluates only the requested profile, and removes endpoint URLs", async () => {
    const provider = { getAgent: vi.fn(async () => agent) };
    const buildVerificationReport = vi.fn(async (_options: BuildVerificationReportOptions) => verification);
    const assessHireability = vi.fn(async () => activation);
    const repository = new Trust8004AgentValidationRepository({
      provider,
      identityReader: {} as never,
      buildVerificationReport,
      assessHireability,
      syncObservation: vi.fn(async () => ({ status: "recorded" as const })),
      marketplaceOperatedGridSellerAgentId: "303779",
      now: () => Date.parse(OBSERVED_AT),
    });

    const [first, second] = await Promise.all([
      repository.validate("303779"),
      repository.validate("303779"),
    ]);

    expect(first).toEqual(second);
    expect(provider.getAgent).toHaveBeenCalledOnce();
    expect(buildVerificationReport).toHaveBeenCalledOnce();
    expect(assessHireability).toHaveBeenCalledOnce();
    const inventory = buildVerificationReport.mock.calls[0]![0].inventory as BscCandidateInventory;
    expect(inventory.agents.map(({ agentId }: MarketplaceAgent) => agentId)).toEqual(["303779"]);
    expect(Object.values(inventory.categories).every((category) => category.agentIds.length === 0)).toBe(true);
    expect(first).toMatchObject({
      agent: { agentId: "303779", operator: "marketplace" },
      quote: { status: "verified", priceRaw: "1" },
      observationSync: { status: "recorded", attempted: 2, recorded: 2, failed: 0, notConfigured: 0 },
    });
    expect(JSON.stringify(first)).not.toContain("seller.example");
    expect(JSON.stringify(first)).not.toContain("secret=redacted");
  });

  it("reports when marketplace observations were not persisted", async () => {
    const repository = new Trust8004AgentValidationRepository({
      provider: { getAgent: vi.fn(async () => agent) },
      identityReader: {} as never,
      buildVerificationReport: vi.fn(async () => verification),
      assessHireability: vi.fn(async () => activation),
      syncObservation: vi.fn(async () => ({ status: "not_configured" as const })),
      now: () => Date.parse(OBSERVED_AT),
    });

    await expect(repository.validate("303779")).resolves.toMatchObject({
      observationSync: {
        status: "not_configured",
        attempted: 2,
        recorded: 0,
        failed: 0,
        notConfigured: 2,
      },
    });
  });

  it("does not publish endpoint URLs or bearer material embedded in probe errors", async () => {
    const leakyVerification = {
      ...verification,
      agents: [{
        ...verification.agents[0]!,
        mcpEndpoints: [{
          status: "protocol_error",
          endpoint: "https://private.example/mcp?token=top-secret",
          protocol: "mcp",
          declaredTools: [],
          observedTools: [],
          comparison: { matched: [], declaredOnly: [], observedOnly: [] },
          negotiatedProtocolVersion: null,
          serverInfo: null,
          latencyMs: 1,
          observedAt: OBSERVED_AT,
          provenance: "observed:mcp-tools-list",
          error: {
            code: "MCP_PROTOCOL_ERROR",
            message: "Request to https://private.example/mcp failed with Bearer top-secret",
          },
        }],
      }],
    } as BscVerificationReport;
    const leakyActivation = {
      ...activation,
      quoteStatus: "unavailable",
      hireability: "unreachable",
      protocols: [{
        ...activation.protocols[0]!,
        status: "unreachable",
        quoteStatus: "unavailable",
        quote: null,
        error: {
          code: "SELLER_UNREACHABLE",
          message: "Could not reach https://private.example/a2a?authorization=Bearer-top-secret",
        },
      }],
    } as HireabilityAssessment;
    const repository = new Trust8004AgentValidationRepository({
      provider: { getAgent: vi.fn(async () => agent) },
      identityReader: {} as never,
      buildVerificationReport: vi.fn(async () => leakyVerification),
      assessHireability: vi.fn(async () => leakyActivation),
      now: () => Date.parse(OBSERVED_AT),
    });

    const result = await repository.validate("303779");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/private\.example|top-secret|authorization|bearer/i);
    expect(result?.endpointChecks.map(({ error }) => error?.code)).toEqual([
      "MCP_PROTOCOL_ERROR",
      "SELLER_UNREACHABLE",
    ]);
  });

  it("does not publish RPC URLs or credentials embedded in identity errors", async () => {
    const leakyIdentityVerification = {
      ...verification,
      agents: [{
        ...verification.agents[0]!,
        identity: {
          ...identity,
          status: "read_error",
          error: {
            code: "RPC_READ_FAILED",
            message: "Request to https://rpc.example/v1/top-secret failed with Bearer private-token",
          },
        },
      }],
    } as BscVerificationReport;
    const repository = new Trust8004AgentValidationRepository({
      provider: { getAgent: vi.fn(async () => agent) },
      identityReader: {} as never,
      buildVerificationReport: vi.fn(async () => leakyIdentityVerification),
      assessHireability: vi.fn(async () => ({
        ...activation,
        quoteStatus: "unavailable",
        hireability: "unreachable",
        protocols: [],
      } as unknown as HireabilityAssessment)),
      now: () => Date.parse(OBSERVED_AT),
    });

    const result = await repository.validate("303779");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/rpc\.example|top-secret|private-token|bearer/i);
    expect(result?.identity.error).toEqual({
      code: "RPC_READ_FAILED",
      message: "The direct BSC identity read did not complete validation.",
    });
  });
});
