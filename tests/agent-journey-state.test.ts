import { describe, expect, it } from "vitest";
import { deriveAgentJourney } from "../components/marketplace/agent-journey-state";

const base = {
  validationAvailable: true,
  hireFlowAvailable: false,
  provenJobs: 0,
};

const state = (overrides: Record<string, unknown> = {}) => ({
  operationalStatus: "platform_reachable" as const,
  freshness: "live" as const,
  commerceStatus: "admitted" as const,
  quoteStatus: "not_requested" as const,
  buyerAction: "request_quote" as const,
  canRequestBrowserValidation: true,
  canRequestInfrastructureValidation: true,
  canRequestQuote: true,
  canPrepareHire: false,
  blockingReasons: [],
  ...overrides,
});

describe("deriveAgentJourney", () => {
  it("makes a fresh platform observation visible while keeping quote and hiring distinct", () => {
    const journey = deriveAgentJourney({ ...base, state: state() });

    expect(journey.declared).toMatchObject({ state: "verified", label: "Declared" });
    expect(journey.availability).toMatchObject({ state: "verified", label: "Reachable now" });
    expect(journey.quote).toMatchObject({ state: "current", label: "Request quote" });
    expect(journey.hire).toMatchObject({ state: "attention", label: "Hiring setup pending" });
    expect(journey.nextAction).toMatch(/admitted/i);
  });

  it("guides an unprobed candidate to a shared read-only check", () => {
    const journey = deriveAgentJourney({
      ...base,
      state: state({
        operationalStatus: "pending",
        freshness: "never",
        commerceStatus: "declared",
        canRequestQuote: false,
        buyerAction: "check_availability",
        blockingReasons: ["COMMERCE_NOT_ADMITTED"],
      }),
    });

    expect(journey.availability).toMatchObject({ state: "current", label: "Check availability" });
    expect(journey.quote.state).toBe("locked");
    expect(journey.nextAction).toMatch(/check availability/i);
  });

  it("does not present browser evidence as marketplace reachability", () => {
    const journey = deriveAgentJourney({
      ...base,
      state: state({ operationalStatus: "browser_observed", freshness: "live" }),
    });

    expect(journey.availability).toMatchObject({ state: "attention", label: "Browser-only result" });
    expect(journey.availability.detail).toMatch(/does not count/i);
    expect(journey.nextAction).toMatch(/check availability/i);
  });

  it("does not expose a quote while seller admission is still pending", () => {
    const journey = deriveAgentJourney({
      ...base,
      state: state({
        commerceStatus: "admission_pending",
        canRequestQuote: true,
        buyerAction: "request_quote",
      }),
    });

    expect(journey.quote).toMatchObject({ state: "attention", label: "Seller admission pending" });
    expect(journey.hire).toMatchObject({ state: "attention", label: "Admission required" });
    expect(journey.nextAction).toMatch(/admission/i);
  });

  it("only calls a seller ready when the transaction flow is actually mounted", () => {
    const journey = deriveAgentJourney({
      ...base,
      hireFlowAvailable: true,
      state: state({ quoteStatus: "verified_fresh", canPrepareHire: true, buyerAction: "prepare_hire" }),
      provenJobs: 2,
    });

    expect(journey.hire).toMatchObject({ state: "verified", label: "Ready to hire" });
    expect(journey.jobs).toMatchObject({ state: "verified", label: "2 proven jobs" });
    expect(journey.nextAction).toMatch(/fresh quote/i);
  });

  it("prioritizes the latest failed probe over stale freshness", () => {
    const journey = deriveAgentJourney({
      ...base,
      state: state({ operationalStatus: "platform_failed", freshness: "stale" }),
    });

    expect(journey.availability).toMatchObject({ state: "attention", label: "Last check failed" });
    expect(journey.nextAction).toMatch(/check availability/i);
  });

  it("keeps a historical quote visible but blocks it from preparing a hire", () => {
    const journey = deriveAgentJourney({
      ...base,
      hireFlowAvailable: true,
      state: state({
        quoteStatus: "verified_historical",
        canPrepareHire: false,
        buyerAction: "request_quote",
      }),
    });

    expect(journey.quote).toMatchObject({ state: "attention", label: "Refresh quote" });
    expect(journey.hire).toMatchObject({ state: "current", label: "Start hiring" });
    expect(journey.nextAction).toMatch(/fresh quote/i);
  });

  it("renders an explicit rejected quote without treating the seller as hireable", () => {
    const journey = deriveAgentJourney({
      ...base,
      hireFlowAvailable: true,
      state: state({
        quoteStatus: "rejected",
        canRequestQuote: false,
        buyerAction: "unavailable",
      }),
    });

    expect(journey.quote).toMatchObject({ state: "attention", label: "Quote rejected" });
    expect(journey.hire).toMatchObject({ state: "locked", label: "Hiring locked" });
    expect(journey.nextAction).toMatch(/listed for discovery/i);
  });

  it("does not imply a check exists when no eligible validation endpoint is available", () => {
    const journey = deriveAgentJourney({
      declared: false,
      validationAvailable: false,
      hireFlowAvailable: false,
      provenJobs: 0,
      state: undefined,
    });

    expect(journey.declared).toMatchObject({ state: "locked", label: "Not indexed" });
    expect(journey.availability).toMatchObject({ state: "locked", label: "Not checked" });
    expect(journey.quote).toMatchObject({ state: "locked", label: "Quote unavailable" });
    expect(journey.hire).toMatchObject({ state: "locked", label: "Hiring locked" });
    expect(journey.jobs).toMatchObject({ state: "locked", label: "No proven jobs" });
  });

  it("shows singular and plural proven-job labels", () => {
    expect(deriveAgentJourney({ ...base, state: state(), provenJobs: 1 }).jobs.label)
      .toBe("1 proven job");
    expect(deriveAgentJourney({ ...base, state: state(), provenJobs: 3 }).jobs.label)
      .toBe("3 proven jobs");
  });
});
