import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Clock3,
  ExternalLink,
  FileText,
  RadioTower,
} from "lucide-react";
import type { ReactNode } from "react";
import type { MarketplaceAgent } from "@/src/business/entities/marketplace-agent";
import type { AgentEvidencePassport } from "@/src/business/entities/evidence-passport";
import type { MainnetJobProof } from "@/src/business/entities/mainnet-job-proof";
import type { HireJob } from "@/src/business/entities/hire-job";
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
import { HireJobRows } from "./hire-job-rows";
import { QuoteHistory } from "./quote-history";

const EMPTY_JOBS: readonly MainnetJobProof[] = [];
const SHARED_VALIDATION_SOURCES = new Set(["marketplace_probe", "worker_probe", "buyer_refresh", "migration"]);
const UTC_DATE = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

export function marketplaceAgentDisplayName(name: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(name)) return name;
  return name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function utcDate(value: string): string {
  return UTC_DATE.format(new Date(value));
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
        <button
          className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          type="button"
        >
          <span className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border",
            state === "verified" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
            state === "attention" && "border-amber-400/30 bg-amber-400/10 text-amber-200",
            state === "neutral" && "border-white/10 bg-white/[0.02] text-zinc-500",
          )}>
            <Icon aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 text-sm font-medium text-zinc-200">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 leading-relaxed" sideOffset={8}>{detail}</TooltipContent>
    </Tooltip>
  );
}

function JobHistory({ hireActivity, jobs, hireJobs, more, scope }: {
  hireActivity: AgentEvidencePassport["checks"]["hireActivity"];
  jobs: readonly MainnetJobProof[];
  hireJobs: readonly HireJob[] | null;
  more: boolean;
  scope: "wallet" | "agent";
}) {
  const ordered = [...jobs].sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  const proven = new Set(jobs.map((job) => job.jobId));
  const indexed = (hireJobs ?? []).filter((job) => !proven.has(job.jobId));
  const allJobIds = new Set([...jobs.map((job) => job.jobId), ...(hireJobs ?? []).map((job) => job.jobId)]);
  const completed = new Set([
    ...jobs.filter((job) => job.finalState === "COMPLETED").map((job) => job.jobId),
    ...(hireJobs ?? []).filter((job) => job.status === "COMPLETED").map((job) => job.jobId),
  ]);
  const funded = (hireJobs ?? []).filter((job) => job.status === "FUNDED").length;
  const resultVerified = new Set(jobs.map((job) => job.jobId)).size;
  return (
    <details className="group mt-5 rounded-xl border border-white/10 bg-white/[0.015]">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <h2 className="flex items-center gap-2 text-base font-medium text-white" id="erc8183-history">
          <BriefcaseBusiness aria-hidden="true" className="size-4 text-zinc-500" />ERC-8183 job history
        </h2>
        <div className="flex flex-wrap gap-2">
          {hireJobs !== null ? <>
            <Badge variant="outline">{allJobIds.size}{more ? "+" : ""} {allJobIds.size === 1 ? "job" : "jobs"}</Badge>
            <Badge className={funded > 0 ? "border-amber-300/30 bg-amber-300/10 text-amber-100" : ""} variant="outline">{funded} funded</Badge>
            <Badge className={completed.size > 0 ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : ""} variant="outline">{completed.size} completed</Badge>
            <Badge variant="outline">{resultVerified} result verified</Badge>
          </> : <Badge variant="outline">{jobs.length} result verified</Badge>}
        </div>
      </summary>
      <div className="border-t border-white/10">
        {hireActivity.status === "verified" ? (
          <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-white/10 px-4 py-3 text-sm sm:px-5">
            <dt className="text-zinc-500">Verified hire activity</dt>
            <dd className="min-w-0 break-all text-zinc-300">{hireActivity.detail}</dd>
            {hireActivity.observedAt ? <dd className="text-zinc-500">{utcDate(hireActivity.observedAt)}</dd> : null}
          </dl>
        ) : null}
        {ordered.length === 0 && indexed.length === 0 ? (
          <div className="px-5 py-6 text-sm text-zinc-500">
            {hireJobs === null ? "Indexed ledger unavailable right now." : "No indexed jobs yet."}
          </div>
        ) : null}
        {ordered.length > 0 ? (
          <ul className="divide-y divide-white/10">
            {ordered.map((job) => (
              <li key={job.jobId}>
                <Link
                  className="grid cursor-pointer items-center gap-3 px-4 py-4 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[1fr_auto_auto_auto] sm:px-5"
                  href={`/jobs/mainnet/${job.jobId}`}
                >
                  <span className="font-medium text-white">Job #{job.jobId}</span>
                  <Badge className={job.finalState === "COMPLETED" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : ""} variant="outline">
                    {job.finalState === "COMPLETED" ? "Completed" : "Submitted"}
                  </Badge>
                  <span className="text-sm text-zinc-400">{job.durationSeconds}s</span>
                  <span className="flex items-center justify-between gap-3 text-sm text-zinc-500 sm:justify-start">
                    {utcDate(job.capturedAt)}<ArrowRight aria-hidden="true" className="size-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {indexed.length > 0 ? (
          <div className={ordered.length > 0 ? "border-t border-white/10" : ""}>
            <p className="px-4 pt-4 text-xs text-zinc-500 sm:px-5">{scope === "wallet" ? "Provider wallet activity" : "Agent activity"}</p>
            <HireJobRows chainId={56} emptyText="" jobs={indexed} />
          </div>
        ) : null}
        {more ? <p className="px-5 py-3 text-xs text-zinc-500">Newest jobs shown. <Link className="text-primary" href="/jobs">Explore jobs</Link></p> : null}
      </div>
    </details>
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
  jobProofs = EMPTY_JOBS,
}: {
  agent: MarketplaceAgent;
  passport: AgentEvidencePassport;
  catalogCandidate?: CatalogCandidate | null;
  hireFlow?: ReactNode;
  hireNotice?: ReactNode;
  hireFlowAvailable?: boolean;
  hireJobs?: readonly HireJob[] | null;
  hireJobsMore?: boolean;
  hireJobsScope?: "wallet" | "agent";
  jobProofs?: readonly MainnetJobProof[];
}) {
  const displayName = marketplaceAgentDisplayName(agent.name);
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
  const quoteReady = !platformFailed && (catalogCandidate?.state
    ? catalogCandidate.state.quoteStatus === "verified_fresh"
    : passport.checks.quote.status === "verified");
  const journey = deriveAgentJourney({
    declared: true,
    state: catalogCandidate?.state,
    validationAvailable: canCheckAvailability,
    hireFlowAvailable: hireFlowAvailable ?? hireFlow !== undefined,
    provenJobs: passport.trackRecord.provenJobs,
    indexedJobs: hireJobs?.length ?? 0,
  });
  const latestCheckedAt = current?.monitoring?.lastAttemptAt;
  const attemptCount = current?.monitoring?.attemptCount;
  const headerStatus = quoteReady
    ? "Quote verified"
    : reachable
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
          <Badge className={reachable || quoteReady
            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
            : platformFailed
              ? "border-red-400/30 bg-red-400/10 text-red-300"
              : canCheckAvailability || previouslyReachable
                ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                : ""} variant="outline">
            <span aria-hidden="true" className={`size-1.5 rounded-full ${reachable || quoteReady
              ? "bg-emerald-400"
              : platformFailed
                ? "bg-red-400"
                : canCheckAvailability || previouslyReachable
                  ? "bg-amber-300"
                  : "bg-zinc-600"}`} />
            {headerStatus}
          </Badge>
          <Badge variant="outline">{Math.max(passport.trackRecord.provenJobs, hireJobs?.length ?? 0)} jobs</Badge>
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
            detail={journey.availability.detail}
            icon={RadioTower}
            label={<span className="inline-flex min-w-0 items-center gap-1.5">
              {journey.availability.label}
              {latestCheckedAt ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-zinc-500"><Clock3 aria-hidden="true" className="size-3" /><time dateTime={latestCheckedAt} title={latestCheckedAt}>{relativeAge(latestCheckedAt)}</time></span> : null}
            </span>}
            state={reachable ? "verified" : "attention"}
          />
          <EvidenceSummaryItem detail={journey.quote.detail} icon={BadgeCheck} label={journey.quote.label} state={journey.quote.state === "verified" ? "verified" : journey.quote.state === "locked" ? "neutral" : "attention"} />
          <EvidenceSummaryItem
            detail={journey.jobs.detail}
            icon={BriefcaseBusiness}
            label={`${passport.trackRecord.completedJobs + (hireJobs ?? []).filter((job) => job.status === "COMPLETED").length} completed job${passport.trackRecord.completedJobs + (hireJobs ?? []).filter((job) => job.status === "COMPLETED").length === 1 ? "" : "s"}`}
            state={passport.trackRecord.completedJobs > 0 || (hireJobs ?? []).some((job) => job.status === "COMPLETED") ? "verified" : "neutral"}
          />
        </section>
      </TooltipProvider>
      {typeof attemptCount === "number" ? <p className="mt-2 px-1 text-right text-[11px] text-zinc-600">{attemptCount} marketplace check{attemptCount === 1 ? "" : "s"}</p> : null}

      <div className="mt-5 flex flex-col gap-5">
        {hireFlow ? <section className="scroll-mt-6" id="hire-flow">{hireFlow}</section> : <HiringUnavailable model={journey} notice={hireNotice} validationAvailable={canCheckAvailability} />}
        {canCheckAvailability ? (
          <details open={!reachable} className="group rounded-xl border border-white/10 bg-white/[0.015]" id="validation">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-zinc-200">
              {reachable ? "Diagnostics" : "Check connection"}
              <span className="text-xs font-normal text-zinc-500 group-open:hidden">Validate declared endpoints</span>
              <span className="hidden text-xs font-normal text-zinc-500 group-open:inline">Hide</span>
            </summary>
            <div className="border-t border-white/10 px-4 pb-5 sm:px-5">
              <AgentValidationActions
                agentId={agent.agentId}
                initialObservations={validationObservations}
                targets={validationTargets}
              />
            </div>
          </details>
        ) : null}
      </div>

      <QuoteHistory agentId={agent.agentId} />
      <JobHistory hireActivity={passport.checks.hireActivity} hireJobs={hireJobs} jobs={jobProofs} more={hireJobsMore} scope={hireJobsScope} />
    </main>
  );
}
