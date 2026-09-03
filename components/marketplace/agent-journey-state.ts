import type { CatalogCandidate } from "@/src/business/entities/catalog-candidate";

export type AgentJourneyStageState = "verified" | "current" | "attention" | "locked";

export interface AgentJourneyStage {
  state: AgentJourneyStageState;
  label: string;
  detail: string;
}

export interface AgentJourneyModel {
  declared: AgentJourneyStage;
  availability: AgentJourneyStage;
  quote: AgentJourneyStage;
  hire: AgentJourneyStage;
  jobs: AgentJourneyStage;
  nextAction: string;
}

type CandidateState = NonNullable<CatalogCandidate["state"]>;

/**
 * Keeps the buyer-facing journey derived from the Worker state in one place.
 * This is deliberately presentation-only: it never promotes browser evidence
 * or a transport response to commerce admission.
 */
export function deriveAgentJourney(input: {
  declared?: boolean;
  state?: CandidateState | undefined;
  validationAvailable: boolean;
  hireFlowAvailable: boolean;
  provenJobs: number;
}): AgentJourneyModel {
  const state = input.state;
  const declared = input.declared ?? true;
  const live = state?.operationalStatus === "platform_reachable" && state.freshness === "live";
  const browserOnly = state?.operationalStatus === "browser_observed";
  const failed = state?.operationalStatus === "platform_failed";
  const stale = state?.freshness === "stale" || state?.freshness === "historical";
  const admissionPending = state?.commerceStatus === "admission_pending";
  const canRequestQuote = state?.commerceStatus === "admitted" && state.canRequestQuote === true;
  const canPrepareHire = state?.canPrepareHire === true;

  const declaredStage: AgentJourneyStage = declared
    ? { state: "verified", label: "Declared", detail: "The agent identity and public endpoints are present in the indexed BSC catalogue." }
    : { state: "locked", label: "Not indexed", detail: "No indexed ERC-8004 registration is available for this agent." };

  const availability: AgentJourneyStage = live
    ? { state: "verified", label: "Reachable now", detail: "A marketplace probe returned a protocol-valid response inside its freshness window." }
    : failed
      ? { state: "attention", label: "Last check failed", detail: "The latest marketplace attempt failed; a new check can be requested below." }
      : stale
        ? { state: "attention", label: "Check is stale", detail: "A previous response exists, but it is outside the current freshness window." }
        : browserOnly
          ? { state: "attention", label: "Browser-only result", detail: "A browser result exists, but it does not count as marketplace reachability. Run the shared Worker check below." }
          : input.validationAvailable
            ? { state: "current", label: "Check availability", detail: "Run a read-only marketplace check to publish current evidence." }
            : { state: "locked", label: "Not checked", detail: "No eligible public protocol endpoint is available for a check." };

  const quote: AgentJourneyStage = state?.quoteStatus === "verified_fresh"
    ? { state: "verified", label: "Quote ready", detail: "A signed ERC-8183 quote is current and bound to the admitted seller." }
    : state?.quoteStatus === "rejected"
      ? { state: "attention", label: "Quote rejected", detail: "The latest quote attempt did not satisfy the marketplace policy." }
      : state?.quoteStatus === "verified_historical"
        ? { state: "attention", label: "Refresh quote", detail: "The previous signed quote is historical and cannot authorize a transaction." }
        : canRequestQuote
          ? { state: "current", label: "Request quote", detail: "The seller is admitted; requesting a fresh quote is read-only and requires no signature." }
          : admissionPending
            ? { state: "attention", label: "Seller admission pending", detail: "The seller path is declared, but the marketplace has not admitted it for quoting yet." }
          : { state: "locked", label: "Quote unavailable", detail: "This agent has no admitted ERC-8183 seller path yet." };

  const hire: AgentJourneyStage = canPrepareHire && input.hireFlowAvailable
    ? { state: "verified", label: "Ready to hire", detail: "A current seller quote is indexed. Request a fresh session quote below before any wallet signature." }
    : canRequestQuote && input.hireFlowAvailable
      ? { state: "current", label: "Start hiring", detail: "Request a fresh quote below, then review the exact transaction plan." }
      : canRequestQuote
        ? { state: "attention", label: "Hiring setup pending", detail: "The seller is admitted, but this seller’s transaction flow is not connected yet." }
        : admissionPending
          ? { state: "attention", label: "Admission required", detail: "Hiring unlocks after the marketplace admits this seller path." }
        : { state: "locked", label: "Hiring locked", detail: "Hiring stays locked until an admitted seller and a valid commerce path are available." };

  const jobs: AgentJourneyStage = input.provenJobs > 0
    ? { state: "verified", label: `${input.provenJobs} proven job${input.provenJobs === 1 ? "" : "s"}`, detail: "Completed ERC-8183 work linked to this agent is shown below." }
    : { state: "locked", label: "No proven jobs", detail: "Verified ERC-8183 work will appear here after a completed job is indexed." };

  const nextAction = input.hireFlowAvailable && canPrepareHire
    ? "Request a fresh quote below; the current indexed quote is evidence, not a wallet authorization."
    : input.hireFlowAvailable && canRequestQuote
      ? "Request a fresh quote below; no wallet signature is needed for this step."
      : input.validationAvailable && !live
        ? "Check availability below to update shared evidence for everyone."
        : admissionPending
          ? "The seller is awaiting marketplace admission before a quote can be requested."
        : canRequestQuote
          ? "This seller is admitted, but its hiring transaction flow still needs configuration."
          : "This agent is listed for discovery; hiring remains locked until the seller path is admitted.";

  return { declared: declaredStage, availability, quote, hire, jobs, nextAction };
}
