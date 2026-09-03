import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { MarketplaceAgent } from "@/src/business/entities/marketplace-agent";
import type { AgentEvidencePassport } from "@/src/business/entities/evidence-passport";
import type { MainnetJobProof } from "@/src/business/entities/mainnet-job-proof";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function StatusSummary({ label, tone, value }: {
  label: string;
  tone: "positive" | "pending" | "neutral";
  value: string;
}) {
  const dot = tone === "positive" ? "bg-emerald-400" : tone === "pending" ? "bg-amber-300" : "bg-zinc-600";
  return (
    <div className="min-w-0 border-l border-white/10 pl-4 first:border-l-0 first:pl-0">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-sm font-medium text-zinc-100">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span className="truncate">{value}</span>
      </p>
    </div>
  );
}

function utcDate(value: string): string {
  return UTC_DATE.format(new Date(value));
}

function JobHistory({ jobs }: { jobs: readonly MainnetJobProof[] }) {
  const ordered = [...jobs].sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  return (
    <section aria-labelledby="erc8183-history" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium text-white" id="erc8183-history">ERC-8183 job history</h2>
          <p className="mt-1 text-sm text-zinc-500">Verified Mainnet work completed through this marketplace.</p>
        </div>
        <Badge variant="outline">{jobs.length} proven</Badge>
      </div>
      {ordered.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-white/10 px-5 py-8 text-sm text-zinc-500">
          No verified ERC-8183 jobs yet.
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
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
  const quoteRequestable = catalogCandidate?.state?.canRequestQuote === true;
  const hireTitle = hireFlow
    ? "Request a fresh quote"
    : canCheckAvailability ? "Check the seller first" : "Hiring unavailable";
  const hireHint = hireFlow
    ? "Review current terms before connecting your wallet."
    : canCheckAvailability
      ? "Start by validating the declared seller transport."
      : "This agent does not expose a marketplace-compatible hiring route.";

  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <Breadcrumb current={agent.name} trail={[{ href: "/agents", label: "Agents" }]} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <AgentAvatar {...(agent.imageUrl ? { imageUrl: agent.imageUrl } : {})} className="size-16" name={agent.name} />
            <div className="min-w-0">
              <p className="text-sm text-zinc-500">BSC Mainnet · Agent #{agent.agentId}</p>
              <h1 className="mt-2 text-3xl font-medium tracking-tight text-white sm:text-4xl">Hire {agent.name}</h1>
              <a
                className="mt-4 inline-flex cursor-pointer items-center gap-1.5 text-sm text-zinc-400 underline-offset-4 hover:text-white hover:underline"
                href={trust8004AgentHref(agent.agentId)}
                rel="noopener noreferrer"
                target="_blank"
              >
                ERC-8004 profile and reputation<ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            </div>
          </div>

          <div className="mt-7 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
            <StatusSummary
              label="Availability"
              tone={reachable ? "positive" : canCheckAvailability || previouslyReachable ? "pending" : "neutral"}
              value={reachable ? "Reachable" : canCheckAvailability || previouslyReachable ? "Check now" : "Unavailable"}
            />
            <StatusSummary label="Quote" tone={quoteReady ? "positive" : quoteRequestable ? "pending" : "neutral"} value={quoteReady ? "Verified" : quoteRequestable ? "Request now" : "Not ready"} />
            <StatusSummary label="Jobs" tone={passport.trackRecord.provenJobs > 0 ? "positive" : "neutral"} value={`${passport.trackRecord.provenJobs} proven`} />
          </div>
        </section>

        <Card className="border-primary/30 bg-primary/[0.05]">
          <CardHeader>
            <CardTitle>{hireTitle}</CardTitle>
            <p className="text-sm leading-relaxed text-zinc-400">{hireHint}</p>
          </CardHeader>
          <CardContent>
            {hireTarget ? (
              <Button asChild className="w-full" size="lg">
                <a href={hireTarget}>Hire agent<ArrowRight aria-hidden="true" /></a>
              </Button>
            ) : (
              <Button className="w-full" disabled size="lg">Hire agent</Button>
            )}
          </CardContent>
        </Card>
      </div>

      {hireFlow ? <section className="mt-8 scroll-mt-6" id="hire-flow">{hireFlow}</section> : null}
      {!hireFlow && canCheckAvailability ? <AgentValidationActions agentId={agent.agentId} targets={validationTargets} /> : null}

      <JobHistory jobs={jobProofs} />
    </main>
  );
}
