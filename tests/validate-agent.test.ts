import { describe, expect, it, vi } from "vitest";
import { ValidateMarketplaceAgent } from "../src/business/use-cases/validate-marketplace-agent.ts";
import type { AgentValidationEvidence } from "../src/business/entities/agent-validation.ts";

const OBSERVED_AT = "2026-08-26T10:00:00.000Z";

function evidence(overrides: Partial<AgentValidationEvidence> = {}): AgentValidationEvidence {
  return {
    chainId: 56,
    agent: {
      agentId: "303779",
      name: "Marketplace Grid Planner",
      description: "Deterministic grid planning",
      owner: "0x1111111111111111111111111111111111111111",
      metadataUri: "ipfs://grid",
      operator: "third_party",
      indexedAt: OBSERVED_AT,
      declaredServices: [{ name: "A2A", hasEndpoint: true, tools: [] }],
    },
    identity: {
      status: "match",
      ownerMatches: true,
      metadataUriMatches: true,
      agentWallet: "0x2222222222222222222222222222222222222222",
      registryAddress: "0x3333333333333333333333333333333333333333",
      blockNumber: "118077255",
      observedAt: OBSERVED_AT,
      error: null,
    },
    endpointChecks: [{
      protocol: "a2a",
      status: "verified",
      declaredTools: [],
      observedTools: [],
      declaredOnlyTools: [],
      observedOnlyTools: [],
      observedAt: OBSERVED_AT,
      error: null,
    }],
    quote: {
      status: "verified",
      provider: "0x2222222222222222222222222222222222222222",
      currency: "0x4444444444444444444444444444444444444444",
      priceRaw: "1",
      expiresAt: "2026-08-26T10:10:00.000Z",
      observedAt: OBSERVED_AT,
    },
    observationSync: {
      status: "recorded",
      attempted: 2,
      recorded: 2,
      failed: 0,
      notConfigured: 0,
    },
    generatedAt: OBSERVED_AT,
    ...overrides,
  };
}

describe("ValidateMarketplaceAgent", () => {
  it("validates only a numeric BSC Agent ID and never accepts an endpoint", async () => {
    const repository = { validate: vi.fn(async () => evidence()) };
    const useCase = new ValidateMarketplaceAgent(repository, () => Date.parse(OBSERVED_AT));

    await expect(useCase.execute({ agentId: "abc" })).rejects.toThrow("agentId must be numeric");
    expect(repository.validate).not.toHaveBeenCalled();
    await useCase.execute({ agentId: "303779" });
    expect(repository.validate).toHaveBeenCalledWith("303779");
  });

  it("returns a read-only evaluation without category assignment or automatic promotion", async () => {
    const report = await new ValidateMarketplaceAgent(
      { validate: async () => evidence() },
      () => Date.parse("2026-08-26T10:05:00.000Z"),
    ).execute({ agentId: "303779" });

    expect(report).toMatchObject({
      chainId: 56,
      classification: { status: "not_assigned", categories: [] },
      promotion: { status: "manual_review_required" },
      qualification: { status: "quote_verified_candidate", canHire: false },
      evidence: { observationSync: { status: "recorded", attempted: 2, recorded: 2 } },
      passport: { state: "evaluated", checks: { quote: { status: "verified" } } },
    });
  });

  it("keeps failed or unprobed endpoints visible and does not invent quote evidence", async () => {
    const report = await new ValidateMarketplaceAgent(
      { validate: async () => evidence({
        endpointChecks: [{
          protocol: "mcp",
          status: "not_probed",
          declaredTools: ["rebalance"],
          observedTools: [],
          declaredOnlyTools: [],
          observedOnlyTools: [],
          observedAt: null,
          error: { code: "PROBE_BUDGET_EXHAUSTED", message: "The endpoint was not probed." },
        }],
        quote: { status: "not_requested", provider: null, currency: null, priceRaw: null, expiresAt: null, observedAt: null },
      }) },
    ).execute({ agentId: "303779" });

    expect(report.status).toBe("attention_required");
    expect(report.evidence.endpointChecks[0]?.status).toBe("not_probed");
    expect(report.qualification).toMatchObject({ status: "not_qualified", canHire: false });
    expect(report.passport.checks.quote.status).toBe("missing");
  });

  it("keeps report and Passport attention states consistent after a failed probe", async () => {
    const failed = evidence({
      endpointChecks: [{
        protocol: "a2a",
        status: "failed",
        declaredTools: [],
        observedTools: [],
        declaredOnlyTools: [],
        observedOnlyTools: [],
        observedAt: OBSERVED_AT,
        error: { code: "PROBE_FAILED", message: "The seller endpoint did not complete validation." },
      }],
      quote: { status: "invalid", provider: null, currency: null, priceRaw: null, expiresAt: null, observedAt: OBSERVED_AT },
    });
    const report = await new ValidateMarketplaceAgent({ validate: async () => failed }).execute({ agentId: "303779" });

    expect(report.status).toBe("attention_required");
    expect(report.passport.state).toBe("attention");
  });
});
