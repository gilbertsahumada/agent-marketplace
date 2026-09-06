import { describe, expect, it } from "vitest";
import { deriveCatalogEvidenceState } from "../src/catalog/evidence-policy";

const NOW = 2_000_000;
const endpoint = {
  endpointKey: "endpoint",
  role: "operational",
  eligibility: "eligible",
  validationProtocol: "mcp",
};

function observation(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    endpointKey: "endpoint",
    source: "worker_probe",
    outcome: "protocol_valid",
    observedAt: NOW - 100,
    expiresAt: NOW + 100,
    validationKind: "protocol",
    verificationLevel: "platform_observed",
    ...overrides,
  };
}

describe("catalog effective evidence policy", () => {
  it("downgrades an expired ready capability to stale before deriving buyer actions", () => {
    const state = deriveCatalogEvidenceState({
      endpoints: [{ ...endpoint, validationProtocol: "a2a" }],
      observations: [],
      admission: null,
      capability: {
        endpointKey: "endpoint",
        transport: "a2a",
        state: "ready",
        capabilityExpiresAt: NOW,
        lastAttemptAt: NOW - 1_000,
      },
      nowMs: NOW,
    });

    expect(state).toMatchObject({
      capabilityState: "stale",
      capabilityExpiresAt: NOW,
      canRequestQuote: false,
      buyerAction: "check_availability",
    });
  });

  it("does not treat a ready capability without an expiry as permanently ready", () => {
    const state = deriveCatalogEvidenceState({
      endpoints: [{ ...endpoint, validationProtocol: "a2a" }],
      observations: [],
      admission: null,
      capability: {
        endpointKey: "endpoint",
        transport: "a2a",
        state: "ready",
        capabilityExpiresAt: null,
      },
      nowMs: NOW,
    });

    expect(state).toMatchObject({
      capabilityState: "discovered",
      canRequestQuote: false,
      canPrepareHire: false,
      buyerAction: "check_availability",
    });
  });

  it("uses the latest platform attempt without erasing the previous success timestamp", () => {
    expect(deriveCatalogEvidenceState({
      endpoints: [endpoint],
      observations: [
        observation(),
        observation({ id: 2, outcome: "network_error", observedAt: NOW, expiresAt: null }),
      ],
      admission: null,
      nowMs: NOW,
    })).toMatchObject({ operationalStatus: "platform_failed", freshness: "live" });
  });

  it("lets a newer success supersede an earlier failure", () => {
    expect(deriveCatalogEvidenceState({
      endpoints: [endpoint],
      observations: [
        observation({ outcome: "network_error", expiresAt: null }),
        observation({ id: 2, observedAt: NOW }),
      ],
      admission: null,
      nowMs: NOW,
    })).toMatchObject({ operationalStatus: "platform_reachable", freshness: "live" });
  });

  it("labels unsigned browser success separately and never enables hiring", () => {
    expect(deriveCatalogEvidenceState({
      endpoints: [endpoint],
      observations: [observation({ source: "browser_reported" })],
      admission: null,
      nowMs: NOW,
    })).toMatchObject({
      operationalStatus: "browser_observed",
      freshness: "never",
      canPrepareHire: false,
      buyerAction: "check_availability",
    });
  });

  it("does not promote an onchain read that is mislabeled as protocol evidence", () => {
    expect(deriveCatalogEvidenceState({
      endpoints: [endpoint],
      observations: [observation({
        source: "chain_read",
        verificationLevel: "onchain",
      })],
      admission: null,
      nowMs: NOW,
    })).toMatchObject({
      operationalStatus: "pending",
      freshness: "never",
      canRequestInfrastructureValidation: true,
    });
  });

  it("never uses public quotes and chain checks to authorize another buyer", () => {
    const commerceEndpoint = { ...endpoint, validationProtocol: "a2a" as const };
    const admitted = { state: "admitted", endpointKey: "endpoint" };
    const quote = observation({
      id: 2, endpointKey: "endpoint", outcome: "quote_verified",
      validationKind: "quote", verificationLevel: "cryptographic",
    });
    expect(deriveCatalogEvidenceState({
      endpoints: [commerceEndpoint], observations: [quote], admission: admitted,
      capability: { state: "ready", endpointKey: "endpoint", transport: "a2a", capabilityExpiresAt: NOW + 1_000 }, nowMs: NOW,
    }))
      .toMatchObject({ quoteStatus: "verified_fresh", buyerAction: "check_availability", canPrepareHire: false });
    expect(deriveCatalogEvidenceState({
      endpoints: [commerceEndpoint],
      observations: [quote, observation({ id: 3, endpointKey: null, outcome: "protocol_valid", validationKind: "chain", verificationLevel: "onchain" })],
      admission: admitted,
      capability: { state: "ready", endpointKey: "endpoint", transport: "a2a", capabilityExpiresAt: NOW + 1_000 },
      nowMs: NOW,
    })).toMatchObject({ quoteStatus: "verified_fresh", buyerAction: "check_availability", canPrepareHire: false });
  });

  it("scopes quote and chain evidence to the admitted commerce endpoint", () => {
    const currentEndpoint = { ...endpoint, endpointKey: "current-endpoint", validationProtocol: "a2a" };
    const oldEndpoint = { ...endpoint, endpointKey: "old-endpoint", validationProtocol: "a2a" };
    const admitted = { state: "admitted", endpointKey: "current-endpoint" };
    const oldQuote = observation({
      id: 2, endpointKey: "old-endpoint", outcome: "quote_verified",
      validationKind: "quote", verificationLevel: "cryptographic", observedAt: NOW,
    });
    const currentChain = observation({
      id: 3, endpointKey: null, outcome: "protocol_valid",
      validationKind: "chain", verificationLevel: "onchain", observedAt: NOW,
    });

    expect(deriveCatalogEvidenceState({
      endpoints: [currentEndpoint, oldEndpoint],
      observations: [oldQuote, currentChain],
      admission: admitted,
      capability: { state: "discovered", endpointKey: "current-endpoint", transport: "a2a" },
      nowMs: NOW,
    })).toMatchObject({
      quoteStatus: "not_requested",
      buyerAction: "check_availability",
      canPrepareHire: false,
    });
  });

  it("never treats an unsigned browser quote claim as cryptographic evidence", () => {
    const admitted = { state: "admitted", endpointKey: "endpoint" };
    const browserClaim = observation({
      id: 2,
      source: "browser_reported",
      outcome: "quote_verified",
      validationKind: "protocol",
      verificationLevel: "user_observed",
    });
    const chain = observation({
      id: 3,
      endpointKey: null,
      validationKind: "chain",
      verificationLevel: "onchain",
    });
    expect(deriveCatalogEvidenceState({
      endpoints: [endpoint], observations: [browserClaim, chain], admission: admitted, nowMs: NOW,
    })).toMatchObject({ quoteStatus: "not_requested", canPrepareHire: false, buyerAction: "check_availability" });
  });

  it("does not confuse an A2A declaration with checked requirements", () => {
    expect(deriveCatalogEvidenceState({
      endpoints: [{ ...endpoint, validationProtocol: "a2a" }],
      observations: [],
      admission: { state: "candidate", endpointKey: "endpoint-a" },
      nowMs: NOW,
    })).toMatchObject({
      commerceStatus: "declared",
      canRequestQuote: false,
      canPrepareHire: false,
      buyerAction: "check_availability",
      blockingReasons: expect.arrayContaining(["NEGOTIATION_REQUIREMENTS_UNVERIFIED"]),
    });
  });

  it("does not transfer shared-origin evidence to another exact endpoint", () => {
    expect(deriveCatalogEvidenceState({
      endpoints: [{ ...endpoint, endpointKey: "different-path" }],
      observations: [observation({ endpointKey: "representative-path" })],
      admission: null,
      nowMs: NOW,
    })).toMatchObject({ operationalStatus: "pending", freshness: "never" });
  });

  it("exposes invalid and external declarations without making them actionable", () => {
    expect(deriveCatalogEvidenceState({
      endpoints: [{ ...endpoint, eligibility: "invalid_declaration" }],
      observations: [], admission: null, nowMs: NOW,
    })).toMatchObject({ operationalStatus: "invalid_declaration", buyerAction: "unavailable" });
    expect(deriveCatalogEvidenceState({
      endpoints: [{ ...endpoint, role: "external", eligibility: "unsupported", validationProtocol: null }],
      observations: [], admission: null, nowMs: NOW,
    })).toMatchObject({ operationalStatus: "unsupported", canRequestInfrastructureValidation: false });
  });

  it("does not promote an invalid ERC-8183 declaration alongside an eligible MCP endpoint", () => {
    expect(deriveCatalogEvidenceState({
      endpoints: [
        { ...endpoint, endpointKey: "mcp" },
        {
          endpointKey: "social",
          role: "operational",
          eligibility: "invalid_declaration",
          validationProtocol: "erc8183_http",
        },
      ],
      observations: [],
      admission: null,
      nowMs: NOW,
    })).toMatchObject({
      commerceStatus: "declared",
      canRequestQuote: false,
      canPrepareHire: false,
      buyerAction: "check_availability",
      blockingReasons: expect.arrayContaining(["NEGOTIATION_REQUIREMENTS_UNVERIFIED"]),
    });
  });
});
