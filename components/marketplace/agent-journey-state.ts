import type { CatalogCandidate } from "@/src/business/entities/catalog-candidate";
import { compatibilityMessage } from "@/src/shared/compatibility-message";

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
  /** Indexed Commerce jobs include funded/open work, not only completed proofs. */
  indexedJobs?: number;
}): AgentJourneyModel {
  const state = input.state;
  const declared = input.declared ?? true;
  const live = state?.operationalStatus === "platform_reachable" && state.freshness === "live";
  const browserOnly = state?.operationalStatus === "browser_observed";
  const failed = state?.operationalStatus === "platform_failed";
  const stale = state?.freshness === "stale" || state?.freshness === "historical";
  const capabilityState = state?.capabilityState ?? (state?.canRequestQuote ? "discovered" : "unsupported");
  const canRequestQuote = state?.canRequestQuote === true && state?.compatibilityState === "compatible";

  const declaredStage: AgentJourneyStage = declared
    ? { state: "verified", label: "Declared", detail: "The agent identity and public endpoints are present in the indexed BSC catalogue." }
    : { state: "locked", label: "Not indexed", detail: "No indexed ERC-8004 registration is available for this agent." };

  const availability: AgentJourneyStage = live
    ? { state: "verified", label: "Reachable now", detail: "A marketplace probe verified the endpoint response inside its freshness window." }
    : failed
      ? { state: "attention", label: "Last check failed", detail: "The latest marketplace attempt failed; a new check can be requested below." }
      : stale
        ? { state: "attention", label: "Check is stale", detail: "A previous response exists, but it is outside the current freshness window." }
        : browserOnly
          ? { state: "attention", label: "Browser-only result", detail: "A browser result exists, but it does not count as marketplace reachability. Run the shared Worker check below." }
          : input.validationAvailable
            ? { state: "current", label: "Check availability", detail: "Run a read-only marketplace check to publish current evidence." }
            : { state: "locked", label: "Not checked", detail: "No eligible public protocol endpoint is available for a check." };

  const quote: AgentJourneyStage = canRequestQuote
    ? { state: capabilityState === "ready" ? "verified" : "current", label: capabilityState === "ready" ? "Ready to quote" : "Inputs verified", detail: capabilityState === "ready" ? "Recent quote capability and usable requirements are verified. A new session quote is still required." : "Compatible seller inputs are available. No prior quote or job is required." }
    : state?.compatibilityState === "unsupported"
      ? { state: "locked", label: "Integration required", detail: "The seller does not publish supported negotiation requirements." }
      : state?.compatibilityState === "unavailable"
        ? { state: "attention", label: compatibilityMessage(state.compatibilityErrorCode).title, detail: compatibilityMessage(state.compatibilityErrorCode).detail }
        : { state: "locked", label: "Requirements unverified", detail: "Check the seller's negotiation requirements before requesting a quote." };

  const hire: AgentJourneyStage = !live && !canRequestQuote && input.validationAvailable
    ? { state: "locked", label: failed ? "Retry availability" : "Check availability", detail: "Once connected, you can request a quote." }
    : canRequestQuote && input.hireFlowAvailable
      ? { state: "current", label: "Start hiring", detail: "Request a fresh quote below, then review the exact transaction plan." }
      : canRequestQuote
        ? { state: "current", label: "Request a quote to hire", detail: "Ask this seller for a fresh quote; wallet access starts only after Review." }
        : { state: "locked", label: "Check compatibility", detail: "Check the seller's required inputs. A prior job does not establish current compatibility." };

  const indexedJobs = input.indexedJobs ?? 0;
  const jobs: AgentJourneyStage = input.provenJobs > 0
    ? { state: "verified", label: `${input.provenJobs} result-verified job${input.provenJobs === 1 ? "" : "s"}`, detail: "Completed ERC-8183 work with a verified deliverable is shown below." }
    : indexedJobs > 0
      ? { state: "current", label: `${indexedJobs} job${indexedJobs === 1 ? "" : "s"}`, detail: "Indexed onchain activity is shown below; completion and result verification are tracked separately." }
      : { state: "locked", label: "No jobs yet", detail: "Indexed ERC-8183 work will appear here after a job is created." };

  const nextAction = input.hireFlowAvailable && canRequestQuote
      ? "Request a fresh quote below; no wallet signature is needed for this step."
      : input.validationAvailable && !live
        ? "Check availability below to update shared evidence for everyone."
        : canRequestQuote
          ? "Request a seller quote below; no wallet signature is needed for this step."
          : "Check compatibility below. Only a fresh buyer quote can enable Review and Fund.";

  return { declared: declaredStage, availability, quote, hire, jobs, nextAction };
}
