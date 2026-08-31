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

  it("requires admission, a fresh cryptographic quote and a current chain check before prepare", () => {
    const admitted = { state: "admitted", endpointKey: "endpoint" };
    const quote = observation({
      id: 2, endpointKey: "endpoint", outcome: "quote_verified",
      validationKind: "quote", verificationLevel: "cryptographic",
    });
    expect(deriveCatalogEvidenceState({ endpoints: [endpoint], observations: [quote], admission: admitted, nowMs: NOW }))
      .toMatchObject({ quoteStatus: "verified_fresh", buyerAction: "request_quote", canPrepareHire: false });
    expect(deriveCatalogEvidenceState({
      endpoints: [endpoint],
      observations: [quote, observation({ id: 3, endpointKey: null, outcome: "protocol_valid", validationKind: "chain", verificationLevel: "onchain" })],
      admission: admitted,
      nowMs: NOW,
    })).toMatchObject({ quoteStatus: "verified_fresh", buyerAction: "prepare_hire", canPrepareHire: true });
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
    })).toMatchObject({ quoteStatus: "not_requested", canPrepareHire: false, buyerAction: "request_quote" });
  });

  it("lets an admission candidate request a quote without calling it hireable", () => {
    expect(deriveCatalogEvidenceState({
      endpoints: [endpoint],
      observations: [],
      admission: { state: "candidate", endpointKey: "endpoint-a" },
      nowMs: NOW,
    })).toMatchObject({
      commerceStatus: "admission_pending",
      canRequestQuote: true,
      canPrepareHire: false,
      buyerAction: "request_quote",
      blockingReasons: expect.arrayContaining(["COMMERCE_NOT_ADMITTED"]),
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
});
