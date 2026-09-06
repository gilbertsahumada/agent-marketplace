import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { HireJobDetail } from "@/src/business/entities/hire-job";
import { explorerUrl, jobStatusLabel } from "./hire-job-rows";
import { Breadcrumb } from "./page-primitives";
import { AddressLink } from "./address-link";
import { JobAgentCell } from "./job-agent-cell";
import type { JobAgentResolution } from "@/src/business/entities/job-agent-resolution";
import { JobDeliveryPanel } from "./job-delivery-panel";
import { formatUnits } from "viem";
import { ERC8183_MAINNET } from "@/src/mainnet/contracts";

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
  const submission = job.deliverable ? job.events.findLast((event) => event.eventName === "JobSubmitted" && event.deliverable?.toLowerCase() === job.deliverable?.toLowerCase()) : undefined;
  const facts: Array<[string, string]> = [
    ["Buyer", job.buyer],
    ["Provider", job.provider],
    ["Evaluator", job.evaluator],
    ...(job.chainId === 97 ? [["Budget (raw token units)", job.budgetRaw] as [string, string]] : []),
    ["Expires", when(job.expiresAt)],
    ["Submitted", when(job.submittedAt)],
    ["Deliverable hash", job.deliverable ?? "—"],
  ];
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14" id="main-content">
      <Breadcrumb current={`Job #${job.jobId}`} trail={[{ href: "/", label: "Home" }, { href: `/jobs?chainId=${job.chainId}`, label: "Jobs" }]} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Indexed {jobStatusLabel(job.status)}</Badge>
        {job.marketplace ? <Badge className="border-primary/40 bg-primary/10 text-primary" variant="outline">Hired via this marketplace</Badge> : null}
      </div>
      <h1 className="mt-5 text-3xl font-light tracking-tight text-white sm:text-5xl">ERC-8183 Job #{job.jobId}</h1>
      {job.chainId === 56 ? <JobDeliveryPanel jobId={job.jobId} /> : null}

      <Card className="mt-8">
        <CardHeader><LedgerCardTitle>Indexed job state</LedgerCardTitle><CardDescription>Read from the Commerce contract by the observation Worker.</CardDescription></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-1 border-b border-border pb-3 sm:grid-cols-[10rem_1fr]">
            <span className="text-muted-foreground">Chain</span>
            <div className="flex items-center gap-3">
              <img alt="" width={24} height={24} className="size-6 shrink-0" src="/logo/SVG/BNB Chain_Symbol_Yellow.svg" />
              <div>
                <p>{job.chainId === 56 ? "BNB Smart Chain Mainnet" : "BNB Smart Chain Testnet"}</p>
                <p className="text-xs text-muted-foreground">Chain ID: {job.chainId}</p>
              </div>
            </div>
          </div>
          <div className="grid gap-1 border-b border-border pb-3 sm:grid-cols-[10rem_1fr]">
            <span className="text-muted-foreground">Agent</span><JobAgentCell resolution={agentResolution} />
          </div>
          {job.chainId === 56 ? <div className="grid gap-1 border-b border-border pb-3 sm:grid-cols-[10rem_1fr]">
            <span className="text-muted-foreground">Budget</span>
            <p className="flex items-center gap-1.5">
              <span>{formatUnits(BigInt(job.budgetRaw), 18)}</span>
              <a className={EXPLORER_LINK} href={`${explorer}/address/${ERC8183_MAINNET.token}`} target="_blank" rel="noopener noreferrer" aria-label="U token on explorer, opens in a new tab">U<ExternalLink aria-hidden="true" className="size-3" /></a>
            </p>
          </div> : null}
          {facts.map(([label, value]) => (
            <div className="grid gap-1 border-b border-white/[0.06] pb-3 sm:grid-cols-[10rem_1fr]" key={label}>
              <span className="text-zinc-500">{label}</span>
              <span className="font-hash break-all text-xs text-zinc-200">{["Buyer", "Provider", "Evaluator"].includes(label) ? <AddressLink address={value} chainId={job.chainId} full /> : value}</span>
            </div>
          ))}
          {job.deliverable ? <div className="space-y-2 text-sm text-muted-foreground">
            <p>The provider recorded this deliverable hash when submitting the result on-chain. It identifies the delivered content, not a transaction. Matching the hash verifies integrity, not the quality of the work.</p>
            {submission ? <a className={EXPLORER_LINK} href={`${explorer}/tx/${submission.txHash}`} target="_blank" rel="noopener noreferrer">View submission transaction<ExternalLink aria-hidden="true" className="size-3.5" /></a> : <p>Submission transaction not yet indexed.</p>}
          </div> : null}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><LedgerCardTitle>Phase ledger</LedgerCardTitle><CardDescription>One entry per Commerce event, in block order.</CardDescription></CardHeader>
        <CardContent>
          {job.events.length === 0 ? (
            <p className="text-sm text-zinc-500">No phase events indexed for this job yet. Jobs backfilled by state have no event history until a new phase lands on chain.</p>
          ) : (
            <ul aria-label="Indexed phase events" className="divide-y divide-white/10 text-sm">
              {job.events.map((event, index) => (
                <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={`${event.txHash}:${event.blockNumber}:${event.eventName}:${index}`}>
                  <span className="font-medium capitalize text-white">{event.phase}</span>
                  <span className="text-zinc-500">{when(event.occurredAt)}</span>
                  <a
                    aria-label={`${capitalize(event.phase)} transaction on explorer, opens in a new tab`}
                    className={EXPLORER_LINK}
                    href={`${explorer}/tx/${event.txHash}`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Transaction on explorer<ExternalLink aria-hidden="true" className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
