import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { HireJobLedgerPage } from "@/components/marketplace/hire-job-ledger-page";
import { TestnetJobTracker } from "@/components/marketplace/testnet-job-tracker";
import { getErc8183TestnetJobTracking, getHireLedger, resolveJobAgents } from "@/src/business/composition";
import {
  Erc8183DemoJobNotFoundError,
  Erc8183SpikeDisabledError,
  Erc8183SpikeUnavailableError,
  InvalidErc8183SpikeInputError,
} from "@/src/business/errors/erc8183-spike-errors";
import { MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";

export const metadata: Metadata = {
  title: "ERC-8183 Testnet job",
  description: "Direct-chain tracking and sanitized evidence for a controlled ERC-8183 Testnet job.",
};

export const dynamic = "force-dynamic";

export default async function TestnetJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    const tracking = await getErc8183TestnetJobTracking.execute({ jobId });
    const agents = tracking.job ? await resolveJobAgents.execute([{ chainId: 97, jobId, provider: tracking.job.provider }]) : {};
    return <TestnetJobTracker tracking={tracking} agentResolution={agents[`97:${jobId}`]} />;
  } catch (error) {
    if (
      error instanceof Erc8183DemoJobNotFoundError
      || error instanceof Erc8183SpikeDisabledError
      || error instanceof Erc8183SpikeUnavailableError
    ) {
      // Outside the fixed demo, or when the live chain read fails, fall back
      // to the indexed ledger; a ledger outage is an unavailable page, never
      // a 404.
      if (!/^(?:0|[1-9]\d{0,15})$/.test(jobId)) notFound();
      let ledger;
      try { ledger = await getHireLedger.getJob({ chainId: 97, jobId }); }
      catch (ledgerError) {
        if (ledgerError instanceof MarketplaceDataUnavailableError) return <CatalogUnavailable retryHref={`/jobs/testnet/${jobId}`} />;
        throw ledgerError;
      }
      if (ledger !== null) {
        const agents = await resolveJobAgents.execute([ledger]);
        return <HireJobLedgerPage job={ledger} agentResolution={agents[`97:${jobId}`]} />;
      }
      notFound();
    }
    if (error instanceof InvalidErc8183SpikeInputError) notFound();
    throw error;
  }
}
