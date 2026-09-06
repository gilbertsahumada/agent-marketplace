"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, Database, ListChecks, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { HireActivity, HireAddress, HireChainId, HireJobPage, HireLedgerSummary } from "@/src/business/entities/hire-job";
import type { JobAgentResolution } from "@/src/business/entities/job-agent-resolution";
import { AddressLink } from "./address-link";
import { HireActivityWindow } from "./hire-activity-window";
import { jobStatusLabel, networkSlug } from "./hire-job-rows";
import { JobAgentCell } from "./job-agent-cell";
import { Breadcrumb } from "./page-primitives";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const STATUSES = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;
const COLUMNS = ["Job", "Agent", "Current state", "Buyer", "Provider", "Origin", "Last observed"] as const;
type SortColumn = typeof COLUMNS[number];

function jobsHref(chainId: HireChainId, scope: { provider?: HireAddress; before?: string; days?: number } = {}): string {
  const query = new URLSearchParams({ chainId: String(chainId) });
  if (scope.provider) query.set("provider", scope.provider);
  if (scope.before) query.set("before", scope.before);
  if (scope.days && scope.days !== 30) query.set("days", String(scope.days));
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

export function HireLedgerPage({ chainId, summary, page, activity = null, activityDays = 30, before, provider, agentResolutions = {}, cursorTrail = [] }: {
  cursorTrail?: string[];
  chainId: HireChainId;
  summary: HireLedgerSummary | null;
  page: HireJobPage | null;
  activity?: HireActivity | null;
  activityDays?: 7 | 30 | 90;
  before?: string;
  provider?: HireAddress;
  agentResolutions?: Record<string, JobAgentResolution>;
}) {
  const scope = provider ? { provider } : {};
  const periodScope = { ...scope, ...(activityDays === 30 ? {} : { days: activityDays }) };
  const trail = before ? cursorTrail : [];
  const pageNumber = before ? trail.length + 2 : 1;
  const previousCursor = trail.at(-1);
  const withTrail = (href: string, cursors: string[]) => cursors.length ? `${href}&trail=${cursors.join(",")}` : href;
  const previousHref = withTrail(jobsHref(chainId, { ...periodScope, ...(previousCursor ? { before: previousCursor } : {}) }), trail.slice(0, -1));
  const nextHref = page?.nextBefore ? withTrail(jobsHref(chainId, { ...periodScope, before: page.nextBefore }), before ? [...trail, before] : []) : null;
  const retryHref = jobsHref(chainId, { ...periodScope, ...(before ? { before } : {}) });
  const otherChain = chainId === 56 ? 97 : 56;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ column: SortColumn; ascending: boolean }>({ column: "Job", ascending: false });
  const query = search.trim().toLowerCase().replace(/^#/, "");
  const jobs = page?.jobs.filter((job) => [job.jobId, job.buyer, job.provider, job.status, job.marketplace ? "marketplace" : "unattributed",
    ...(agentResolutions[`${chainId}:${job.jobId}`]?.agents.flatMap(agent => [agent.agentId, agent.name ?? ""]) ?? []),
  ].some((value) => value.toLowerCase().includes(query))) ?? [];
  const agentName = (id: string) => agentResolutions[`${chainId}:${id}`]?.agents.map(agent => agent.name || agent.agentId).join(" ") ?? "";
  jobs.sort((a, b) => {
    let order = 0;
    switch (sort.column) {
      case "Job": order = BigInt(a.jobId) < BigInt(b.jobId) ? -1 : BigInt(a.jobId) > BigInt(b.jobId) ? 1 : 0; break;
      case "Agent": order = agentName(a.jobId).localeCompare(agentName(b.jobId), "en", { numeric: true }); break;
      case "Current state": order = jobStatusLabel(a.status).localeCompare(jobStatusLabel(b.status)); break;
      case "Buyer": order = a.buyer.toLowerCase().localeCompare(b.buyer.toLowerCase()); break;
      case "Provider": order = a.provider.toLowerCase().localeCompare(b.provider.toLowerCase()); break;
      case "Origin": order = (a.marketplace ? "Marketplace" : "Unattributed").localeCompare(b.marketplace ? "Marketplace" : "Unattributed"); break;
      case "Last observed": order = Date.parse(a.updatedAt) - Date.parse(b.updatedAt); break;
    }
    return (sort.ascending ? order : -order) || (BigInt(a.jobId) < BigInt(b.jobId) ? 1 : -1);
  });

  return (
    <main className="jobs-explorer mx-auto w-full max-w-[1480px] flex-1 px-5 py-8 sm:px-8 lg:px-12" id="main-content">
      <Breadcrumb current="Jobs" trail={[{ href: "/", label: "Home" }]} />
      <div className="mb-7 flex flex-wrap items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-medium tracking-tight sm:text-[42px]">Jobs explorer</h1>
          <p className="mt-3 text-muted-foreground">Browse indexed ERC-8183 jobs on BNB Chain.</p>
        </div>
        <nav aria-label="Network" className="flex rounded-lg border border-border p-1 text-sm">
          {([56, 97] as const).map((network) => <Link key={network} aria-current={network === chainId ? "page" : undefined} className={`rounded-md px-4 py-2.5 transition-colors ${network === chainId ? "bg-signal/5 text-signal ring-1 ring-signal/70" : "text-muted-foreground hover:text-foreground"}`} href={jobsHref(network, periodScope)}>{network === 56 ? "BSC Mainnet" : "BSC Testnet"}</Link>)}
        </nav>
      </div>

      {activity !== null
        ? <div className="mt-6"><HireActivityWindow activity={activity} periodHrefs={{
            7: jobsHref(chainId, { ...scope, days: 7 }),
            30: jobsHref(chainId, scope),
            90: jobsHref(chainId, { ...scope, days: 90 }),
          }} /></div>
        : (summary !== null || page !== null) && <p className="mt-6 text-sm text-muted-foreground" role="status">Recent activity temporarily unavailable.</p>}

      <section className="mt-7" aria-labelledby="indexed-jobs-heading">
        <h2 className="mb-3 text-xl font-medium" id="indexed-jobs-heading">Indexed jobs</h2>
        <div className="relative mb-4">
          <label className="sr-only" htmlFor="jobs-search">Search this page</label>
          <Search aria-hidden="true" className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-zinc-500" />
          <Input id="jobs-search" className="catalog-search-input h-10 pr-11 pl-11 focus-visible:ring-0" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by agent, job ID, wallet, state or origin" maxLength={120} disabled={!page?.jobs.length} />
          {search && <Button aria-label="Clear search" className="absolute top-1/2 right-1.5 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground" variant="ghost" size="icon" onClick={() => setSearch("")}><X aria-hidden="true" /></Button>}
        </div>
        <Card className="jobs-card jobs-records gap-0 py-0">
          {provider && <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">Provider <AddressLink address={provider} chainId={chainId} /><Link className="text-signal hover:underline" href={jobsHref(chainId, activityDays === 30 ? {} : { days: activityDays })}>All jobs</Link></div>}
          <CardContent className="px-0">
            {page === null ? <div className="jobs-empty" role="status"><h3>Indexed ledger temporarily unavailable.</h3><p>Job records could not be loaded. Try again shortly.</p><Button asChild variant="outline"><Link href={retryHref}>Try again</Link></Button></div> : page.jobs.length === 0 ? <div className="jobs-empty"><ListChecks aria-hidden="true" className="mx-auto mb-4 size-7 text-muted-foreground" /><h3>{before ? "No records on this page." : provider ? "No indexed jobs for this provider." : "No records in this index yet."}</h3><p>Historical coverage is not confirmed. This does not establish zero activity on the network.</p><div className="flex justify-center gap-3"><Button asChild><Link href="/agents">Explore agents</Link></Button><Button asChild variant="ghost"><Link href={jobsHref(otherChain, periodScope)}>View {otherChain === 56 ? "Mainnet" : "Testnet"}</Link></Button></div></div> : <div className="overflow-x-auto rounded-sm focus-visible:ring-2 focus-visible:ring-signal" tabIndex={0} role="region" aria-label="Job records, scroll horizontally for all columns">
              <Table className="jobs-table" containerLabel="Indexed jobs table">
                <TableCaption className="sr-only">Indexed ERC-8183 jobs. Sorted by {sort.column}, {sort.ascending ? "ascending" : "descending"}, within this page. Observation times in UTC.</TableCaption>
                <TableHeader><TableRow>{COLUMNS.map((label) => <TableHead scope="col" key={label} aria-sort={sort.column === label ? sort.ascending ? "ascending" : "descending" : "none"}>
                  <button type="button" className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-sm py-2 hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal" onClick={() => setSort(current => ({ column: label, ascending: current.column === label ? !current.ascending : true }))}>
                    {label}{sort.column === label ? sort.ascending ? <ArrowUp aria-hidden="true" className="size-3.5 text-signal" /> : <ArrowDown aria-hidden="true" className="size-3.5 text-signal" /> : <ArrowUpDown aria-hidden="true" className="size-3.5" />}
                  </button>
                </TableHead>)}<TableHead scope="col"><span className="sr-only">Details</span></TableHead></TableRow></TableHeader>
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
          {page && <CardFooter className="block">
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
              <span className="font-stat text-xs text-zinc-400">{summary ? `${summary.protocol.jobs.toLocaleString("en")} indexed` : "Indexed total unavailable"}</span>
              <nav aria-label="Jobs pagination" className="flex items-center gap-4">
                {before ? <Button asChild variant="outline"><Link href={previousHref}><ChevronLeft aria-hidden="true" />Previous</Link></Button> : <Button disabled variant="outline"><ChevronLeft aria-hidden="true" />Previous</Button>}
                <span className="font-stat text-xs text-zinc-400">Page {pageNumber}</span>
                {nextHref ? <Button asChild variant="outline"><Link href={nextHref}>Next<ChevronRight aria-hidden="true" /></Link></Button> : <Button disabled variant="outline">Next<ChevronRight aria-hidden="true" /></Button>}
              </nav>
            </div>
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
                <div className="overflow-x-auto"><table className="jobs-table max-w-2xl"><caption className="py-3 text-left">Current indexed states</caption><thead><tr><th scope="col">State</th><th scope="col">Protocol index</th><th scope="col">Via marketplace</th></tr></thead><tbody>{STATUSES.map((status) => <tr key={status}><th scope="row">{jobStatusLabel(status)}</th><td>{summary.protocol.byStatus[status].toLocaleString("en")}</td><td>{summary.marketplace.byStatus[status].toLocaleString("en")}</td></tr>)}</tbody></table></div>
              </> : <p>Counts temporarily unavailable.</p>}
            </div>
          </details>
        </CardContent>
      </Card>
    </main>
  );
}
