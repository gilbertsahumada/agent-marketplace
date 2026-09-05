import { describe, expect, it } from "vitest";
import { deriveCatalogEvidenceState, selectBestCapability } from "../src/catalog/evidence-policy";

describe("requestable negotiation evidence", () => {
  for (const transport of ["a2a", "mcp", "erc8183_http"] as const) {
    it(`${transport} needs usable requirements, not a prior quote`, () => {
      const input = { endpoints: [{ endpointKey: "seller", role: "operational", eligibility: "eligible", validationProtocol: transport }], observations: [], admission: null, nowMs: 1000 };
      expect(deriveCatalogEvidenceState(input).canRequestQuote).toBe(false);
      expect(deriveCatalogEvidenceState({ ...input, capability: { state: "discovered", endpointKey: "seller", transport, schemaHash: "schema", compatibilityState: "compatible", compatibilityCheckedAt: 900, compatibilityExpiresAt: 2000 } }).canRequestQuote).toBe(true);
      expect(deriveCatalogEvidenceState({ ...input, capability: { state: "ready", endpointKey: "seller", transport, capabilityExpiresAt: 3000, compatibilityState: "compatible", compatibilityCheckedAt: 900, compatibilityExpiresAt: 999 } }).canRequestQuote).toBe(false);
    });
  }
  it("shared quote evidence never authorizes another buyer", () => {
    const state = deriveCatalogEvidenceState({ endpoints: [], observations: [], admission: null, nowMs: 1000 });
    expect(state.canPrepareHire).toBe(false);
  });
  it("rejects a later failure only on the selected negotiation endpoint", () => {
    const endpoint = (endpointKey: string) => ({ endpointKey, role: "operational", eligibility: "eligible", validationProtocol: "a2a" });
    const input = { endpoints: [endpoint("seller"), endpoint("other")], admission: null, nowMs: 1000, capability: { state: "discovered" as const, endpointKey: "seller", schemaHash: "schema", compatibilityState: "compatible", compatibilityCheckedAt: 900, compatibilityExpiresAt: 2000 } };
    const failure = { id: 1, endpointKey: "other", source: "worker_probe", validationKind: "protocol", verificationLevel: "platform_observed", outcome: "http_error", observedAt: 950, expiresAt: 1500 };
    expect(deriveCatalogEvidenceState({ ...input, observations: [failure] }).canRequestQuote).toBe(true);
    expect(deriveCatalogEvidenceState({ ...input, observations: [{ ...failure, endpointKey: "seller" }] }).canRequestQuote).toBe(false);
  });
  it("prefers a usable first-time seller endpoint over unverifiable historical readiness", () => {
    expect(selectBestCapability([
      { state: "ready", endpointKey: "old", capabilityExpiresAt: 2000 },
      { state: "discovered", endpointKey: "new", compatibilityState: "compatible", schemaHash: "schema", compatibilityExpiresAt: 2000 },
    ], 1000)?.endpointKey).toBe("new");
  });
  it.each(["failed", "retired"])("selects valid B instead of %s ready A", mode => {
    const rows = [
      { state: "ready" as const, endpointKey: "a", capabilityExpiresAt: 2000, compatibilityState: "compatible", schemaHash: "a", compatibilityCheckedAt: 800, compatibilityExpiresAt: 2000 },
      { state: "discovered" as const, endpointKey: "b", compatibilityState: "compatible", schemaHash: "b", compatibilityCheckedAt: 800, compatibilityExpiresAt: 2000 },
    ];
    const endpoints = (mode === "retired" ? ["b"] : ["a", "b"]).map(endpointKey => ({ endpointKey, role: "operational", eligibility: "eligible", validationProtocol: "a2a" }));
    const observations = mode === "failed" ? [{ id: 1, endpointKey: "a", source: "worker_probe", validationKind: "protocol", verificationLevel: "platform_observed", outcome: "http_error", observedAt: 900, expiresAt: 1500 }] : [];
    expect(selectBestCapability(rows, 1000, { endpoints, observations })?.endpointKey).toBe("b");
  });
});
