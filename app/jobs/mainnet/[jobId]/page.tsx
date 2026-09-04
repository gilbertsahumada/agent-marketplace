import { ExternalLink, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { HireJobLedgerPage } from "@/components/marketplace/hire-job-ledger-page";
import { Breadcrumb } from "@/components/marketplace/page-primitives";
import { getHireLedger, getMainnetErc8183JobStatus } from "@/src/business/composition";
import {
  Erc8183DemoJobNotFoundError,
  Erc8183SpikeDisabledError,
  Erc8183SpikeUnavailableError,
} from "@/src/business/errors/erc8183-spike-errors";
import { MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";

export const metadata: Metadata = { title: "BSC Mainnet ERC-8183 job" };
export const dynamic = "force-dynamic";

export default async function MainnetJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!/^\d+$/.test(jobId) || jobId === "0") notFound();
  let job;
  try { job = await getMainnetErc8183JobStatus.execute({ jobId }); }
  catch (error) {
    if (
      error instanceof Erc8183SpikeDisabledError
      || error instanceof Erc8183DemoJobNotFoundError
      || error instanceof Erc8183SpikeUnavailableError
    ) {
      // Outside the live demo allowlist, or when the live chain read fails,
      // fall back to the indexed ledger so every job listed on /jobs still
      // has a page: indexed state is a legitimate degraded answer. A ledger
      // outage is an unavailable page, never a 404.
      let ledger;
      try { ledger = await getHireLedger.getJob({ chainId: 56, jobId }); }
      catch (ledgerError) {
        if (ledgerError instanceof MarketplaceDataUnavailableError) return <CatalogUnavailable retryHref={`/jobs/mainnet/${jobId}`} />;
        throw ledgerError;
      }
      if (ledger !== null) return <HireJobLedgerPage job={ledger} />;
      notFound();
    }
    throw error;
  }
  return (
    <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <Breadcrumb current={`Job #${job.jobId}`} trail={[{ href: "/", label: "Home" }]} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-amber-300/30 bg-amber-300/10 text-amber-100" variant="outline">BSC Mainnet · chain 56</Badge>
        <Badge variant="outline">Onchain {job.status}</Badge>
      </div>
      <h1 className="mt-5 text-3xl font-light tracking-tight text-white sm:text-5xl">ERC-8183 Job #{job.jobId}</h1>
      <p className="mt-3 max-w-2xl text-zinc-400">Reload-safe chain state for the marketplace-operated Grid seller. Browser journal entries are never treated as proof.</p>
      <Card className="mt-8">
        <CardHeader><CardTitle>Verified job state</CardTitle><CardDescription>Contracts and lifecycle are read from BSC Mainnet.</CardDescription></CardHeader>
        <CardContent className="space-y-4 text-sm">
          {[
            ["Buyer", job.buyer], ["Seller", job.provider], ["Evaluator", job.evaluator], ["Policy", job.policy],
            ["Budget raw", job.budgetRaw], ["Deadline", job.deadline], ["Deliverable hash", job.deliverableHash],
          ].map(([label, value]) => <div className="grid gap-1 border-b border-white/[0.06] pb-3 sm:grid-cols-[10rem_1fr]" key={label}><span className="text-zinc-500">{label}</span><span className="font-hash text-xs text-zinc-200">{value}</span></div>)}
          {job.result ? <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4"><p className="font-eyebrow flex items-center gap-2 text-emerald-300"><ShieldCheck className="size-4" />Hash-verified result</p><pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs text-zinc-200">{job.result.content}</pre></div> : <p className="text-zinc-500">A hash-verified deliverable is not available for the current state.</p>}
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline"><a href="https://bscscan.com/address/0xEa4DAa3100A767e86FDed867729ae7446476EBA6" rel="noreferrer" target="_blank">Commerce on BscScan<ExternalLink /></a></Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
