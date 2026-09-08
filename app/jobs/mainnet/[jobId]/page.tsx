import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { HireJobLedgerPage } from "@/components/marketplace/hire-job-ledger-page";
import { JobDeliveryPanel } from "@/components/marketplace/job-delivery-panel";
import { JobNotificationStatus } from "@/components/marketplace/job-notification-status";
import { jobStatusLabel } from "@/components/marketplace/hire-job-rows";
import { Breadcrumb } from "@/components/marketplace/page-primitives";
import { getHireLedger, getMainnetErc8183JobStatus, resolveJobAgents } from "@/src/business/composition";
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
      if (ledger !== null) {
        const agents = await resolveJobAgents.execute([ledger]);
        return <HireJobLedgerPage job={ledger} agentResolution={agents[`56:${jobId}`]} />;
      }
      notFound();
    }
    throw error;
  }
  const agents = await resolveJobAgents.execute([{ chainId: 56, jobId: job.jobId, provider: job.provider }]);
  // History is supplementary: an index outage must not hide verified live state.
  let history = null;
  try { history = await getHireLedger.getJob({ chainId: 56, jobId }); }
  catch (error) { if (!(error instanceof MarketplaceDataUnavailableError)) throw error; }
  return (
    <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <Breadcrumb current={`Job #${job.jobId}`} trail={[{ href: "/", label: "Home" }, { href: "/jobs?chainId=56", label: "Jobs" }]} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Onchain {jobStatusLabel(job.status)}</Badge>
      </div>
      <h1 className="mt-5 text-3xl font-light tracking-tight text-white sm:text-5xl">ERC-8183 Job #{job.jobId}</h1>
      <JobDeliveryPanel jobId={job.jobId} />
      <JobNotificationStatus chainId={56} jobId={job.jobId} />
      <JobStateCard job={{ ...directJobState(job), events: history?.events ?? [] }} source="direct" agentResolution={agents[`56:${job.jobId}`]} />
      <JobPhaseLedger chainId={56} events={history?.events ?? []} />
    </main>
  );
}
import { JobStateCard } from "@/components/marketplace/job-state-card";
import { directJobState } from "@/components/marketplace/direct-job-state";
import { JobPhaseLedger } from "@/components/marketplace/job-phase-ledger";
