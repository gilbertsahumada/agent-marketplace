import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { HireJobDetail } from "@/src/business/entities/hire-job";
import { explorerUrl, jobStatusLabel } from "./hire-job-rows";
import { Breadcrumb } from "./page-primitives";
import type { JobAgentResolution } from "@/src/business/entities/job-agent-resolution";
import { JobDeliveryPanel } from "./job-delivery-panel";
import { TestnetClosurePanel } from "./testnet-closure-panel";
import { JobNotificationStatus } from "./job-notification-status";

const EXPLORER_LINK = "inline-flex items-center gap-1.5 text-signal underline decoration-signal/30 underline-offset-4 hover:decoration-signal focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal";

const UTC_DATE_TIME = new Intl.DateTimeFormat("en", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});

function when(value: string | null): string {
  return value === null ? "—" : `${UTC_DATE_TIME.format(new Date(value))} UTC`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// The shared CardTitle renders a div; these three titles are the page's
// section landmarks, so they carry the same classes on a real heading.
function LedgerCardTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-heading text-base leading-snug font-medium" data-slot="card-title">{children}</h2>;
}

// Fallback job page for any indexed job the live trackers do not cover.
// State comes from Commerce logs and getJob(); it is never a hash-verified
// deliverable, and the copy says so. "Hired via this marketplace" means a
// chain-verified hire event exists: the hire started here, nothing more.
export function HireJobLedgerPage({ job, agentResolution }: { job: HireJobDetail; agentResolution?: JobAgentResolution | undefined }) {
  const explorer = explorerUrl(job.chainId);
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14" id="main-content">
      <Breadcrumb current={`Job #${job.jobId}`} trail={[{ href: "/", label: "Home" }, { href: `/jobs?chainId=${job.chainId}`, label: "Jobs" }]} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Indexed {jobStatusLabel(job.status)}</Badge>
        {job.marketplace ? <Badge className="border-primary/40 bg-primary/10 text-primary" variant="outline">Hired via this marketplace</Badge> : null}
      </div>
      <h1 className="mt-5 text-3xl font-light tracking-tight text-white sm:text-5xl">ERC-8183 Job #{job.jobId}</h1>
      {job.chainId === 56 ? <JobDeliveryPanel jobId={job.jobId} /> : <TestnetClosurePanel jobId={job.jobId} />}
      <JobNotificationStatus chainId={job.chainId} jobId={job.jobId} />

      <JobStateCard job={job} agentResolution={agentResolution} />

      <JobPhaseLedger chainId={job.chainId} events={job.events} />

      {job.hireEvents.length > 0 ? (
        <Card className="mt-6">
          <CardHeader><LedgerCardTitle>Marketplace hire events</LedgerCardTitle><CardDescription>Phases the marketplace reported and the Worker verified against this job.</CardDescription></CardHeader>
          <CardContent>
            <ul aria-label="Chain-verified hire events" className="divide-y divide-white/10 text-sm">
              {job.hireEvents.map((event, index) => (
                <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={`${event.txHash}:${event.phase}:${index}`}>
                  <span className="capitalize text-white">{event.phase} · agent #{event.agentId}</span>
                  <span className="text-zinc-500">{when(event.occurredAt)}</span>
                  <a className={EXPLORER_LINK} href={`${explorer}/tx/${event.txHash}`} target="_blank" rel="noopener noreferrer" aria-label={`${capitalize(event.phase)} marketplace transaction on explorer, opens in a new tab`}>
                    Transaction on explorer<ExternalLink aria-hidden="true" className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
import { JobStateCard } from "./job-state-card";
import { JobPhaseLedger } from "./job-phase-ledger";
