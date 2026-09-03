import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { MarketplaceAgent } from "@/src/business/entities/marketplace-agent";
import type { AgentEvidencePassport } from "@/src/business/entities/evidence-passport";
import type { MainnetJobProof } from "@/src/business/entities/mainnet-job-proof";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "./page-primitives";
import { AgentAvatar } from "./agent-avatar";
import { trust8004AgentHref } from "./agent-card";
import { AgentValidationActions } from "./agent-validation-actions";
import { declaredBrowserValidationTargets } from "@/src/business/policies/catalog-validation-policy";
import type { CatalogCandidate } from "@/src/business/entities/catalog-candidate";
import { catalogCandidateCard } from "./catalog-candidate-view-model";

const EMPTY_JOBS: readonly MainnetJobProof[] = [];
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

function JobHistory({ jobs }: { jobs: readonly MainnetJobProof[] }) {
  const ordered = [...jobs].sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  return (
    <section aria-labelledby="erc8183-history" className="mt-8 rounded-xl border border-white/10 bg-white/[0.015]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
        <h2 className="flex items-center gap-2 text-base font-medium text-white" id="erc8183-history">
          <BriefcaseBusiness aria-hidden="true" className="size-4 text-zinc-500" />ERC-8183 job history
        </h2>
        <Badge variant="outline">{jobs.length} proven</Badge>
      </div>
      {ordered.length === 0 ? (
        <div className="px-5 py-6 text-sm text-zinc-500">
          No verified ERC-8183 jobs yet.
        </div>
      ) : (
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
      )}
    </section>
  );
}

export function AgentProfile({
  agent,
  passport,
  catalogCandidate,
  hireFlow,
  jobProofs = EMPTY_JOBS,
}: {
  agent: MarketplaceAgent;
  passport: AgentEvidencePassport;
  catalogCandidate?: CatalogCandidate | null;
  hireFlow?: ReactNode;
  jobProofs?: readonly MainnetJobProof[];
}) {
  const displayName = marketplaceAgentDisplayName(agent.name);
  const current = catalogCandidate ? catalogCandidateCard(catalogCandidate) : null;
  const targetMap = new Map(declaredBrowserValidationTargets(agent).map((target) => [
    `${target.protocol}\u0000${target.endpoint}`,
    target,
  ]));
  for (const target of agent.validationTargets ?? []) {
    targetMap.set(`${target.protocol}\u0000${target.endpoint}`, target);
  }
  const validationTargets = [...targetMap.values()];
  const canCheckAvailability = current?.buyerAction === "check_availability"
    && (catalogCandidate?.state?.canRequestBrowserValidation === true
      || catalogCandidate?.state?.canRequestInfrastructureValidation === true)
    && validationTargets.length > 0;
  const hireTarget = hireFlow ? "#hire-flow" : canCheckAvailability ? "#validation" : null;
  const reachable = catalogCandidate?.state?.operationalStatus === "platform_reachable"
    && catalogCandidate.state.freshness === "live";
  const previouslyReachable = catalogCandidate?.state?.operationalStatus === "platform_reachable";
  const quoteReady = passport.checks.quote.status === "verified";

  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <Breadcrumb current={displayName} trail={[{ href: "/agents", label: "Agents" }]} />

      <section className="flex flex-col gap-5 border-y border-white/10 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <AgentAvatar {...(agent.imageUrl ? { imageUrl: agent.imageUrl } : {})} className="size-14" name={displayName} />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-medium tracking-tight text-white sm:text-2xl">{displayName}</h1>
            <p className="mt-1 text-sm text-zinc-500">BSC Mainnet · Agent #{agent.agentId}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Badge className={reachable ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : ""} variant="outline">
            <span aria-hidden="true" className={`size-1.5 rounded-full ${reachable ? "bg-emerald-400" : canCheckAvailability || previouslyReachable ? "bg-amber-300" : "bg-zinc-600"}`} />
            {reachable ? "Reachable" : hireFlow ? "Verified on quote" : canCheckAvailability || previouslyReachable ? "Check required" : "Unavailable"}
          </Badge>
          {quoteReady ? <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300" variant="outline">Quote verified</Badge> : null}
          <Badge variant="outline">{passport.trackRecord.provenJobs} jobs</Badge>
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

      {hireFlow ? <section className="mt-8 scroll-mt-6" id="hire-flow">{hireFlow}</section> : null}
      {!hireFlow && canCheckAvailability ? <AgentValidationActions agentId={agent.agentId} targets={validationTargets} /> : null}
      {!hireTarget ? <p className="mt-8 rounded-xl border border-white/10 px-5 py-4 text-sm text-zinc-500">Hiring unavailable for this agent.</p> : null}

      <JobHistory jobs={jobProofs} />
    </main>
  );
}
