import { describe, expect, it } from "vitest";
import { catalogBlockingMessage, catalogCandidateCard } from "../components/marketplace/catalog-candidate-view-model.ts";
import type { CatalogCandidate } from "../src/business/entities/catalog-candidate.ts";

const NOW = 1_788_000_000_000;

function candidate(): CatalogCandidate {
  return {
    agentKey: "eip155:56:42", agentId: "42", chainId: 56, owner: null, metadataUri: null,
    name: "Agent", description: null,
    imageUrl: null, categories: [], marketplaceConfigured: false, metadataState: "ok",
    registeredAt: null, blockNumber: null, priority: 60,
    declarations: [{ endpointKey: "a".repeat(64), protocol: "a2a", endpoint: "https://agent.example/a2a",
      originKey: "b".repeat(64), safety: "safe", safetyReason: null, representativeAgentKey: null,
      lastProbedAt: null, nextProbeAt: 0, consecutiveFailures: 0, priority: 60 }],
    observations: [],
  };
}

describe("catalog candidate card", () => {
  it.each([
    ["NO_ELIGIBLE_OPERATIONAL_ENDPOINT", "No supported operational endpoint is available for marketplace hiring."],
    ["NO_QUOTE_TRANSPORT", "No compatible negotiation transport is available for requesting a quote."],
    ["MCP_QUOTE_TOOL_REQUIRED", "This MCP endpoint is reachable, but it does not expose the required quote tool yet."],
    ["FRESH_QUOTE_REQUIRED", "A fresh seller quote is required before preparing the transaction."],
    ["CURRENT_CHAIN_CHECK_REQUIRED", "Current onchain checks are required before preparing the transaction."],
  ] as const)("maps the production blocker %s to user-facing copy", (reason, message) => {
    expect(catalogBlockingMessage([reason])).toBe(message);
  });

  it("combines production blockers and reports unknown blocker codes only once", () => {
    expect(catalogBlockingMessage([
      "NO_ELIGIBLE_OPERATIONAL_ENDPOINT",
      "FRESH_QUOTE_REQUIRED",
      "SOMETHING_NEW",
      "SOMETHING_NEW",
      "ANOTHER_NEW",
    ])).toBe(
      "No supported operational endpoint is available for marketplace hiring. "
      + "A fresh seller quote is required before preparing the transaction. "
      + "The marketplace returned an unsupported hiring blocker and failed closed.",
    );
  });

  it("does not promote browser evidence to reachable", () => {
    const value = candidate();
    value.observations.push({ id: 1, agentKey: value.agentKey, endpointKey: "a".repeat(64),
      protocol: "a2a", source: "browser_reported", outcome: "protocol_valid", observedAt: NOW,
      expiresAt: NOW + 900_000, httpStatus: 200, errorCode: null, durationMs: 12, details: {} });
    const card = catalogCandidateCard(value, NOW);
    expect(card.evidence.find(({ kind }) => kind === "reachable")).toMatchObject({ status: "unknown" });
    expect(card.monitoring).toMatchObject({ state: "never_probed" });
  });

  it("shows fresh platform reachability and enables quote requests from the normalized state", () => {
    const value = candidate();
    value.marketplaceConfigured = true;
    value.state = {
      operationalStatus: "platform_reachable",
      freshness: "live",
      commerceStatus: "declared",
      quoteStatus: "not_requested",
      buyerAction: "request_quote",
      canRequestBrowserValidation: true,
      canRequestInfrastructureValidation: true,
      canRequestQuote: true,
      canPrepareHire: false,
      blockingReasons: ["FRESH_QUOTE_REQUIRED"],
    };
    value.platformAttemptCount = 17;
    value.observations.push({ id: 2, agentKey: value.agentKey, endpointKey: "a".repeat(64),
      protocol: "a2a", source: "worker_probe", outcome: "protocol_valid", observedAt: NOW,
      expiresAt: NOW + 900_000, httpStatus: 200, errorCode: null, durationMs: 20, details: {} });
    const card = catalogCandidateCard(value, NOW);
    expect(card.evidence.find(({ kind }) => kind === "reachable")).toMatchObject({ status: "verified" });
    expect(card.quoteRequestAvailable).toBe(true);
    expect(card.buyerAction).toBe("request_quote");
    expect(card.blockingReasons).toEqual(["FRESH_QUOTE_REQUIRED"]);
    expect(card.monitoring).toMatchObject({ attemptCount: 17 });
    expect(card.protocols).toEqual(["A2A"]);
  });

  it("surfaces every declared transport as a deduplicated card badge", () => {
    const value = candidate();
    value.declarations.push(
      { ...value.declarations[0]!, endpointKey: "b".repeat(64), protocol: "mcp", declaredProtocol: "mcp" },
      { ...value.declarations[0]!, endpointKey: "c".repeat(64), protocol: "erc8183_http", declaredProtocol: "erc8183_http" },
      { ...value.declarations[0]!, endpointKey: "d".repeat(64), protocol: "a2a", declaredProtocol: "a2a" },
    );

    expect(catalogCandidateCard(value, NOW).protocols).toEqual(["A2A", "MCP", "ERC-8183 HTTP"]);
  });

  it.each([
    ["unavailable", false, false, ["NO_COMMERCE_PATH"]],
    ["check_availability", false, false, ["PLATFORM_EVIDENCE_REQUIRED"]],
    ["request_quote", true, false, ["FRESH_QUOTE_REQUIRED"]],
    ["prepare_hire", true, true, []],
  ] as const)("preserves the normalized %s buyer action and blockers", (
    buyerAction,
    canRequestQuote,
    canPrepareHire,
    blockingReasons,
  ) => {
    const value = candidate();
    value.state = {
      operationalStatus: "pending",
      freshness: "never",
      commerceStatus: canRequestQuote ? "admitted" : "declared",
      quoteStatus: canPrepareHire ? "verified_fresh" : "not_requested",
      buyerAction,
      canRequestBrowserValidation: buyerAction === "check_availability",
      canRequestInfrastructureValidation: buyerAction === "check_availability",
      canRequestQuote,
      canPrepareHire,
      blockingReasons: [...blockingReasons],
    };

    expect(catalogCandidateCard(value, NOW)).toMatchObject({
      buyerAction,
      blockingReasons,
      quoteRequestAvailable: canRequestQuote,
    });
  });

  it("does not surface platform evidence from an external declaration", () => {
    const value = candidate();
    value.declarations[0] = {
      ...value.declarations[0]!,
      role: "operational",
      validationProtocol: "a2a",
      eligibility: "eligible",
    };
    value.declarations.push({
      endpointKey: "c".repeat(64), protocol: "web", endpoint: "https://agent.example/site",
      originKey: "d".repeat(64), safety: "safe", safetyReason: null, representativeAgentKey: null,
      lastProbedAt: NOW, nextProbeAt: null, consecutiveFailures: 0, priority: 20,
      role: "external", validationProtocol: null, eligibility: "unsupported",
    });
    value.observations.push({ id: 8, agentKey: value.agentKey, endpointKey: "c".repeat(64),
      protocol: "web", source: "worker_probe", outcome: "protocol_valid", observedAt: NOW,
      expiresAt: NOW + 900_000, httpStatus: 200, errorCode: null, durationMs: 20, details: {} });

    const card = catalogCandidateCard(value, NOW);

    expect(card.evidence.find(({ kind }) => kind === "reachable")).toMatchObject({
      status: "unknown",
      provenance: "not_probed",
    });
    expect(card.monitoring).toMatchObject({ state: "never_probed", attemptCount: 0 });
  });

  it("does not treat onchain evidence as a platform reachability attempt", () => {
    const value = candidate();
    value.observations.push({ id: 11, agentKey: value.agentKey, endpointKey: "a".repeat(64),
      protocol: "erc8183", source: "chain_read", outcome: "protocol_valid", observedAt: NOW,
      expiresAt: NOW + 900_000, httpStatus: null, errorCode: null, durationMs: 20, details: {},
      validationKind: "chain", verificationLevel: "onchain" });

    const card = catalogCandidateCard(value, NOW);

    expect(card.evidence.find(({ kind }) => kind === "reachable")).toMatchObject({
      status: "unknown",
      provenance: "not_probed",
    });
    expect(card.monitoring).toMatchObject({ state: "never_probed", attemptCount: 0 });
  });

  it("treats a fresh bridged A2A quote as both reachable and quote verified", () => {
    const value = candidate();
    value.marketplaceConfigured = true;
    value.state = {
      operationalStatus: "platform_reachable",
      freshness: "live",
      commerceStatus: "admitted",
      quoteStatus: "verified_fresh",
      buyerAction: "prepare_hire",
      canRequestBrowserValidation: true,
      canRequestInfrastructureValidation: true,
      canRequestQuote: true,
      canPrepareHire: true,
      blockingReasons: [],
    };
    value.observations.push({ id: 3, agentKey: value.agentKey, endpointKey: null,
      protocol: "a2a", source: "marketplace_probe", outcome: "quote_verified", observedAt: NOW,
      expiresAt: NOW + 900_000, httpStatus: null, errorCode: null, durationMs: 20,
      details: { legacyObservationId: 7 } });

    const card = catalogCandidateCard(value, NOW);

    expect(card.evidence.find(({ kind }) => kind === "reachable")).toMatchObject({
      status: "verified",
      provenance: "observed",
      timestamp: new Date(NOW).toISOString(),
    });
    expect(card.evidence.find(({ kind }) => kind === "quote")).toMatchObject({
      status: "verified",
      provenance: "observed",
      timestamp: new Date(NOW).toISOString(),
    });
  });

  it("never infers quote availability from the legacy marketplace flag", () => {
    const value = candidate();
    value.marketplaceConfigured = true;

    const card = catalogCandidateCard(value, NOW);

    expect(card.quoteRequestAvailable).toBe(false);
    expect(card.hireability).toBe("listed_only");
  });

  it("treats buyer refresh evidence as platform evidence", () => {
    const value = candidate();
    value.state = {
      operationalStatus: "platform_reachable",
      freshness: "live",
      commerceStatus: "declared",
      quoteStatus: "not_requested",
      buyerAction: "request_quote",
      canRequestBrowserValidation: true,
      canRequestInfrastructureValidation: true,
      canRequestQuote: true,
      canPrepareHire: false,
      blockingReasons: ["FRESH_QUOTE_REQUIRED"],
    };
    value.observations.push({ id: 4, agentKey: value.agentKey, endpointKey: "a".repeat(64),
      protocol: "a2a", source: "buyer_refresh", outcome: "protocol_valid", observedAt: NOW,
      expiresAt: NOW + 900_000, httpStatus: 200, errorCode: null, durationMs: 20, details: {} });

    expect(catalogCandidateCard(value, NOW).evidence.find(({ kind }) => kind === "reachable"))
      .toMatchObject({ status: "verified", provenance: "observed" });
  });

  it("explains when the last successful platform probe is stale", () => {
    const value = candidate();
    value.observations.push({ id: 10, agentKey: value.agentKey, endpointKey: "a".repeat(64),
      protocol: "a2a", source: "worker_probe", outcome: "protocol_valid", observedAt: NOW - 1_000_000,
      expiresAt: NOW - 1, httpStatus: 200, errorCode: null, durationMs: 20, details: {} });

    const reachable = catalogCandidateCard(value, NOW).evidence.find(({ kind }) => kind === "reachable");

    expect(reachable).toMatchObject({ status: "unknown", provenance: "observed" });
    expect(reachable?.detail).toMatch(/stale|older than/i);
    expect(reachable?.timestamp).toBe(new Date(NOW - 1_000_000).toISOString());
  });

  it("uses the latest quote outcome instead of reviving an older verified quote", () => {
    const value = candidate();
    value.state = {
      operationalStatus: "platform_reachable",
      freshness: "live",
      commerceStatus: "admitted",
      quoteStatus: "rejected",
      buyerAction: "request_quote",
      canRequestBrowserValidation: true,
      canRequestInfrastructureValidation: true,
      canRequestQuote: true,
      canPrepareHire: false,
      blockingReasons: ["FRESH_QUOTE_REQUIRED"],
    };
    value.observations.push(
      { id: 5, agentKey: value.agentKey, endpointKey: "a".repeat(64), protocol: "a2a", source: "buyer_refresh",
        outcome: "quote_verified", observedAt: NOW - 1_000, expiresAt: NOW + 900_000, httpStatus: 200,
        errorCode: null, durationMs: 20, details: {} },
      { id: 6, agentKey: value.agentKey, endpointKey: "a".repeat(64), protocol: "a2a", source: "buyer_refresh",
        outcome: "quote_rejected", observedAt: NOW, expiresAt: null, httpStatus: 422,
        errorCode: "QUOTE_REJECTED", durationMs: 20, details: {} },
    );

    const card = catalogCandidateCard(value, NOW);
    expect(card.evidence.find(({ kind }) => kind === "quote")).toMatchObject({ status: "failed" });
    expect(card.hireability).toBe("listed_only");
  });

  it("does not reuse quote evidence from a different admitted endpoint", () => {
    const value = candidate();
    const admittedEndpointKey = "b".repeat(64);
    value.declarations.push({
      endpointKey: admittedEndpointKey, protocol: "erc8183_http", endpoint: "https://agent.example/jobs",
      originKey: "e".repeat(64), safety: "safe", safetyReason: null, representativeAgentKey: null,
      lastProbedAt: null, nextProbeAt: NOW, consecutiveFailures: 0, priority: 80,
      role: "operational", validationProtocol: "erc8183_http", eligibility: "eligible",
    });
    value.admission = { state: "admitted", endpointKey: admittedEndpointKey };
    value.state = {
      operationalStatus: "platform_reachable",
      freshness: "live",
      commerceStatus: "admitted",
      quoteStatus: "not_requested",
      buyerAction: "request_quote",
      canRequestBrowserValidation: true,
      canRequestInfrastructureValidation: true,
      canRequestQuote: true,
      canPrepareHire: false,
      blockingReasons: ["FRESH_QUOTE_REQUIRED"],
    };
    value.observations.push({
      id: 9, agentKey: value.agentKey, endpointKey: "a".repeat(64), protocol: "a2a",
      source: "browser_reported", outcome: "quote_verified", observedAt: NOW,
      expiresAt: NOW + 900_000, httpStatus: 200, errorCode: null, durationMs: 20, details: {},
      validationKind: "quote", verificationLevel: "cryptographic", artifactHash: "a".repeat(64),
    });

    const card = catalogCandidateCard(value, NOW);

    expect(card.evidence.find(({ kind }) => kind === "quote")).toMatchObject({ status: "unknown" });
    expect(card.hireability).toBe("listed_only");
  });

  it("surfaces a cryptographically verified browser quote as verified transport", () => {
    const value = candidate();
    value.state = {
      operationalStatus: "pending",
      freshness: "never",
      commerceStatus: "admitted",
      quoteStatus: "verified_fresh",
      buyerAction: "prepare_hire",
      canRequestBrowserValidation: true,
      canRequestInfrastructureValidation: true,
      canRequestQuote: true,
      canPrepareHire: true,
      blockingReasons: [],
    };
    value.observations.push({
      id: 7, agentKey: value.agentKey, endpointKey: "a".repeat(64), protocol: "a2a",
      source: "browser_reported", outcome: "quote_verified", observedAt: NOW,
      expiresAt: NOW + 900_000, httpStatus: 200, errorCode: null, durationMs: 30,
      details: {}, validationKind: "quote", verificationLevel: "cryptographic", artifactHash: "f".repeat(64),
    });

    const card = catalogCandidateCard(value, NOW);
    expect(card.evidence.find(({ kind }) => kind === "quote")).toMatchObject({ status: "verified" });
    expect(card.evidence.find(({ kind }) => kind === "reachable")).toMatchObject({ status: "verified" });
    expect(card.hireability).toBe("hireable");
  });
});
