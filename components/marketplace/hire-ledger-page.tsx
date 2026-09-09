"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { NetworkSelector } from "./network-selector";
import { paginationSummary } from "./pagination-summary";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, Database, ListChecks, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { HireActivity, HireAddress, HireChainId, HireJob, HireJobPage, HireLedgerSummary } from "@/src/business/entities/hire-job";
import type { JobAgentResolution } from "@/src/business/entities/job-agent-resolution";
import { AddressLink } from "./address-link";
import { HireActivityWindow } from "./hire-activity-window";
import { jobStatusLabel, networkSlug } from "./hire-job-rows";
import { JobAgentCell } from "./job-agent-cell";
import { Breadcrumb } from "./page-primitives";
import { jobNextStep } from "@/src/business/entities/job-next-step";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const STATUSES = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;
const COLUMNS = ["Job", "Agent", "Current state", "Next step", "Buyer", "Provider", "Origin", "Last observed"] as const;
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
  const router = useRouter();
  const [navigating, startTransition] = useTransition();
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
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [sort, setSort] = useState<{ column: SortColumn; ascending: boolean }>({ column: "Job", ascending: false });
  const query = search.trim().toLowerCase().replace(/^#/, "");
  const exactId = /^[1-9]\d{0,15}$/.test(query) ? query : null;
  const lookupKey = `${chainId}:${search}`;
  const [lookup, setLookup] = useState<{ key: string; state: "found" | "missing" | "error"; job?: HireJob & { agentResolution?: JobAgentResolution } } | null>(null);
  const loadedExact = exactId !== null && Boolean(page?.jobs.some(job => job.jobId === exactId));
  useEffect(() => {
    if (!exactId || loadedExact) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => { controller.abort(); if (active) setLookup({ key: lookupKey, state: "error" }); active = false; }, 15_000);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/marketplace/jobs/${networkSlug(chainId)}/${exactId}/ledger`, { signal: controller.signal });
        if (response.status === 404) {
          if (active) setLookup({ key: lookupKey, state: "missing" });
          return;
        }
        if (!response.ok) throw new Error("Lookup unavailable");
        const data = await response.json();
        if (data.jobId !== exactId || data.chainId !== chainId ||
          typeof data.buyer !== "string" || !/^0x[\da-f]{40}$/i.test(data.buyer) ||
          typeof data.provider !== "string" || !/^0x[\da-f]{40}$/i.test(data.provider) ||
          !STATUSES.includes(data.status) || !Number.isFinite(Date.parse(data.updatedAt)) ||
          !Number.isFinite(Date.parse(data.expiresAt)) || typeof data.marketplace !== "boolean") throw new Error("Invalid job response");
        if (active) setLookup({ key: lookupKey, state: "found", job: data });
      } catch {
        if (active) setLookup({ key: lookupKey, state: "error" });
      } finally {
        clearTimeout(timeout);
      }
    }, 300);
    return () => { active = false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [chainId, exactId, loadedExact, lookupKey]);
  const searching = Boolean(exactId && !loadedExact && lookup?.key !== lookupKey);
  const pending = navigating || searching;
  const resolutions = lookup?.key === lookupKey && lookup.job?.agentResolution
    ? { ...agentResolutions, [`${chainId}:${lookup.job.jobId}`]: lookup.job.agentResolution }
    : agentResolutions;
  const sourceJobs = exactId ? loadedExact ? page!.jobs.filter(job => job.jobId === exactId)
    : lookup?.key === lookupKey && lookup.job ? [lookup.job] : [] : page?.jobs ?? [];
  const jobs = sourceJobs.filter((job) => [job.jobId, job.buyer, job.provider, job.status, jobNextStep(job, now).label, job.marketplace ? "marketplace" : "unattributed",
    ...(resolutions[`${chainId}:${job.jobId}`]?.agents.flatMap(agent => [agent.agentId, agent.name ?? ""]) ?? []),
  ].some((value) => value.toLowerCase().includes(query)));
  const agentName = (id: string) => resolutions[`${chainId}:${id}`]?.agents.map(agent => agent.name || agent.agentId).join(" ") ?? "";
  jobs.sort((a, b) => {
    let order = 0;
    switch (sort.column) {
      case "Job": order = BigInt(a.jobId) < BigInt(b.jobId) ? -1 : BigInt(a.jobId) > BigInt(b.jobId) ? 1 : 0; break;
      case "Agent": order = agentName(a.jobId).localeCompare(agentName(b.jobId), "en", { numeric: true }); break;
      case "Current state": order = jobStatusLabel(a.status).localeCompare(jobStatusLabel(b.status)); break;
      case "Next step": order = jobNextStep(a, now).label.localeCompare(jobNextStep(b, now).label); break;
      case "Buyer": order = a.buyer.toLowerCase().localeCompare(b.buyer.toLowerCase()); break;
      case "Provider": order = a.provider.toLowerCase().localeCompare(b.provider.toLowerCase()); break;
      case "Origin": order = (a.marketplace ? "Marketplace" : "Unattributed").localeCompare(b.marketplace ? "Marketplace" : "Unattributed"); break;
      case "Last observed": order = Date.parse(a.updatedAt) - Date.parse(b.updatedAt); break;
    }
    return (sort.ascending ? order : -order) || (BigInt(a.jobId) < BigInt(b.jobId) ? 1 : -1);
  });

  const networkSelector = <NetworkSelector network={chainId === 56 ? "mainnet" : "testnet"}
    hrefs={{ mainnet: jobsHref(56, periodScope), testnet: jobsHref(97, periodScope) }} pending={pending} />;

  return (
    <main className="jobs-explorer mx-auto w-full max-w-[1480px] flex-1 px-5 py-8 sm:px-8 lg:px-12" id="main-content" onClickCapture={event => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/jobs?"]');
      if (!anchor || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      if (!pending) { setSearch(""); setLookup(null); startTransition(() => router.push(anchor.getAttribute("href")!, { scroll: false })); }
    }}>
      <Breadcrumb current="Jobs" trail={[{ href: "/", label: "Home" }]} />
      <div className="mb-7 flex flex-wrap items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-medium tracking-tight sm:text-[42px]">Jobs explorer</h1>
        </div>
      </div>

      <div className="mt-6"><HireActivityWindow activity={activity} showUnavailable={summary !== null || page !== null} days={activityDays} chainId={chainId} pending={pending} networkSelector={networkSelector} periodHrefs={{
            7: jobsHref(chainId, { ...scope, days: 7 }),
            30: jobsHref(chainId, scope),
            90: jobsHref(chainId, { ...scope, days: 90 }),
          }} /></div>

      <section className="mt-7" aria-label="Indexed jobs">
        <div className="relative mb-4">
          <label className="sr-only" htmlFor="jobs-search">Search this page</label>
          <Search aria-hidden="true" className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-zinc-500" />
          <Input id="jobs-search" className="catalog-search-input h-10 pr-11 pl-11 focus-visible:ring-0" disabled={navigating} value={search} onChange={(event) => { setLookup(null); setSearch(event.target.value); }} placeholder="Find any job by exact ID, or filter this page by text" maxLength={120} />
          {search && <Button aria-label="Clear search" className="absolute top-1/2 right-1.5 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground" variant="ghost" size="icon" onClick={() => setSearch("")}><X aria-hidden="true" /></Button>}
        </div>
        {exactId && !loadedExact && <p role="status" className="mb-4 text-sm">
          {lookup?.key !== lookupKey ? "Searching the selected network…" : lookup.state === "found"
            ? "Exact ID result · all dates on the selected network"
            : lookup.state === "missing" ? "This job is not indexed on the selected network."
              : "Job search is temporarily unavailable. Clear the search and retry."}
        </p>}
        <Card className="jobs-card jobs-records gap-0 py-0">
          {provider && <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">Provider <AddressLink address={provider} chainId={chainId} /><Link className="text-signal hover:underline" href={jobsHref(chainId, activityDays === 30 ? {} : { days: activityDays })}>All jobs</Link></div>}
          <CardContent className="px-0">
            {!exactId && !pending && page === null ? <div className="jobs-empty" role="status"><h3>Indexed ledger temporarily unavailable.</h3><p>Job records could not be loaded. Try again shortly.</p><Button asChild variant="outline"><Link href={retryHref}>Try again</Link></Button></div> : !exactId && !pending && page?.jobs.length === 0 ? <div className="jobs-empty"><ListChecks aria-hidden="true" className="mx-auto mb-4 size-7 text-muted-foreground" /><h3>{before ? "No records on this page." : provider ? "No indexed jobs for this provider." : `No jobs with indexed activity in the past ${activityDays} days.`}</h3><p>Historical coverage is not confirmed. This does not establish zero activity on the network.</p><div className="flex justify-center gap-3"><Button asChild><Link href="/agents">Explore agents</Link></Button><Button asChild variant="ghost"><Link href={jobsHref(otherChain, periodScope)}>View {otherChain === 56 ? "Mainnet" : "Testnet"}</Link></Button></div></div> : <div className="overflow-x-auto rounded-sm focus-visible:ring-2 focus-visible:ring-signal" tabIndex={0} role="region" aria-label="Job records, scroll horizontally for all columns">
              <Table className="jobs-table" containerLabel="Indexed jobs table">
                <TableCaption className="sr-only">Indexed ERC-8183 jobs. Sorted by {sort.column}, {sort.ascending ? "ascending" : "descending"}, within this page. Observation times in UTC.</TableCaption>
                <TableHeader><TableRow>{COLUMNS.map((label) => <TableHead scope="col" key={label} aria-sort={sort.column === label ? sort.ascending ? "ascending" : "descending" : "none"}>
                  <button type="button" className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-sm py-2 hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal" disabled={pending} onClick={() => setSort(current => ({ column: label, ascending: current.column === label ? !current.ascending : true }))}>
                    {label}{sort.column === label ? sort.ascending ? <ArrowUp aria-hidden="true" className="size-3.5 text-signal" /> : <ArrowDown aria-hidden="true" className="size-3.5 text-signal" /> : <ArrowUpDown aria-hidden="true" className="size-3.5" />}
                  </button>
                </TableHead>)}<TableHead scope="col"><span className="sr-only">Details</span></TableHead></TableRow></TableHeader>
                <TableBody aria-busy={pending}>{pending ? Array.from({ length: 5 }, (_, row) => <TableRow key={row}><TableCell colSpan={9}><Skeleton className="my-3 h-8 w-full" /><span className="sr-only">Loading jobs…</span></TableCell></TableRow>) : jobs.map((job) => <TableRow key={job.jobId}>
                  <TableHead scope="row"><Link className="font-hash hover:text-signal" href={`/jobs/${networkSlug(chainId)}/${job.jobId}`}><span className="sr-only">Job </span>#{job.jobId}</Link></TableHead>
                  <TableCell><JobAgentCell resolution={resolutions[`${chainId}:${job.jobId}`]} /></TableCell>
                  <TableCell><Badge variant="outline" className={`jobs-state jobs-state--${job.status.toLowerCase()}`}>{jobStatusLabel(job.status)}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap">
                    {jobNextStep(job, now).actionable
                      ? <Link className="text-signal underline-offset-4 hover:underline" title="Based on indexed state. Open the job to verify its current status and available actions." href={`/jobs/${networkSlug(chainId)}/${job.jobId}`}>{jobNextStep(job, now).label}</Link>
                      : <span className="text-muted-foreground">{jobNextStep(job, now).label}</span>}
                  </TableCell>
                  <TableCell className="font-hash text-xs"><AddressLink address={job.buyer} chainId={chainId} /></TableCell>
                  <TableCell className="font-hash text-xs"><AddressLink address={job.provider} chainId={chainId} /></TableCell>
                  <TableCell><span className={job.marketplace ? "inline-flex items-center gap-2 text-signal" : "text-muted-foreground"}>{job.marketplace && <Database aria-hidden="true" className="size-4" />}{job.marketplace ? "Marketplace" : "Unattributed"}</span></TableCell>
                  <TableCell className="text-muted-foreground"><time dateTime={job.updatedAt}>{DATE.format(new Date(job.updatedAt))} UTC</time></TableCell>
                  <TableCell><Button asChild variant="ghost" size="icon"><Link aria-label={`View job #${job.jobId}`} href={`/jobs/${networkSlug(chainId)}/${job.jobId}`}><ChevronRight aria-hidden="true" /></Link></Button></TableCell>
                </TableRow>)}{!pending && jobs.length === 0 && <TableRow><TableCell colSpan={9} className="h-32 text-center">{exactId ? lookup?.state === "missing" ? "No job found on the selected network." : "Job search unavailable. Clear the search and retry." : "No matching records on this page. Clear the search or browse older jobs."}</TableCell></TableRow>}</TableBody>
              </Table>
            </div>}
          </CardContent>
          {page && !exactId && <CardFooter className="block">
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
              <nav aria-label="Jobs pagination" className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2 [&>a:first-child]:justify-self-start [&>button:first-child]:justify-self-start [&>a:last-child]:justify-self-end [&>button:last-child]:justify-self-end">
                {before && !pending ? <Button asChild variant="outline"><Link href={previousHref}><ChevronLeft aria-hidden="true" />Previous</Link></Button> : <Button disabled variant="outline"><ChevronLeft aria-hidden="true" />Previous</Button>}
                <span aria-live="polite" className="font-stat max-w-32 text-center text-xs text-muted-foreground sm:max-w-none">{pending ? "Updating results…" : paginationSummary(jobs.length, query ? page.jobs.length : page.totals?.total)}{query ? " on this page" : ""}<span className="mt-1 block">Page {pageNumber}</span></span>
                {nextHref && !pending ? <Button asChild variant="outline"><Link href={nextHref}>Next<ChevronRight aria-hidden="true" /></Link></Button> : <Button disabled variant="outline">Next<ChevronRight aria-hidden="true" /></Button>}
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
              <p>{summary ? `${summary.protocol.jobs.toLocaleString("en")} indexed` : "Indexed total unavailable"}</p>
              <p>Counts reflect indexed records. Marketplace attribution confirms a recorded hire event, not deliverable quality.</p>
              <p>Historical coverage is not confirmed. Totals cover the configured Commerce contract on this network, and remain network-wide when filtering by provider.</p>
              <p>The period filters jobs with indexed on-chain events in that UTC window, not their last observation time. Exact ID searches cover all dates. Jobs without dated events are excluded from the period view.</p>
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
