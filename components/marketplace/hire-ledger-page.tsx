import Link from "next/link";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HireAddress, HireChainId, HireJobPage, HireLedgerCounts, HireLedgerSummary } from "@/src/business/entities/hire-job";
import { shortAddress } from "@/lib/bsc-chains";
import { HireJobRows, jobStatusLabel } from "./hire-job-rows";
import { MyHireJobs } from "./my-hire-jobs";
import { Breadcrumb, PageIntro } from "./page-primitives";

const UTC_DATE_TIME = new Intl.DateTimeFormat("en", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});
const STATUSES = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;

function CountsCard({ title, counts, note }: { title: string; counts: HireLedgerCounts; note: string }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.015] px-5 py-4">
      <h2 className="text-sm font-medium text-zinc-300">{title}</h2>
      <p className="font-stat mt-2 text-3xl text-white">{counts.jobs.toLocaleString("en")}</p>
      <p className="mt-1 text-xs text-zinc-500">{note}</p>
      <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
        {STATUSES.map((status) => (
          <div key={status}>
            <dt className="text-xs text-zinc-500">{jobStatusLabel(status)}</dt>
            <dd className="font-stat text-zinc-200">{counts.byStatus[status].toLocaleString("en")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SectionUnavailable({ children }: { children: string }) {
  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-5 py-5">
      <p className="text-sm text-zinc-200">{children}</p>
      <p className="mt-1 text-xs text-zinc-500">The observation Worker did not answer this read within the bounded request window. Nothing was invented.</p>
    </div>
  );
}

// Every link on the page keeps the provider scope when there is one; only
// "All jobs" drops it on purpose.
function jobsHref(chainId: HireChainId, scope: { provider?: HireAddress; before?: string } = {}): string {
  let href = `/jobs?chainId=${chainId}`;
  if (scope.provider !== undefined) href += `&provider=${scope.provider}`;
  if (scope.before !== undefined) href += `&before=${scope.before}`;
  return href;
}

// The Worker records "ok" or "error" per indexer run; anything else is
// reported as a failure rather than echoed raw.
function indexRunLabel(status: string): string {
  return status === "ok" ? "last run succeeded" : "last run failed";
}

// Marketplace-wide ledger of indexed ERC-8183 jobs. Two numbers on purpose:
// every Commerce job and the subset hired via this marketplace (a
// chain-verified hire event exists, so the hire started here). Both are
// activity counts; a settled job proves the phase, not the deliverable. Each
// read degrades on its own, so a failed list never hides good counts.
export function HireLedgerPage({ chainId, summary, page, before, provider }: {
  chainId: HireChainId;
  summary: HireLedgerSummary | null;
  page: HireJobPage | null;
  before?: string;
  // Scopes the job list (not the counts) to one provider wallet.
  provider?: HireAddress;
}) {
  const otherChain: HireChainId = chainId === 56 ? 97 : 56;
  const nothingRead = summary === null && page === null;
  const scope = provider === undefined ? {} : { provider };
  const listHeading = provider !== undefined
    ? `Jobs sold by ${shortAddress(provider)}${before === undefined ? "" : ` before #${before}`}`
    : before === undefined ? "Recent jobs" : `Jobs before #${before}`;
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8 lg:py-14" id="main-content">
      <Breadcrumb current="Jobs" trail={[{ href: "/", label: "Home" }]} />
      <PageIntro eyebrow="On-chain activity" title="ERC-8183 jobs on BSC">
        Indexed on-chain state of the Commerce contract. Counts are activity, not a track record: a settled job proves the phase, not the deliverable.
      </PageIntro>

      <nav aria-label="Network" className="mt-6 flex gap-2">
        {([56, 97] as const).map((network) => (
          <Link
            aria-current={network === chainId ? "page" : undefined}
            className={network === chainId
              ? "rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white"
              : "rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"}
            href={jobsHref(network, scope)}
            key={network}
          >
            {network === 56 ? "BSC Mainnet" : "BSC Testnet"}
          </Link>
        ))}
      </nav>

      {nothingRead ? (
        <div className="mt-8 rounded-xl border border-amber-400/20 bg-amber-400/5 px-5 py-6">
          <p className="text-sm text-zinc-200">Indexed ledger temporarily unavailable.</p>
          <p className="mt-1 text-sm text-zinc-500">The observation Worker did not answer within the bounded request window. No job state was invented.</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href={jobsHref(chainId, { ...scope, ...(before === undefined ? {} : { before }) })}><RotateCcw aria-hidden="true" />Try again</Link>
          </Button>
        </div>
      ) : null}

      {summary !== null ? (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <CountsCard counts={summary.protocol} note="Every Commerce job the indexer has seen on this network." title="All Commerce jobs" />
            <CountsCard counts={summary.marketplace} note="Jobs with a chain-verified hire event recorded by this marketplace: the hire started here. Says nothing about the deliverable." title="Hired via this marketplace" />
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            {summary.indexedThrough
              ? `Indexed through block ${summary.indexedThrough.blockNumber} · ${UTC_DATE_TIME.format(new Date(summary.indexedThrough.at))} UTC`
              : "Indexer not started on this network yet."}
            {summary.lastIndexRun ? ` · ${indexRunLabel(summary.lastIndexRun.status)}` : ""}
          </p>
        </>
      ) : nothingRead ? null : (
        <div className="mt-8"><SectionUnavailable>Counts temporarily unavailable.</SectionUnavailable></div>
      )}

      {page !== null ? (
        <section aria-labelledby="recent-jobs" className="mt-8 rounded-xl border border-white/10 bg-white/[0.015]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
            <h2 className="text-base font-medium text-white" id="recent-jobs">{listHeading}</h2>
            <span className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
              {page.jobs.length} shown
              {provider !== undefined ? <Link className="text-primary underline-offset-4 hover:underline" href={jobsHref(chainId)}>All jobs</Link> : null}
            </span>
          </div>
          <HireJobRows chainId={chainId} emptyText="No indexed jobs on this network yet." jobs={page.jobs} />
          {page.nextBefore !== null || before !== undefined ? (
            <div className="flex flex-wrap gap-3 border-t border-white/10 px-4 py-4 sm:px-5">
              {before !== undefined ? (
                <Button asChild variant="ghost">
                  <Link href={jobsHref(chainId, scope)}><ArrowLeft aria-hidden="true" />Newest jobs</Link>
                </Button>
              ) : null}
              {page.nextBefore !== null ? (
                <Button asChild variant="outline">
                  <Link href={jobsHref(chainId, { ...scope, before: page.nextBefore })}>Older jobs<ArrowRight aria-hidden="true" /></Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : nothingRead ? null : (
        <div className="mt-8"><SectionUnavailable>Recent jobs temporarily unavailable.</SectionUnavailable></div>
      )}

      <MyHireJobs chainId={chainId} />
      <p className="mt-6 text-xs text-zinc-600">Other network: <Link className="underline-offset-4 hover:underline" href={jobsHref(otherChain, scope)}>{otherChain === 56 ? "BSC Mainnet" : "BSC Testnet"}</Link></p>
    </main>
  );
}
