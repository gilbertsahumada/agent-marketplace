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
  compatibilityState: "compatible" as const,
  blockingReasons: [],
  ...overrides,
});

describe("deriveAgentJourney", () => {
  it("uses endpoint-specific backend eligibility over an unrelated aggregate failed probe", () => {
    const journey = deriveAgentJourney({
      ...base,
      hireFlowAvailable: true,
      state: state({
        operationalStatus: "platform_failed",
        capabilityState: "ready",
        quoteStatus: "verified_fresh",
        canPrepareHire: true,
      }),
    });
    expect(journey.quote).toMatchObject({ state: "verified", label: "Ready to quote" });
    expect(journey.hire).toMatchObject({ state: "current", label: "Start hiring" });
    expect(journey.nextAction).toMatch(/fresh quote/i);
  });

  it("makes a fresh platform observation visible while keeping quote and hiring distinct", () => {
    const journey = deriveAgentJourney({ ...base, state: state() });

    expect(journey.declared).toMatchObject({ state: "verified", label: "Declared" });
    expect(journey.availability).toMatchObject({ state: "verified", label: "Reachable now" });
    expect(journey.quote).toMatchObject({ state: "current", label: "Inputs verified" });
    expect(journey.hire).toMatchObject({ state: "current", label: "Request a quote to hire" });
    expect(journey.nextAction).toMatch(/seller quote|fresh quote/i);
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
        blockingReasons: ["NO_QUOTE_TRANSPORT"],
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

  it("lets a discovered seller request a quote without manual admission", () => {
    const journey = deriveAgentJourney({
      ...base,
      state: state({
        commerceStatus: "declared",
        canRequestQuote: true,
        buyerAction: "request_quote",
      }),
    });

    expect(journey.quote).toMatchObject({ state: "current", label: "Inputs verified" });
    expect(journey.hire).toMatchObject({ state: "current", label: "Request a quote to hire" });
    expect(journey.nextAction).toMatch(/seller quote|fresh quote|request a quote/i);
  });

  it("only calls a seller ready when the transaction flow is actually mounted", () => {
    const journey = deriveAgentJourney({
      ...base,
      hireFlowAvailable: true,
      state: state({ quoteStatus: "verified_fresh", canPrepareHire: true, buyerAction: "prepare_hire" }),
      provenJobs: 2,
    });

    expect(journey.hire).toMatchObject({ state: "current", label: "Start hiring" });
    expect(journey.jobs).toMatchObject({ state: "verified", label: "2 result-verified jobs" });
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

    expect(journey.quote).toMatchObject({ state: "current", label: "Inputs verified" });
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

    expect(journey.quote).toMatchObject({ state: "locked", label: "Requirements unverified" });
    expect(journey.hire).toMatchObject({ state: "locked", label: "Check compatibility" });
    expect(journey.nextAction).toMatch(/check compatibility/i);
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
    expect(journey.quote).toMatchObject({ state: "locked", label: "Requirements unverified" });
    expect(journey.hire).toMatchObject({ state: "locked", label: "Check compatibility" });
    expect(journey.jobs).toMatchObject({ state: "locked", label: "No jobs yet" });
  });

  it("shows singular and plural result-verified job labels", () => {
    expect(deriveAgentJourney({ ...base, state: state(), provenJobs: 1 }).jobs.label)
      .toBe("1 result-verified job");
    expect(deriveAgentJourney({ ...base, state: state(), provenJobs: 3 }).jobs.label)
      .toBe("3 result-verified jobs");
  });
  it("does not infer usable parameters from declaration-only legacy capability", () => {
    const model = deriveAgentJourney({ ...base, state: state({ compatibilityState: undefined }) });
    expect(model.quote.label).toBe("Requirements unverified");
    expect(model.hire.label).toBe("Check compatibility");
  });
  it("distinguishes unsupported requirements from temporary discovery failure", () => {
    expect(deriveAgentJourney({ ...base, state: state({ canRequestQuote: false, compatibilityState: "unsupported" }) }).quote.label).toBe("Integration required");
    expect(deriveAgentJourney({ ...base, state: state({ canRequestQuote: false, compatibilityState: "unavailable" }) }).quote.label).toBe("Compatibility unavailable");
  });
});
