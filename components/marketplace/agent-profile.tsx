import {
  Check,
  CircleAlert,
  Activity,
  BadgeCheck,
  BriefcaseBusiness,
  Clock3,
  ChevronDown,
  ExternalLink,
  FileText,
  RadioTower,
} from "lucide-react";
import type { ReactNode } from "react";
import type { MarketplaceAgent } from "@/src/business/entities/marketplace-agent";
import type { AgentEvidencePassport } from "@/src/business/entities/evidence-passport";
import type { MainnetJobProof } from "@/src/business/entities/mainnet-job-proof";
import type { HireActivity, HireChainId, HireJob } from "@/src/business/entities/hire-job";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "./page-primitives";
import { AgentAvatar } from "./agent-avatar";
import { trust8004AgentHref } from "./agent-card";
import { AgentValidationActions, type ValidationObservationSummary, type ValidationTarget } from "./agent-validation-actions";
import { declaredBrowserValidationTargets } from "@/src/business/policies/catalog-validation-policy";
import type { CatalogCandidate } from "@/src/business/entities/catalog-candidate";
import { catalogCandidateCard } from "./catalog-candidate-view-model";
import { deriveAgentJourney } from "./agent-journey-state";
import { HiringUnavailable } from "./agent-journey";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { relativeAge } from "./relative-time";
import { QuoteHistory } from "./quote-history";
import { JobHistory } from "./job-history";
import { agentJobHistory, type JobHistoryTotals } from "./agent-job-history";

const EMPTY_JOBS: readonly MainnetJobProof[] = [];
const SHARED_VALIDATION_SOURCES = new Set(["marketplace_probe", "worker_probe", "buyer_refresh", "migration"]);

export function marketplaceAgentDisplayName(name: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(name)) return name;
  return name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}


function EvidenceSummaryItem({
  detail,
  icon: Icon,
  label,
  state,
}: {
  detail: string;
  icon: typeof FileText;
  label: ReactNode;
  state: "verified" | "attention" | "neutral";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          tabIndex={0}
        >
          <span className={cn(
            "flex shrink-0 items-center justify-center",
            state === "verified" && "text-emerald-300",
            state === "attention" && "text-amber-200",
            state === "neutral" && "text-muted-foreground",
          )}>
            {state === "verified" ? <Check aria-hidden="true" className="size-4" /> : state === "attention" ? <CircleAlert aria-hidden="true" className="size-4" /> : <Icon aria-hidden="true" className="size-4" />}
          </span>
          <span className="min-w-0 text-sm font-medium text-zinc-200">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 leading-relaxed" sideOffset={8}>{detail}</TooltipContent>
    </Tooltip>
  );
}


export function AgentProfile({
  agent,
  passport,
  catalogCandidate,
  hireFlow,
  hireNotice,
  hireFlowAvailable,
  hireJobs = null,
  hireJobsMore = false,
  hireJobsScope = "agent",
  jobsOlderHref,
  jobsNewestHref,
  jobsChainId = 56,
  hireJobsTotals,
  hireActivity = null,
  jobProofs = EMPTY_JOBS,
}: {
  jobsOlderHref?: string;
  jobsNewestHref?: string;
  jobsChainId?: HireChainId;
  hireJobsTotals?: JobHistoryTotals;
  agent: MarketplaceAgent;
  passport: AgentEvidencePassport;
  catalogCandidate?: CatalogCandidate | null;
  hireFlow?: ReactNode;
  hireNotice?: ReactNode;
  hireFlowAvailable?: boolean;
  hireJobs?: readonly HireJob[] | null;
  hireJobsMore?: boolean;
  hireJobsScope?: "wallet" | "agent";
  // last 30 days of phase events in that scope; null or absent hides the line.
  hireActivity?: HireActivity | null;
  jobProofs?: readonly MainnetJobProof[];
}) {
  const displayName = marketplaceAgentDisplayName(agent.name);
  const jobModel = agentJobHistory({ chainId: jobsChainId, scope: hireJobsScope, jobs: hireJobs, proofs: jobProofs, ...(hireJobsTotals ? { totals: hireJobsTotals } : {}) });
  const current = catalogCandidate ? catalogCandidateCard(catalogCandidate) : null;
  const browserTargets = declaredBrowserValidationTargets(agent);
  const browserTargetKeys = new Set(browserTargets.map((target) => `${target.protocol}\u0000${target.endpoint}`));
  const targetMap = new Map<string, ValidationTarget>(browserTargets.map((target) => [
    `${target.protocol}\u0000${target.endpoint}`,
    { ...target, browserValidatable: true },
  ]));
  for (const target of agent.validationTargets ?? []) {
    const key = `${target.protocol}\u0000${target.endpoint}`;
    targetMap.set(key, {
      ...target,
      browserValidatable: browserTargetKeys.has(key),
    });
  }
  const validationTargets = [...targetMap.values()];
  const validationObservations: ValidationObservationSummary[] = catalogCandidate?.observations.flatMap((observation) => (
    observation.endpointKey === null
      || observation.protocol === "erc8183"
      || !SHARED_VALIDATION_SOURCES.has(observation.source)
      || (observation.validationKind !== undefined
        && observation.validationKind !== "reachability"
        && observation.validationKind !== "protocol")
      ? []
      : [{
        endpointKey: observation.endpointKey,
        protocol: observation.protocol,
        source: observation.source,
        outcome: observation.outcome,
        observedAt: observation.observedAt,
        expiresAt: observation.expiresAt,
        httpStatus: observation.httpStatus,
        durationMs: observation.durationMs,
      }]
  )) ?? [];
  const canCheckAvailability = (catalogCandidate?.state?.canRequestBrowserValidation === true
    || catalogCandidate?.state?.canRequestInfrastructureValidation === true)
    && validationTargets.length > 0;
  const reachable = catalogCandidate?.state?.operationalStatus === "platform_reachable"
    && catalogCandidate.state.freshness === "live";
  const previouslyReachable = catalogCandidate?.state?.operationalStatus === "platform_reachable";
  const browserOnly = catalogCandidate?.state?.operationalStatus === "browser_observed";
  const platformFailed = catalogCandidate?.state?.operationalStatus === "platform_failed";
  const negotiationOnline = catalogCandidate?.state?.canRequestQuote === true && catalogCandidate.state.compatibilityState === "compatible";
  const quoteReady = negotiationOnline && catalogCandidate?.state?.capabilityState === "ready";
  const journey = deriveAgentJourney({
    declared: true,
    state: catalogCandidate?.state,
    validationAvailable: canCheckAvailability,
    hireFlowAvailable: hireFlowAvailable ?? hireFlow !== undefined,
    provenJobs: passport.trackRecord.provenJobs,
    indexedJobs: hireJobsScope === "agent" ? jobModel.agentTotal : 0,
  });
  const latestCheckedAt = negotiationOnline && catalogCandidate?.state?.compatibilityCheckedAt
    ? new Date(catalogCandidate.state.compatibilityCheckedAt).toISOString()
    : current?.monitoring?.lastAttemptAt;
  const attemptCount = current?.monitoring?.attemptCount;
  const headerStatus = quoteReady
    ? "Ready to quote"
    : negotiationOnline ? "Negotiation online" : reachable
      ? "Reachable"
      : platformFailed
        ? "Last check failed"
        : previouslyReachable
          ? "Check required"
          : browserOnly
            ? "Browser-only result"
            : canCheckAvailability
              ? "Check availability"
              : "Unavailable";

  return (
    <main id="main-content" className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
      <Breadcrumb current={displayName} trail={[{ href: "/agents", label: "Agents" }]} />

      <section className="mt-5 flex flex-col gap-5 rounded-xl border border-white/10 bg-white/[0.015] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-4">
          <AgentAvatar {...(agent.imageUrl ? { imageUrl: agent.imageUrl } : {})} className="size-14" name={displayName} />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-medium tracking-tight text-white sm:text-2xl">{displayName}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              BSC Mainnet ·{" "}
              <a
                className="font-hash cursor-pointer text-zinc-400 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white"
                href={trust8004AgentHref(agent.agentId)}
                rel="noopener noreferrer"
                target="_blank"
              >
                Agent #{agent.agentId}<ExternalLink aria-hidden="true" className="ml-1 inline size-3" />
              </a>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Badge className={reachable || negotiationOnline
            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
            : platformFailed
              ? "border-red-400/30 bg-red-400/10 text-red-300"
              : canCheckAvailability || previouslyReachable
                ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                : ""} variant="outline">
            <span aria-hidden="true" className={`size-1.5 rounded-full ${reachable || negotiationOnline
              ? "bg-emerald-400"
              : platformFailed
                ? "bg-red-400"
                : canCheckAvailability || previouslyReachable
                  ? "bg-amber-300"
                  : "bg-zinc-600"}`} />
            {headerStatus}
          </Badge>
          <a
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            href={trust8004AgentHref(agent.agentId)}
            rel="noopener noreferrer"
            target="_blank"
          >
            Identity &amp; reputation<ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      </section>

      <TooltipProvider>
        <section aria-label="Hiring evidence" className="mt-3 grid rounded-xl border border-white/10 bg-white/[0.015] sm:grid-cols-2 lg:grid-cols-4">
          <EvidenceSummaryItem detail={journey.declared.detail} icon={FileText} label="Identity declared" state="verified" />
          <EvidenceSummaryItem
            detail={negotiationOnline ? "The selected negotiation endpoint and its inputs were checked together." : journey.availability.detail}
            icon={RadioTower}
            label={<span className="inline-flex min-w-0 items-center gap-1.5">
              {negotiationOnline ? "Negotiation online" : journey.availability.label}
              {latestCheckedAt ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-zinc-500"><Clock3 aria-hidden="true" className="size-3" /><time dateTime={latestCheckedAt} title={latestCheckedAt}>{relativeAge(latestCheckedAt)}</time></span> : null}
            </span>}
            state={reachable || negotiationOnline ? "verified" : "attention"}
          />
          <EvidenceSummaryItem detail={journey.quote.detail} icon={BadgeCheck} label={journey.quote.label} state={negotiationOnline || journey.quote.state === "verified" ? "verified" : journey.quote.state === "locked" ? "neutral" : "attention"} />
          <EvidenceSummaryItem
            detail={journey.jobs.detail}
            icon={BriefcaseBusiness}
            label={hireJobsScope === "wallet" ? "Agent jobs unverified" : hireJobsTotals ? `${jobModel.agentCompleted} completed job${jobModel.agentCompleted === 1 ? "" : "s"}` : "Job totals unavailable"}
            state={hireJobsScope === "agent" && jobModel.agentCompleted > 0 ? "verified" : "neutral"}
          />
        </section>
      </TooltipProvider>
      {typeof attemptCount === "number" ? <p className="mt-2 px-1 text-right text-[11px] text-zinc-600">{attemptCount} marketplace check{attemptCount === 1 ? "" : "s"}</p> : null}

      <div className="mt-5 flex flex-col gap-5">
        {hireFlow ? <section className="scroll-mt-6" id="hire-flow">{hireFlow}</section> : <HiringUnavailable model={journey} notice={hireNotice} validationAvailable={canCheckAvailability} />}
      </div>
      <JobHistory activity={hireActivity} provider={agent.onchainIdentity?.agentWallet ?? null} agentId={agent.agentId} chainId={jobsChainId} {...(hireJobsTotals ? { totals: hireJobsTotals } : {})} hireActivity={passport.checks.hireActivity} hireJobs={hireJobs} jobs={jobProofs} more={hireJobsMore} scope={hireJobsScope} {...(jobsOlderHref ? { olderHref: jobsOlderHref } : {})} {...(jobsNewestHref ? { newestHref: jobsNewestHref } : {})} />
      <div className="mt-5"><QuoteHistory agentId={agent.agentId} /></div>
      <div className="mt-5">
        {canCheckAvailability ? (
          <details open={!reachable} className="group rounded-xl border border-white/10 bg-white/[0.015]" id="validation">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-zinc-200">
              <span className="flex items-center gap-2"><Activity aria-hidden="true" className="size-4 text-muted-foreground" />{reachable ? "Diagnostics" : "Check connection"}</span>
              <span className="flex items-center gap-2 text-xs font-normal text-zinc-500"><span className="group-open:hidden">Validate declared endpoints</span><span className="hidden group-open:inline">Hide</span><ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></span>
            </summary>
            <div className="border-t border-white/10">
              <AgentValidationActions
                embedded
                agentId={agent.agentId}
                initialObservations={validationObservations}
                targets={validationTargets}
              />
            </div>
          </details>
        ) : null}
      </div>

    </main>
  );
}
