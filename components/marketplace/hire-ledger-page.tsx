"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Database, ListChecks, RotateCcw, Search, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { HireAddress, HireChainId, HireJobPage, HireLedgerSummary } from "@/src/business/entities/hire-job";
import { jobStatusLabel, networkSlug } from "./hire-job-rows";
import { Breadcrumb } from "./page-primitives";
import { AddressLink } from "./address-link";
import { CatalogMetric } from "./catalog-metric";
import { JobAgentCell } from "./job-agent-cell";
import type { JobAgentResolution } from "@/src/business/entities/job-agent-resolution";

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

export function HireLedgerPage({ chainId, summary, page, before, provider, agentResolutions = {} }: {
  chainId: HireChainId;
  summary: HireLedgerSummary | null;
  page: HireJobPage | null;
  before?: string;
  provider?: HireAddress;
  agentResolutions?: Record<string, JobAgentResolution>;
}) {
  const scope = provider ? { provider } : {};
  const retryHref = jobsHref(chainId, { ...scope, ...(before ? { before } : {}) });
  const otherChain = chainId === 56 ? 97 : 56;
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase().replace(/^#/, "");
  const jobs = page?.jobs.filter((job) => [job.jobId, job.buyer, job.provider, job.status, job.marketplace ? "marketplace" : "unattributed",
    ...(agentResolutions[`${chainId}:${job.jobId}`]?.agents.flatMap(agent => [agent.agentId, agent.name ?? ""]) ?? []),
  ].some((value) => value.toLowerCase().includes(query))) ?? [];
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

      <div className="marketplace-surface grid items-center gap-4 rounded-xl p-3 xl:grid-cols-[auto_minmax(0,1fr)]" aria-label="Jobs totals">
        <div className="flex items-center gap-5 px-1 sm:gap-7">
          {[{ label: "Protocol jobs indexed", count: summary?.protocol.jobs, Icon: ListChecks }, { label: "Attributed to marketplace", count: summary?.marketplace.jobs, Icon: Store }].map(({ label, count, Icon }, index) => <div className={index === 0 ? "flex min-w-0 items-center gap-2.5" : "flex min-w-0 items-center gap-2.5 border-l border-white/10 pl-5 sm:pl-7"} key={label}>
            <Icon aria-hidden="true" className={index === 0 ? "size-4 shrink-0 text-muted-foreground" : "size-4 shrink-0 text-signal"} />
            <CatalogMetric label={label} value={count} unavailable="Unavailable" />
          </div>)}
        </div>
      </div>

      <section className="mt-4" aria-label="Indexed jobs">
        <div className="mb-4 flex items-center gap-3">
          <label className="relative block w-full min-w-0"><span className="sr-only">Search this page</span><Search aria-hidden="true" className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-zinc-500" /><Input className="catalog-search-input h-10 pl-11 focus-visible:ring-0" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this page by agent, job ID, wallet, state or origin" maxLength={120} disabled={!page?.jobs.length} /></label>
          <Button variant="outline" disabled={!search} onClick={() => setSearch("")}><RotateCcw aria-hidden="true" data-icon="inline-start" />Clear search</Button>
        </div>
        <Card className="jobs-card jobs-records gap-0 py-0">
        {provider && <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">Provider <AddressLink address={provider} chainId={chainId} /><Link className="text-signal hover:underline" href={jobsHref(chainId)}>All jobs</Link></div>}
        <CardContent className="px-0">
        {page === null ? <div className="jobs-empty" role="status"><h3>Indexed ledger temporarily unavailable.</h3><p>Job records could not be loaded. Try again shortly.</p><Button asChild variant="outline"><Link href={retryHref}>Try again</Link></Button></div> : page.jobs.length === 0 ? <div className="jobs-empty"><ListChecks aria-hidden="true" className="mx-auto mb-4 size-7 text-muted-foreground" /><h3>{before ? "No records on this page." : provider ? "No indexed jobs for this provider." : "No records in this index yet."}</h3><p>Historical coverage is not confirmed. This does not establish zero activity on the network.</p><div className="flex justify-center gap-3"><Button asChild><Link href="/agents">Explore agents</Link></Button><Button asChild variant="ghost"><Link href={jobsHref(otherChain, scope)}>View {otherChain === 56 ? "Mainnet" : "Testnet"}</Link></Button></div></div> : <div className="overflow-x-auto rounded-sm focus-visible:ring-2 focus-visible:ring-signal" tabIndex={0} role="region" aria-label="Job records, scroll horizontally for all columns">
          <Table className="jobs-table" containerLabel="Indexed jobs table">
            <TableCaption className="sr-only">Indexed ERC-8183 jobs, newest job IDs first. Observation times in UTC.</TableCaption>
            <TableHeader><TableRow>{["Job", "Agent", "Current state", "Buyer", "Provider", "Origin", "Last observed"].map((label) => <TableHead scope="col" key={label}>{label}</TableHead>)}<TableHead scope="col"><span className="sr-only">Details</span></TableHead></TableRow></TableHeader>
            <TableBody>{jobs.map((job) => <TableRow key={job.jobId}>
              <TableHead scope="row"><Link className="font-hash hover:text-signal" href={`/jobs/${networkSlug(chainId)}/${job.jobId}`}><span className="sr-only">Job </span>#{job.jobId}</Link></TableHead>
              <TableCell><JobAgentCell resolution={agentResolutions[`${chainId}:${job.jobId}`]} /></TableCell>
              <TableCell><Badge variant="outline" className={`jobs-state jobs-state--${job.status.toLowerCase()}`}>{jobStatusLabel(job.status)}</Badge></TableCell>
              <TableCell className="font-hash text-xs"><AddressLink address={job.buyer} chainId={chainId} /></TableCell>
              <TableCell className="font-hash text-xs"><AddressLink address={job.provider} chainId={chainId} /></TableCell>
              <TableCell><span className={job.marketplace ? "inline-flex items-center gap-2 text-signal" : "text-muted-foreground"}>{job.marketplace && <Database aria-hidden="true" className="size-4" />}{job.marketplace ? "Marketplace" : "Unattributed"}</span></TableCell>
              <TableCell className="text-muted-foreground"><time dateTime={job.updatedAt}>{DATE.format(new Date(job.updatedAt))} UTC</time></TableCell>
              <TableCell><Button asChild variant="ghost" size="icon"><Link aria-label={`View job #${job.jobId}`} href={`/jobs/${networkSlug(chainId)}/${job.jobId}`}><ChevronRight aria-hidden="true" /></Link></Button></TableCell>
            </TableRow>)}{jobs.length === 0 && <TableRow><TableCell colSpan={8} className="h-32 text-center">No matching records on this page. Clear the search or browse older jobs.</TableCell></TableRow>}</TableBody>
          </Table>
        </div>}
        </CardContent>
        {page && <CardFooter className="flex flex-wrap justify-between gap-4"><span className="text-sm text-muted-foreground">Showing {jobs.length} of {page.jobs.length} loaded jobs</span><Pagination className="mx-0 w-auto" aria-label="Jobs pagination"><PaginationContent><PaginationItem>
          {before ? <Button asChild variant="ghost"><Link href={jobsHref(chainId, scope)}><ArrowLeft aria-hidden="true" />Newest jobs</Link></Button> : <Button disabled variant="ghost"><ArrowLeft aria-hidden="true" />Newest jobs</Button>}
          </PaginationItem><PaginationItem>{page.nextBefore ? <Button asChild variant="outline"><Link href={jobsHref(chainId, { ...scope, before: page.nextBefore })}>Older jobs<ArrowRight aria-hidden="true" /></Link></Button> : <Button disabled variant="outline">Older jobs<ArrowRight aria-hidden="true" /></Button>}</PaginationItem></PaginationContent></Pagination>
        </CardFooter>}
        </Card>
      </section>

      <Card className="jobs-card mt-6 text-muted-foreground">
        <CardContent>
        <details className="group/coverage">
          <summary className="jobs-coverage-summary flex cursor-pointer items-center gap-4 text-foreground"><Database aria-hidden="true" className="size-6 shrink-0 text-signal" /><span className="flex flex-1 flex-col gap-1"><span>Coverage details</span><span className="text-sm text-muted-foreground">Indexed activity is not proof of deliverable quality.</span></span><ChevronDown aria-hidden="true" className="size-4 shrink-0 group-open/coverage:rotate-180" /></summary>
          <div className="mt-5 flex flex-col gap-3">
            <p>Counts reflect indexed records. Marketplace attribution confirms a recorded hire event, not deliverable quality.</p>
            <p>Historical coverage is not confirmed. Totals cover the configured Commerce contract on this network, and remain network-wide when filtering by provider.</p>
            <p>“Unattributed” means no marketplace attribution is recorded. Last observed is the index observation time, not the transaction time.</p>
            {summary ? <>
              <p className="font-hash text-xs">{summary.indexedThrough ? `Index cursor ${summary.indexedThrough.blockNumber} · Cursor updated ${DATE.format(new Date(summary.indexedThrough.at))} UTC` : "Indexer not started on this network yet."}</p>
              {summary.lastIndexRun && <p>{indexRunLabel(summary.lastIndexRun.status)} · {DATE.format(new Date(summary.lastIndexRun.at))} UTC</p>}
              <div className="overflow-x-auto"><table className="jobs-table max-w-2xl"><caption className="text-left py-3">Current indexed states</caption><thead><tr><th scope="col">State</th><th scope="col">Protocol index</th><th scope="col">Via marketplace</th></tr></thead><tbody>{STATUSES.map((status) => <tr key={status}><th scope="row">{jobStatusLabel(status)}</th><td>{summary.protocol.byStatus[status].toLocaleString("en")}</td><td>{summary.marketplace.byStatus[status].toLocaleString("en")}</td></tr>)}</tbody></table></div>
            </> : <p>Counts temporarily unavailable.</p>}
          </div>
        </details>
        </CardContent>
      </Card>
    </main>
  );
}
