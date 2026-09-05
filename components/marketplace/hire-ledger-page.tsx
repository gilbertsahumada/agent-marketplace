import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronRight, ListChecks, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HireActivity, HireAddress, HireChainId, HireJobPage, HireLedgerSummary } from "@/src/business/entities/hire-job";
import { shortAddress } from "@/lib/bsc-chains";
import { HireActivityWindow } from "./hire-activity-window";
import { jobStatusLabel, networkSlug } from "./hire-job-rows";
import { Breadcrumb } from "./page-primitives";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const STATUSES = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;

function jobsHref(chainId: HireChainId, scope: { provider?: HireAddress; before?: string } = {}): string {
  const query = new URLSearchParams({ chainId: String(chainId) });
  if (scope.provider) query.set("provider", scope.provider);
  if (scope.before) query.set("before", scope.before);
  return `/jobs?${query}`;
}

function indexRunLabel(status: string): string {
  switch (status) {
    case "ok": return "Last run succeeded";
    case "idle": return "Waiting for new blocks";
    case "initialized": return "Index initialized";
    case "error": return "Last run failed";
    default: return "Run status unavailable";
  }
}

export function HireLedgerPage({ chainId, summary, page, activity = null, before, provider }: {
  chainId: HireChainId;
  summary: HireLedgerSummary | null;
  page: HireJobPage | null;
  // Trailing window of phase events in the same provider scope as the list;
  // null when it could not be read.
  activity?: HireActivity | null;
  before?: string;
  // Scopes the job list and the activity window (not the counts) to one
  // provider wallet.
  provider?: HireAddress;
}) {
  const scope = provider ? { provider } : {};
  const retryHref = jobsHref(chainId, { ...scope, ...(before ? { before } : {}) });
  const otherChain = chainId === 56 ? 97 : 56;
  return (
    <main className="jobs-explorer mx-auto w-full max-w-[1480px] flex-1 px-5 py-8 sm:px-8 lg:px-12" id="main-content">
      <Breadcrumb current="Jobs" trail={[{ href: "/", label: "Home" }]} />
      <div className="mb-7 flex flex-wrap items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-medium tracking-tight sm:text-[42px]">Jobs explorer</h1>
          <p className="mt-3 text-muted-foreground">Browse indexed ERC-8183 jobs on BNB Chain.</p>
        </div>
        <nav aria-label="Network" className="flex rounded-lg border border-border p-1 text-sm">
          {([56, 97] as const).map((network) => <Link key={network} aria-current={network === chainId ? "page" : undefined} className={`rounded-md px-4 py-2.5 transition-colors ${network === chainId ? "bg-signal/5 text-signal ring-1 ring-signal/70" : "text-muted-foreground hover:text-foreground"}`} href={jobsHref(network, scope)}>{network === 56 ? "BSC Mainnet" : "BSC Testnet"}</Link>)}
        </nav>
      </div>

      <div className="flex flex-wrap gap-x-10 gap-y-6 border-y border-border/60 py-6">
        {[{ label: "Protocol jobs indexed", count: summary?.protocol.jobs, Icon: ListChecks }, { label: "Attributed to marketplace", count: summary?.marketplace.jobs, Icon: Store }].map(({ label, count, Icon }) => <div className="flex items-center gap-4 sm:min-w-72" key={label}>
          <Icon aria-hidden="true" className="size-6 text-muted-foreground" strokeWidth={1.3} />
          <div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl tabular-nums">{count === undefined ? <span className="text-sm">Unavailable</span> : count.toLocaleString("en")}</p></div>
        </div>)}
      </div>

      {activity !== null
        ? <div className="mt-6"><HireActivityWindow activity={activity} /></div>
        : <p className="mt-6 text-sm text-muted-foreground" role="status">Recent activity temporarily unavailable.</p>}

      <section className="mt-8" aria-labelledby="recent-jobs">
        <div className="mb-5 flex flex-wrap items-baseline gap-3">
          <h2 id="recent-jobs" className="text-xl font-medium">{provider ? `Jobs sold by ${shortAddress(provider)}` : "Indexed jobs"}{before ? ` before #${before}` : ""}</h2>
          {page && <span className="text-sm text-muted-foreground">{page.jobs.length} shown</span>}
          {provider && <Link className="text-sm text-signal hover:underline" href={jobsHref(chainId)}>All jobs</Link>}
        </div>
        {page === null ? <div className="jobs-empty" role="status"><h3>Indexed ledger temporarily unavailable.</h3><p>Job records could not be loaded. Try again shortly.</p><Button asChild variant="outline"><Link href={retryHref}>Try again</Link></Button></div> : page.jobs.length === 0 ? <div className="jobs-empty"><ListChecks aria-hidden="true" className="mx-auto mb-4 size-7 text-muted-foreground" /><h3>{before ? "No records on this page." : provider ? "No indexed jobs for this provider." : "No records in this index yet."}</h3><p>Historical coverage is not confirmed. This does not establish zero activity on the network.</p><div className="flex justify-center gap-3"><Button asChild><Link href="/agents">Explore agents</Link></Button><Button asChild variant="ghost"><Link href={jobsHref(otherChain, scope)}>View {otherChain === 56 ? "Mainnet" : "Testnet"}</Link></Button></div></div> : <div className="overflow-x-auto rounded-sm focus-visible:ring-2 focus-visible:ring-signal" tabIndex={0} role="region" aria-label="Job records, scroll horizontally for all columns">
          <table className="jobs-table">
            <caption className="sr-only">Indexed ERC-8183 jobs, newest job IDs first. Observation times in UTC.</caption>
            <thead><tr>{["Job", "Current state", "Buyer", "Provider", "Origin", "Last observed"].map((label) => <th scope="col" key={label}>{label}</th>)}<th scope="col"><span className="sr-only">Details</span></th></tr></thead>
            <tbody>{page.jobs.map((job) => <tr key={job.jobId}>
              <th scope="row"><Link className="font-medium hover:text-signal" href={`/jobs/${networkSlug(chainId)}/${job.jobId}`}><span className="sr-only">Job </span>#{job.jobId}</Link></th>
              <td><span className={`jobs-state jobs-state--${job.status.toLowerCase()}`}>{jobStatusLabel(job.status)}</span></td>
              <td className="font-hash text-xs" title={job.buyer}>{shortAddress(job.buyer)}</td>
              <td className="font-hash text-xs" title={job.provider}>{shortAddress(job.provider)}</td>
              <td className={job.marketplace ? "text-signal" : "text-muted-foreground"}>{job.marketplace ? "Marketplace" : "Protocol"}</td>
              <td className="text-muted-foreground"><time dateTime={job.updatedAt}>{DATE.format(new Date(job.updatedAt))} UTC</time></td>
              <td><Link aria-label={`View job #${job.jobId}`} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md hover:bg-white/5 hover:text-signal" href={`/jobs/${networkSlug(chainId)}/${job.jobId}`}><ChevronRight aria-hidden="true" className="size-4" /></Link></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {page && <div className="mt-5 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground"><span>Showing {page.jobs.length} indexed jobs</span><div className="flex gap-2">
          {before ? <Button asChild variant="ghost"><Link href={jobsHref(chainId, scope)}><ArrowLeft aria-hidden="true" />Newest jobs</Link></Button> : <Button disabled variant="ghost"><ArrowLeft aria-hidden="true" />Newest jobs</Button>}
          {page.nextBefore ? <Button asChild variant="outline"><Link href={jobsHref(chainId, { ...scope, before: page.nextBefore })}>Older jobs<ArrowRight aria-hidden="true" /></Link></Button> : <Button disabled variant="outline">Older jobs<ArrowRight aria-hidden="true" /></Button>}
        </div></div>}
      </section>

      <div className="mt-8 border-t border-border/60 pt-5 text-sm text-muted-foreground">
        <p>Counts reflect indexed records. Marketplace attribution confirms a recorded hire event, not deliverable quality.</p>
        <details className="mt-4">
          <summary className="w-fit cursor-pointer rounded py-2 text-foreground">Coverage details</summary>
          <div className="mt-3 space-y-3 pb-4">
            <p>Historical coverage is not confirmed. Totals cover the configured Commerce contract on this network, and remain network-wide when filtering by provider.</p>
            <p>“Protocol” means no marketplace attribution is recorded. Last observed is the index observation time, not the transaction time.</p>
            {summary ? <>
              <p className="font-hash text-xs">{summary.indexedThrough ? `Index cursor ${summary.indexedThrough.blockNumber} · Cursor updated ${DATE.format(new Date(summary.indexedThrough.at))} UTC` : "Indexer not started on this network yet."}</p>
              {summary.lastIndexRun && <p>{indexRunLabel(summary.lastIndexRun.status)} · {DATE.format(new Date(summary.lastIndexRun.at))} UTC</p>}
              <div className="overflow-x-auto"><table className="jobs-table max-w-2xl"><caption className="text-left py-3">Current indexed states</caption><thead><tr><th scope="col">State</th><th scope="col">Protocol index</th><th scope="col">Via marketplace</th></tr></thead><tbody>{STATUSES.map((status) => <tr key={status}><th scope="row">{jobStatusLabel(status)}</th><td>{summary.protocol.byStatus[status].toLocaleString("en")}</td><td>{summary.marketplace.byStatus[status].toLocaleString("en")}</td></tr>)}</tbody></table></div>
            </> : <p>Counts temporarily unavailable.</p>}
          </div>
        </details>
      </div>
    </main>
  );
}
